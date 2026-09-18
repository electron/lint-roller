#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { FormatConfig } from 'oxfmt';

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
import { parseJSONC } from '../lib/helpers.js';
import { DocsWorkspace } from '../lib/markdown.js';

interface Options {
  config?: string;
  fix?: boolean;
  ignoreGlobs?: string[];
}

type Oxfmt = typeof import('oxfmt');

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

async function loadOxfmt(): Promise<Oxfmt> {
  try {
    return await import('oxfmt');
  } catch (cause) {
    throw new Error(
      'Could not import "oxfmt" - it must be installed alongside @electron/lint-roller to use lint-roller-markdown-oxfmt',
      { cause },
    );
  }
}

async function loadConfig(
  { format }: Oxfmt,
  configPath: string | undefined,
): Promise<FormatConfig> {
  let resolved: string | undefined;

  if (configPath) {
    resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`oxfmt config not found at ${resolved}`);
    }
  } else {
    resolved = ['.oxfmtrc.json', '.oxfmtrc.jsonc']
      .map((name) => path.resolve(name))
      .find((candidate) => fs.existsSync(candidate));
  }

  if (!resolved) {
    return {};
  }

  let config: Record<string, unknown>;

  try {
    config = parseJSONC(fs.readFileSync(resolved, 'utf8')) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`Could not parse oxfmt config at ${resolved}`, { cause });
  }

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`Invalid oxfmt config at ${resolved}: expected an object`);
  }

  // These only make sense when oxfmt is discovering files itself
  delete config.$schema;
  delete config.ignorePatterns;
  delete config.overrides;

  // Line endings are matched to the Markdown file when writing changes
  config.endOfLine = 'lf';

  // Surface any complaints about the config once up front rather than
  // for every code block
  const { errors } = await format('config-check.js', '', config as FormatConfig);

  if (errors.length) {
    throw new Error(`Invalid oxfmt config at ${resolved}: ${errors[0].message}`);
  }

  return config as FormatConfig;
}

/**
 * Converts a UTF-8 byte offset (as reported in oxfmt errors)
 * into a 0-based line and column within `text`
 */
function offsetToPosition(text: string, offset: number) {
  const lines = Buffer.from(text).subarray(0, Math.max(0, offset)).toString().split('\n');
  return { line: lines.length - 1, column: lines[lines.length - 1].length };
}

async function main(
  workspaceRoot: string,
  globs: string[],
  { config, fix = false, ignoreGlobs = [] }: Options,
) {
  const oxfmt = await loadOxfmt();
  const formatConfig = await loadConfig(oxfmt, config);
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const problems = new Problems();
  const changes = new Map<CodeBlock, string>();

  const formatBlock = async (
    block: CodeBlock,
  ): Promise<{ problem: Problem } | { formatted: string } | undefined> => {
    const { value } = block;
    const fileName = `code-block.${block.ext}`;
    const format = (text: string) => oxfmt.format(fileName, `${text}\n`, formatConfig);

    // Whitespace just inside the code fences is dropped when formatting,
    // but is needed to map parse errors back to their original position
    const leadingWhitespace = /^\s*/.exec(value)![0];
    const leadingBlankLines = leadingWhitespace.split('\n').length - 1;
    const firstLineIndent = leadingWhitespace.length - leadingWhitespace.lastIndexOf('\n') - 1;
    const body = value.trim();

    // Bare object literals need to be wrapped in parens to be parsed as an
    // expression, and the only sure way to find that wrapping in formatted
    // output to undo it is for it to be the whole output, so format those
    // separately from the code around them and stitch it all back together
    const orphans = findOrphanObjects(body);
    let formatted: string | undefined;
    let error: { position: { line: number; column: number }; message: string } | undefined;

    if (orphans.length) {
      const parts: string[] = [];

      for (const segment of splitIntoSegments(body, orphans)) {
        const { orphan, blankLineBefore } = segment;
        const text = orphan ? wrapOrphanObjects(segment.text, [orphan]) : segment.text;
        const result = await format(text);

        // Finding them is only a heuristic which might have made matters
        // worse by splitting mid-statement, so fall back to formatting as-is
        // but hang on to this (likely more accurate) error in case that fails
        if (result.errors.length) {
          const position = offsetToPosition(text, result.errors[0].labels[0]?.start ?? 0);

          if (orphan && position.line === 0) {
            position.column = Math.max(0, position.column - ORPHAN_OBJECT_PREFIX.length);
          }

          position.line += segment.line;
          error = { position, message: result.errors[0].message };
          parts.length = 0;
          break;
        }

        let code = result.code.replace(/\n$/, '');

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
      const result = await format(body);

      if (!result.errors.length) {
        formatted = stripLeadingSemicolonGuard(result.code.replace(/\n$/, ''), body);
      } else {
        error ??= {
          position: offsetToPosition(body, result.errors[0].labels[0]?.start ?? 0),
          message: result.errors[0].message,
        };

        return {
          problem: {
            line: block.line + 1 + leadingBlankLines + error.position.line,
            column:
              block.column +
              error.position.column +
              (error.position.line === 0 ? firstLineIndent : 0),
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
  };

  const blocks = await findCodeBlocks(workspace, [...JS_LANGS, ...TS_LANGS], problems);

  // Kick off formatting for everything but collect it in order
  for (const [idx, result] of (await Promise.all(blocks.map(formatBlock))).entries()) {
    if (result && 'problem' in result) {
      problems.add(blocks[idx].filepath, result.problem);
    } else if (result) {
      changes.set(blocks[idx], result.formatted);
    }
  }

  writeCodeBlockChanges(workspace, changes);

  return problems.print(workspaceRoot) > 0;
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
