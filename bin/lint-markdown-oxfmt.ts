#!/usr/bin/env node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, stripVTControlCharacters } from 'node:util';

import {
  findCodeBlocks,
  writeCodeBlockChanges,
  JS_LANGS,
  JSON5_LANGS,
  Problems,
  TS_LANGS,
} from '../lib/code-blocks.js';
import type { CodeBlock } from '../lib/code-blocks.js';
import { resolveBin, spawnAsync } from '../lib/helpers.js';
import { DocsWorkspace } from '../lib/markdown.js';

interface Options {
  config?: string;
  fix?: boolean;
  ignoreGlobs?: string[];
}

// A parse error in the report oxfmt prints to stderr, which looks like this,
// or with colour forced on (like when the CI environment variable is around)
// the same with ANSI escapes and Unicode box-drawing characters:
//
//   x Unexpected token
//    ,-[/tmp/lint-roller-oxfmt-1a2B3c/blocks/4-docs-api-app-md-56.js:2:3]
const PARSE_ERROR = /^[ \t]*[x×][ \t]+(.+)\r?\n[ \t]*(?:,-|╭─)\[(.+):\d+:\d+\]/gm;

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
 * Formats the files in `dir` in place, returning the parse error message
 * for each of the files (by basename) which could not be formatted
 */
async function runOxfmt(
  oxfmtBin: string,
  dir: string,
  { config, ignorePath }: { config?: string; ignorePath: string },
): Promise<Map<string, string>> {
  // The config is found from the working directory when not given one - as
  // would the ignore files be, which are of no use here and might even
  // match the temp files, hence the empty stand-in
  const args = [oxfmtBin, '--ignore-path', ignorePath];

  if (config) {
    args.push('--config', path.resolve(config));
  }

  args.push(dir);

  const result = await spawnAsync(process.execPath, args);
  const stderr = stripVTControlCharacters(result.stderr);
  const errors = new Map<string, string>();

  for (const [, message, file] of stderr.matchAll(PARSE_ERROR)) {
    const name = path.basename(file);

    // Only the first error in each file is of interest
    if (!errors.has(name)) {
      errors.set(name, message);
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

async function main(
  workspaceRoot: string,
  globs: string[],
  { config, fix = false, ignoreGlobs = [] }: Options,
) {
  const oxfmtBin = resolveBin('oxfmt');
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const problems = new Problems();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-roller-oxfmt-'));

  try {
    const ignorePath = path.join(tempDir, 'ignore');
    const blocksDir = path.join(tempDir, 'blocks');

    fs.writeFileSync(ignorePath, '');
    fs.mkdirSync(blocksDir);

    // Keyed by the basename of the temp file the block was written to
    const blocks = new Map<string, CodeBlock>();

    for (const block of await findCodeBlocks(
      workspace,
      [...JS_LANGS, ...TS_LANGS, ...JSON5_LANGS],
      problems,
      { skipTag: '@noformat' },
    )) {
      // Name the file after the original Markdown file and the starting
      // line number of the code block so that any stray output from oxfmt
      // is understandable - the counter prefix guarantees it is unique
      const name = `${blocks.size}-${block.filepath.replace(/[^\w-]/g, '-')}-${block.line}.${block.ext}`;

      fs.writeFileSync(path.join(blocksDir, name), `${block.value.trim()}\n`);
      blocks.set(name, block);
    }

    const errors = blocks.size
      ? await runOxfmt(oxfmtBin, blocksDir, { config, ignorePath })
      : new Map<string, string>();
    const changes = new Map<CodeBlock, string>();

    for (const [name, block] of blocks) {
      const error = errors.get(name);

      if (error) {
        problems.add(block.filepath, {
          line: block.line,
          column: block.column,
          message: `Code block could not be parsed: ${error} (oxfmt)`,
        });
        continue;
      }

      // Line endings are matched to the Markdown file when writing
      // changes so drop any carriage returns the config asked for
      const formatted = stripLeadingSemicolonGuard(
        fs
          .readFileSync(path.join(blocksDir, name), 'utf8')
          .replace(/\r\n?/g, '\n')
          .replace(/\n$/, ''),
        block.value.trim(),
      );

      if (formatted === block.value) {
        continue;
      }

      if (fix) {
        changes.set(block, formatted);
      } else {
        problems.add(block.filepath, {
          line: block.line,
          column: block.column,
          message: 'Code block is not formatted (oxfmt)',
        });
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
