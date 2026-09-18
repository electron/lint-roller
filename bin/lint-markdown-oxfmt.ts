#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { FormatConfig } from 'oxfmt';

import {
  findCodeBlocks,
  writeCodeBlockChanges,
  JS_LANGS,
  Problems,
  TS_LANGS,
} from '../lib/code-blocks.js';
import type { CodeBlock } from '../lib/code-blocks.js';
import { parseJSONC } from '../lib/helpers.js';
import { DocsWorkspace } from '../lib/markdown.js';

interface Options {
  config?: string;
  fix?: boolean;
  ignoreGlobs?: string[];
}

type Oxfmt = typeof import('oxfmt');

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

  for (const block of await findCodeBlocks(workspace, [...JS_LANGS, ...TS_LANGS], problems)) {
    const { value } = block;
    const fileName = `code-block.${block.ext}`;

    // Blank lines just inside the code fences are dropped when formatting
    const leadingBlankLines = /^\s*/.exec(value)![0].split('\n').length - 1;
    const body = value.trim();

    // A code block which is just an object (or array) literal needs to be
    // wrapped in parens so that it parses as an expression rather than a
    // block statement, but fall back to formatting it as-is if that fails
    // since code with a leading array literal can look the same
    let isOrphanObject = /^[[{][\s\S]*[\]}]$/.test(body);
    let result = await oxfmt.format(
      fileName,
      `${isOrphanObject ? `(${body})` : body}\n`,
      formatConfig,
    );

    if (isOrphanObject && result.errors.length) {
      isOrphanObject = false;
      result = await oxfmt.format(fileName, `${body}\n`, formatConfig);
    }

    if (result.errors.length) {
      const [error] = result.errors;
      const position = offsetToPosition(body, error.labels[0]?.start ?? 0);

      problems.add(block.filepath, {
        line: block.line + 1 + leadingBlankLines + position.line,
        column: block.column + position.column,
        message: `${error.message} (oxfmt)`,
      });
      continue;
    }

    let formatted = result.code.replace(/\n$/, '');

    // With "semi: false" style the formatter guards a leading paren,
    // bracket, or backtick with a semicolon, which is just noise at
    // the start of a documentation snippet, so strip that back off
    if (formatted.startsWith(';') && !body.startsWith(';')) {
      formatted = formatted.slice(1);
    }

    // Orphan objects were wrapped in parens which the formatter will have
    // kept, and with "semi: true" style will have followed with a
    // semicolon, so strip that all back off again
    if (isOrphanObject) {
      formatted = formatted.replace(/;$/, '');
      if (formatted.startsWith('(') && formatted.endsWith(')')) {
        formatted = formatted.slice(1, -1);
      }
    }

    if (formatted === value) {
      continue;
    }

    if (fix) {
      changes.set(block, formatted);
    } else {
      // Report the first line which differs to give the user a hint
      const lines = value.split('\n');
      const formattedLines = formatted.split('\n');
      let idx = formattedLines.findIndex((line, idx) => line !== lines[idx]);

      // No difference within the formatted output means the original
      // has extra trailing lines, so point at the first of those
      if (idx === -1) {
        idx = formattedLines.length;
      }

      problems.add(block.filepath, {
        line: block.line + 1 + idx,
        column: block.column,
        message: 'Code block is not formatted (oxfmt)',
      });
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
