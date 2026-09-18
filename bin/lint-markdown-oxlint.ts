#!/usr/bin/env node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  findCodeBlocks,
  findOrphanObjects,
  writeCodeBlockChanges,
  JS_LANGS,
  ORPHAN_OBJECT_PREFIX,
  Problems,
  TS_LANGS,
  unwrapOrphanObjects,
  wrapOrphanObjects,
} from '../lib/code-blocks.js';
import type { CodeBlock, LineRange } from '../lib/code-blocks.js';
import { spawnAsync } from '../lib/helpers.js';
import { DocsWorkspace } from '../lib/markdown.js';

interface Options {
  config?: string;
  fix?: boolean;
  ignoreGlobs?: string[];
  typescript?: boolean;
}

interface OxlintDiagnostic {
  message: string;
  code?: string;
  severity: string;
  filename: string;
  labels: { span: { line: number; column: number } }[];
}

interface OxlintOutput {
  diagnostics: OxlintDiagnostic[];
}

// Rules which don't make sense for isolated documentation snippets, where
// variables are routinely used without being declared (and vice versa)
// and a lone `key: value` line gets parsed as a labeled statement
const DISABLED_RULES = [
  'no-labels',
  'no-lone-blocks',
  'no-undef',
  'no-unused-expressions',
  'no-unused-labels',
  'no-unused-vars',
  'unicorn/no-empty-file',
];

// Matches the diagnostic code oxlint reports for the above, e.g.
// "eslint(no-unused-vars)" or "unicorn(no-empty-file)"
const DISABLED_RULE_CODE = new RegExp(
  `\\((?:${DISABLED_RULES.map((rule) => rule.split('/').pop()).join('|')})\\)$`,
);

const UNKNOWN_FILE = '<unknown>';

function resolveOxlintBin(): string {
  let pkgPath: string;

  try {
    pkgPath = fileURLToPath(import.meta.resolve('oxlint/package.json'));
  } catch {
    throw new Error(
      'Could not resolve "oxlint" - it must be installed alongside @electron/lint-roller to use lint-roller-markdown-oxlint',
    );
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.oxlint;

  if (!bin) {
    throw new Error('Could not determine the "oxlint" bin path from its package.json');
  }

  return path.join(path.dirname(pkgPath), bin);
}

async function runOxlint(
  oxlintBin: string,
  tempDir: string,
  { config, fix }: Pick<Options, 'config' | 'fix'>,
): Promise<OxlintDiagnostic[]> {
  const args = [oxlintBin, '--format=json'];

  if (config) {
    args.push('--config', path.resolve(config));
  }

  for (const rule of DISABLED_RULES) {
    args.push('-A', rule);
  }

  if (fix) {
    args.push('--fix');
  }

  args.push(tempDir);

  const { status, stdout, stderr } = await spawnAsync(process.execPath, args);

  let output: OxlintOutput;

  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error(
      `oxlint exited with status ${status} and unexpected output:\n${stderr || stdout}`,
    );
  }

  // Belt-and-braces with the -A flags above since `overrides` in the
  // user's config are applied after those and may turn them back on
  return output.diagnostics.filter(({ code }) => !code || !DISABLED_RULE_CODE.test(code));
}

async function main(
  workspaceRoot: string,
  globs: string[],
  { config, fix = false, ignoreGlobs = [], typescript = false }: Options,
) {
  const oxlintBin = resolveOxlintBin();
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const problems = new Problems();
  const langs = typescript ? [...JS_LANGS, ...TS_LANGS] : JS_LANGS;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-roller-oxlint-'));

  try {
    // Keyed by the basename of the temp file the block was written to, with
    // the bare object literals that got wrapped so that can be undone again
    const blocks = new Map<string, { block: CodeBlock; tempFile: string; orphans: LineRange[] }>();

    for (const block of await findCodeBlocks(workspace, langs, problems, { checkCase: true })) {
      const orphans = findOrphanObjects(block.value);
      const text = wrapOrphanObjects(block.value, orphans);

      // Name the file after the original Markdown file and the starting
      // line number of the code block so that any stray output from oxlint
      // is understandable - the counter prefix guarantees it is unique
      const tempFile = path.join(
        tempDir,
        `${blocks.size}-${block.filepath.replace(/[^\w-]/g, '-')}-${block.line}.${block.ext}`,
      );

      fs.writeFileSync(tempFile, `${text}\n`);
      blocks.set(path.basename(tempFile), { block, tempFile, orphans });
    }

    if (blocks.size) {
      for (const diagnostic of await runOxlint(oxlintBin, tempDir, { config, fix })) {
        const entry = blocks.get(path.basename(diagnostic.filename));
        const span = diagnostic.labels[0]?.span ?? { line: 1, column: 1 };
        const rule = diagnostic.code ? ` [${diagnostic.code}]` : '';

        if (!entry) {
          problems.add(UNKNOWN_FILE, {
            line: span.line,
            column: span.column,
            message: `${diagnostic.filename}: ${diagnostic.message}${rule}`,
          });
          continue;
        }

        // The code block position is the position of the opening code
        // fence so the first line of code is one after that, which
        // matches up nicely with the 1-based line from oxlint. Columns
        // need adjusting back on the lines where a literal got wrapped.
        const isPrefixed = entry.orphans.some(({ start }) => span.line === start + 1);

        problems.add(entry.block.filepath, {
          line: entry.block.line + span.line,
          column:
            entry.block.column - 1 + span.column - (isPrefixed ? ORPHAN_OBJECT_PREFIX.length : 0),
          message: `${diagnostic.message}${rule}`,
        });
      }
    }

    if (fix) {
      const changes = new Map<CodeBlock, string>();

      for (const { block, tempFile, orphans } of blocks.values()) {
        const fixed = unwrapOrphanObjects(
          fs.readFileSync(tempFile, 'utf8').replace(/\n$/, ''),
          orphans,
        );

        // Punt to the user in the unlikely event a fix moved the wrapping
        if (fixed !== undefined) {
          changes.set(block, fixed);
        } else {
          problems.add(block.filepath, {
            line: block.line,
            column: block.column,
            message: 'Could not apply the fixes for this code block, they need making by hand',
          });
        }
      }

      writeCodeBlockChanges(workspace, changes);
    }

    return problems.print(workspaceRoot) > 0;
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

function parseCommandLine() {
  const showUsage = (): never => {
    console.log(
      'Usage: lint-roller-markdown-oxlint [--root <dir>] <globs> [-h|--help] [--fix] ' +
        '[--ignore <globs>] [--ignore-path <path>] [--config <path>] [--typescript]',
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
        typescript: {
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
    typescript: opts.typescript,
  })
    .then((errors) => {
      if (errors) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
