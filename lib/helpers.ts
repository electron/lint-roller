import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { range as balancedRange } from 'balanced-match';

// Helper for `parseJSONC` which walks the text, copying string literals
// through verbatim, and lets the callback deal with everything else by
// returning how many characters it consumed and what to output for them
function mapOutsideStrings(
  text: string,
  fn: (index: number) => [consumed: number, output: string] | undefined,
): string {
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        j += text[j] === '\\' ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else {
      const [consumed, output] = fn(i) ?? [1, text[i]];
      out += output;
      i += consumed;
    }
  }

  return out;
}

// Minimal JSONC support (comments and trailing commas), which is what the
// oxc tools accept in their JSON config files
export function parseJSONC(text: string): unknown {
  const withoutComments = mapOutsideStrings(text, (i) => {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      return [(end === -1 ? text.length : end) - i, ''];
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        throw new SyntaxError('Unterminated block comment');
      }
      return [end + 2 - i, ''];
    }
    return undefined;
  });

  const withoutTrailingCommas = mapOutsideStrings(withoutComments, (i) => {
    if (withoutComments[i] === ',' && /^\s*[}\]]/.test(withoutComments.slice(i + 1))) {
      return [1, ''];
    }
    return undefined;
  });

  return JSON.parse(withoutTrailingCommas);
}

export type SpawnAsyncResult = {
  stdout: string;
  stderr: string;
  status: number | null;
};

export async function spawnAsync(
  command: string,
  args: string[],
  options?: childProcess.SpawnOptionsWithoutStdio,
): Promise<SpawnAsyncResult> {
  return new Promise((resolve, reject) => {
    try {
      const stdio = { stdout: '', stderr: '' };
      const spawned = childProcess.spawn(command, args, options || {});

      spawned.stdout.on('data', (data) => {
        stdio.stdout += data;
      });

      spawned.stderr.on('data', (data) => {
        stdio.stderr += data;
      });

      // Wait for 'close' rather than 'exit' so that stdio is fully drained
      spawned.on('close', (code) => resolve({ ...stdio, status: code }));
      spawned.on('error', (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

export function chunkFilenames(filenames: string[], offset: number = 0): string[][] {
  // Windows has a max command line length of 2047 characters, so we can't
  // provide too many filenames without going over that. To work around that,
  // chunk up a list of filenames such that it won't go over that limit when
  // used as args. Use a much higher limit on other platforms which will
  // effectively be a no-op.
  const MAX_FILENAME_ARGS_LENGTH = os.platform() === 'win32' ? 2047 - offset : 100 * 1024;

  return filenames.reduce(
    (chunkedFilenames: string[][], filename) => {
      const currChunk = chunkedFilenames[chunkedFilenames.length - 1];
      const currChunkLength = currChunk.reduce(
        (totalLength, _filename) => totalLength + _filename.length + 1,
        0,
      );
      if (currChunkLength + filename.length + 1 > MAX_FILENAME_ARGS_LENGTH) {
        chunkedFilenames.push([filename]);
      } else {
        currChunk.push(filename);
      }
      return chunkedFilenames;
    },
    [[]],
  );
}

export function findCurlyBracedDirectives(directive: string, str: string) {
  const prefix = `${directive}=`;
  const matches: string[] = [];
  let idx = 0;

  while (idx >= 0 && idx < str.length) {
    idx = str.indexOf(prefix, idx);
    if (idx >= 0) {
      idx = idx + prefix.length;
      const val = str.slice(idx);
      const range = balancedRange('{', '}', val);
      if (range) {
        matches.push(val.slice(range[0] + 1, range[1]).trim());
      }
    }
  }

  return matches;
}

export interface LintRollerTsCheckConfig {
  defaultImports?: string[];
  typings?: string[];
}

export interface LintRollerConfig {
  'markdown-ts-check'?: LintRollerTsCheckConfig;
}

export function loadConfig(path: string) {
  if (!fs.existsSync(path)) {
    return undefined;
  }

  const config = fs.readFileSync(path, 'utf8');

  try {
    return JSON.parse(config) as LintRollerConfig;
  } catch {
    throw new Error(`Couldn't parse config at ${path}`);
  }
}
