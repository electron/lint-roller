import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { range as balancedRange } from 'balanced-match';

// Helper function to work around import issues with ESM module
// eslint-disable-next-line no-new-func
export const dynamicImport = new Function('specifier', 'return import(specifier)');

// From zeke/standard-markdown
export function removeParensWrappingOrphanedObject(block: string) {
  return block.replace(/^\(([{|[][\s\S]+[}|\]])\)$/gm, '$1');
}

// From zeke/standard-markdown
export function wrapOrphanObjectInParens(block: string) {
  return block.replace(/^([{|[][\s\S]+[}|\]])$/gm, '($1)');
}

export type SpawnAsyncResult = {
  stdout: string;
  stderr: string;
  status: number | null;
};

export async function spawnAsync(
  command: string,
  args: string[],
  options?: childProcess.SpawnOptionsWithoutStdio | undefined,
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

      spawned.on('exit', (code) => resolve({ ...stdio, status: code }));
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

  return JSON.parse(config) as LintRollerConfig;
}
