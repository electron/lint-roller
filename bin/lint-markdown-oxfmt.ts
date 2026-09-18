#!/usr/bin/env node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, stripVTControlCharacters } from 'node:util';

import {
  findCodeBlocks,
  findOrphanObjects,
  maskStringsAndComments,
  matchingBracket,
  wrapOrphanObjects,
  writeCodeBlockChanges,
  JS_LANGS,
  ORPHAN_OBJECT_PREFIX,
  Problems,
  TS_LANGS,
} from '../lib/code-blocks.js';
import type { CodeBlock, OrphanObject, Problem } from '../lib/code-blocks.js';
import { resolveBin, spawnAsync } from '../lib/helpers.js';
import { DocsWorkspace } from '../lib/markdown.js';

interface Options {
  config?: string;
  fix?: boolean;
  ignoreGlobs?: string[];
}

/**
 * A 0-based position within a temp file that oxfmt was
 * given, where the column is counted in UTF-8 bytes
 */
interface ParseError {
  line: number;
  column: number;
  message: string;
}

// A parse error in the report oxfmt prints to stderr, which looks like this,
// or with colour forced on (like when the CI environment variable is around)
// the same with ANSI escapes and Unicode box-drawing characters:
//
//   x Unexpected token
//    ,-[/tmp/lint-roller-oxfmt-1a2B3c/blocks/4-docs-api-app-md-56.js:2:3]
const PARSE_ERROR = /^[ \t]*[x×][ \t]+(.+)\r?\n[ \t]*(?:,-|╭─)\[(.+):(\d+):(\d+)\]/gm;

// With "semi: false" style the formatter guards a statement starting with a
// paren, bracket, backtick, or such with a leading semicolon, which is just
// noise on the first statement (after any comments) of a documentation snippet
const LEADING_SEMICOLON_GUARD = /^((?:[ \t]*(?:\/\/.*|\/\*(?:[^*]|\*(?!\/))*\*\/[ \t]*)?\n)*);/;

function stripLeadingSemicolonGuard(formatted: string, original: string): string {
  return LEADING_SEMICOLON_GUARD.test(original)
    ? formatted
    : formatted.replace(LEADING_SEMICOLON_GUARD, '$1');
}

/**
 * Strips the wrapping from a formatted bare object literal: the parens are
 * kept around an object literal but not an array literal, and the semicolon
 * guards come back as a trailing semicolon and/or with "semi: false" style
 * a leading one
 */
function unwrapFormattedOrphanObject(formatted: string, original: string): string {
  let code = formatted;
  let masked = maskStringsAndComments(code);
  const remove = (idx: number) => {
    code = code.slice(0, idx) + code.slice(idx + 1);
    masked = masked.slice(0, idx) + masked.slice(idx + 1);
  };

  if (masked.startsWith(';')) {
    remove(0);
  }

  if (masked.startsWith('(')) {
    const close = matchingBracket(masked, 0);

    if (close !== -1 && /^[;\s]*$/.test(masked.slice(close + 1))) {
      remove(close);
      remove(0);
    }
  }

  // Only keep a trailing semicolon if there was one to begin with
  if (!/;\s*$/.test(maskStringsAndComments(original))) {
    const last = masked.trimEnd().length - 1;

    if (masked[last] === ';') {
      remove(last);
    }
  }

  return code;
}

interface Segment {
  text: string;
  /** 0-based line the segment starts on */
  line: number;
  /** Set for a bare object literal, relative to this segment */
  orphan?: OrphanObject;
  blankLineBefore: boolean;
}

/**
 * Splits code up into the given bare object literals and the runs of code
 * around them so that each can be formatted separately
 */
function splitIntoSegments(text: string, orphans: OrphanObject[]): Segment[] {
  const lines = text.split('\n');
  const segments: Segment[] = [];
  const pushSegment = (start: number, end: number, orphan?: OrphanObject) => {
    segments.push({
      text: lines.slice(start, end + 1).join('\n'),
      line: start,
      orphan: orphan && { ...orphan, start: 0, end: orphan.end - orphan.start },
      blankLineBefore: start > 0 && !lines[start - 1].trim(),
    });
  };
  let cursor = 0;

  for (const orphan of [...orphans, { start: lines.length, end: lines.length, endColumn: 0 }]) {
    let start = cursor;
    let end = orphan.start - 1;

    // Drop blank lines at either end of a run of code like the formatter
    // would, one is put back between segments if there were any
    while (start <= end && !lines[start].trim()) start++;
    while (end >= start && !lines[end].trim()) end--;

    if (start <= end) {
      pushSegment(start, end);
    }

    if (orphan.start < lines.length) {
      pushSegment(orphan.start, orphan.end, orphan);
    }

    cursor = orphan.end + 1;
  }

  return segments;
}

async function runOxfmt(
  oxfmtBin: string,
  dir: string,
  { config, ignorePath }: { config?: string; ignorePath: string },
): Promise<Map<string, ParseError>> {
  // Formats the files in place, finding the config from the working directory
  // when not given one - as it otherwise would the ignore files, which are of
  // no use here and might even match the temp files, hence the empty stand-in
  const args = [oxfmtBin, '--ignore-path', ignorePath];

  if (config) {
    args.push('--config', path.resolve(config));
  }

  args.push(dir);

  const result = await spawnAsync(process.execPath, args);
  const stderr = stripVTControlCharacters(result.stderr);
  const errors = new Map<string, ParseError>();

  for (const [, message, file, line, column] of stderr.matchAll(PARSE_ERROR)) {
    const name = path.basename(file);

    // Only the first error in each file is of interest
    if (!errors.has(name)) {
      errors.set(name, { line: Number(line) - 1, column: Number(column) - 1, message });
    }
  }

  // Files which could not be parsed make for an exit status of 2 (the rest
  // still get formatted), anything else, like a bad config, is unexpected
  if (result.status !== 0 && !(result.status === 2 && errors.size)) {
    throw new Error(
      `oxfmt exited with status ${result.status}:\n${(stderr || result.stdout).trim()}`,
    );
  }

  return errors;
}

/**
 * Where a parse error is in `text` going by characters rather than UTF-8
 * bytes, with running out of input put down to the end of the last line
 * rather than the start of the one after
 */
function locate(text: string, { line, column }: ParseError): { line: number; column: number } {
  const lines = text.split('\n');

  if (line >= lines.length) {
    return { line: lines.length - 1, column: lines[lines.length - 1].length };
  }

  return { line, column: Buffer.from(lines[line]).subarray(0, column).toString().length };
}

interface Entry {
  block: CodeBlock;
  /** The code with the whitespace just inside the code fences dropped */
  body: string;
  /** The body split up around its bare object literals, if it has any */
  segments: { segment: Segment; text: string; tempFile: string }[];
  /** Temp file of the body as a whole, if it came to formatting that */
  tempFile?: string;
}

/**
 * Puts the formatted code block back together from what oxfmt made of its
 * temp files and decides what, if anything, to do about it
 */
function checkBlock(
  { block, body, segments, tempFile }: Entry,
  readTempFile: (tempFile: string) => string,
  errors: Map<string, ParseError>,
  fix: boolean,
): { problem: Problem } | { formatted: string } | undefined {
  const { value } = block;

  // Whitespace just inside the code fences is dropped when formatting,
  // but is needed to map parse errors back to their original position
  const leadingWhitespace = /^\s*/.exec(value)![0];
  const leadingBlankLines = leadingWhitespace.split('\n').length - 1;
  const firstLineIndent = leadingWhitespace.length - leadingWhitespace.lastIndexOf('\n') - 1;

  let formatted: string | undefined;
  let error: ParseError | undefined;

  if (segments.length) {
    const parts: string[] = [];

    for (const { segment, text, tempFile } of segments) {
      const { orphan, blankLineBefore } = segment;
      const segmentError = errors.get(tempFile);

      // The code block got formatted as a whole instead then, but hang on to
      // this (likely more accurate) error in case that failed too
      if (segmentError) {
        let { line, column } = locate(text, segmentError);

        if (orphan && line === 0) {
          column = Math.max(0, column - ORPHAN_OBJECT_PREFIX.length);
        }

        error = { line: segment.line + line, column, message: segmentError.message };
        parts.length = 0;
        break;
      }

      let code = readTempFile(tempFile);

      code = orphan
        ? unwrapFormattedOrphanObject(code, segment.text)
        : stripLeadingSemicolonGuard(code, text);

      parts.push(blankLineBefore ? `\n${code}` : code);
    }

    if (parts.length) {
      formatted = parts.join('\n');
    }
  }

  if (formatted === undefined) {
    // Always written when there were no segments or one could not be parsed
    const bodyTempFile = tempFile!;
    const bodyError = errors.get(bodyTempFile);

    if (!bodyError) {
      formatted = stripLeadingSemicolonGuard(readTempFile(bodyTempFile), body);
    } else {
      error ??= { ...locate(body, bodyError), message: bodyError.message };

      return {
        problem: {
          line: block.line + 1 + leadingBlankLines + error.line,
          column: block.column + error.column + (error.line === 0 ? firstLineIndent : 0),
          message: `${error.message} (oxfmt)`,
        },
      };
    }
  }

  if (formatted === value) {
    return undefined;
  }

  if (fix) {
    return { formatted };
  }

  // Report the first line which differs to give the user a hint
  const lines = value.split('\n');
  const formattedLines = formatted.split('\n');
  let idx = formattedLines.findIndex((line, idx) => line !== lines[idx]);

  // No difference within the formatted output means the original
  // has extra trailing lines, so point at the first of those
  if (idx === -1) {
    idx = formattedLines.length;
  }

  return {
    problem: {
      line: block.line + 1 + idx,
      column: block.column,
      message: 'Code block is not formatted (oxfmt)',
    },
  };
}

async function main(
  workspaceRoot: string,
  globs: string[],
  { config, fix = false, ignoreGlobs = [] }: Options,
) {
  const oxfmtBin = resolveBin('oxfmt');
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const problems = new Problems();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-roller-oxfmt-'));
  const tempFiles = new Map<string, string>();

  // Name the file after the original Markdown file and the starting line
  // number of the code block so that any stray output from oxfmt is
  // understandable - the counter prefix guarantees it is unique
  const writeTempFile = (dir: string, block: CodeBlock, text: string) => {
    const name = `${tempFiles.size}-${block.filepath.replace(/[^\w-]/g, '-')}-${block.line}.${block.ext}`;

    tempFiles.set(name, path.join(dir, name));
    fs.writeFileSync(path.join(dir, name), `${text}\n`);

    return name;
  };

  // Line endings are matched to the Markdown file when writing
  // changes so drop any carriage returns the config asked for
  const readTempFile = (name: string) =>
    fs.readFileSync(tempFiles.get(name)!, 'utf8').replace(/\r\n?/g, '\n').replace(/\n$/, '');

  try {
    const blocks = await findCodeBlocks(workspace, [...JS_LANGS, ...TS_LANGS], problems);
    const ignorePath = path.join(tempDir, 'ignore');
    const blocksDir = path.join(tempDir, 'blocks');
    const retriesDir = path.join(tempDir, 'retries');

    fs.writeFileSync(ignorePath, '');
    fs.mkdirSync(blocksDir);
    fs.mkdirSync(retriesDir);

    // Bare object literals need to be wrapped in parens to be parsed as an
    // expression, and the only sure way to find that wrapping in formatted
    // output to undo it is for it to be the whole output, so format those
    // separately from the code around them to piece back together after
    const entries = blocks.map((block): Entry => {
      const body = block.value.trim();
      const orphans = findOrphanObjects(body);

      if (!orphans.length) {
        return { block, body, segments: [], tempFile: writeTempFile(blocksDir, block, body) };
      }

      const segments = splitIntoSegments(body, orphans).map((segment) => {
        const text = segment.orphan
          ? wrapOrphanObjects(segment.text, [segment.orphan])
          : segment.text;

        return { segment, text, tempFile: writeTempFile(blocksDir, block, text) };
      });

      return { block, body, segments };
    });

    const errors = entries.length
      ? await runOxfmt(oxfmtBin, blocksDir, { config, ignorePath })
      : new Map<string, ParseError>();

    // Finding bare object literals is only a heuristic which might have made
    // matters worse by splitting mid-statement, so give any code block where
    // a piece could not be parsed another go as a whole
    const retries = entries.filter(({ segments }) =>
      segments.some(({ tempFile }) => errors.has(tempFile)),
    );

    if (retries.length) {
      for (const entry of retries) {
        entry.tempFile = writeTempFile(retriesDir, entry.block, entry.body);
      }

      for (const [tempFile, error] of await runOxfmt(oxfmtBin, retriesDir, {
        config,
        ignorePath,
      })) {
        errors.set(tempFile, error);
      }
    }

    const changes = new Map<CodeBlock, string>();

    for (const entry of entries) {
      const result = checkBlock(entry, readTempFile, errors, fix);

      if (result && 'problem' in result) {
        problems.add(entry.block.filepath, result.problem);
      } else if (result) {
        changes.set(entry.block, result.formatted);
      }
    }

    writeCodeBlockChanges(workspace, changes);

    return problems.print(workspaceRoot) > 0;
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

function parseCommandLine() {
  const showUsage = (): never => {
    console.log(
      'Usage: lint-roller-markdown-oxfmt [--root <dir>] <globs> [-h|--help] [--fix] ' +
        '[--ignore <globs>] [--ignore-path <path>] [--config <path>]',
    );
    process.exit(1);
  };

  try {
    const opts = parseArgs({
      allowPositionals: true,
      options: {
        config: {
          type: 'string',
        },
        fix: {
          type: 'boolean',
        },
        root: {
          type: 'string',
        },
        ignore: {
          type: 'string',
          multiple: true,
        },
        'ignore-path': {
          type: 'string',
        },
        help: {
          type: 'boolean',
        },
      },
    });

    if (opts.values.help || !opts.positionals.length) return showUsage();

    return opts;
  } catch {
    return showUsage();
  }
}

if ((await fs.promises.realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const { values: opts, positionals } = parseCommandLine();

  if (!opts.root) {
    opts.root = '.';
  }

  if (opts.ignore) {
    opts.ignore = Array.isArray(opts.ignore) ? opts.ignore : [opts.ignore];
  } else {
    opts.ignore = [];
  }

  if (opts['ignore-path']) {
    const ignores = fs.readFileSync(path.resolve(opts['ignore-path']), { encoding: 'utf-8' });

    for (const ignore of ignores.split('\n')) {
      opts.ignore.push(ignore.trimEnd());
    }
  }

  main(path.resolve(process.cwd(), opts.root), positionals, {
    config: opts.config,
    fix: opts.fix,
    ignoreGlobs: opts.ignore,
  })
    .then((errors) => {
      if (errors) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
