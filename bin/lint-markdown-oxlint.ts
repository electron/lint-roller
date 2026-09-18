#!/usr/bin/env node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { TextDocument, TextEdit, Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import type { FormatConfig } from 'oxfmt';

import {
  parseJSONC,
  removeParensWrappingOrphanedObject,
  spawnAsync,
  wrapOrphanObjectInParens,
} from '../lib/helpers.js';
import { getCodeBlocks, DocsWorkspace } from '../lib/markdown.js';
import type { Code } from '../lib/markdown.js';

interface Options {
  config?: string;
  fix?: boolean;
  ignoreGlobs?: string[];
  oxfmt?: boolean;
  oxfmtConfig?: string;
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

interface Block {
  filepath: string;
  document: TextDocument;
  codeBlock: Code;
  value: string;
  tempFile: string;
  isOrphanObject: boolean;
}

interface Problem {
  line: number;
  column: number;
  message: string;
}

const JS_LANGS = ['javascript', 'js', 'cjs', 'mjs'];
const TS_LANGS = ['typescript', 'ts', 'cts', 'mts'];

// Rules which don't make sense for isolated documentation snippets, where
// variables are routinely used without being declared (and vice versa)
const DISABLED_RULES = [
  'no-labels',
  'no-lone-blocks',
  'no-undef',
  'no-unused-expressions',
  'no-unused-vars',
  'node/no-callback-literal',
  'unicorn/no-empty-file',
];

// Matches the diagnostic code oxlint reports for the above, e.g.
// "eslint(no-unused-vars)" or "eslint-plugin-node(no-callback-literal)"
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

async function loadOxfmt(): Promise<typeof import('oxfmt')> {
  try {
    return await import('oxfmt');
  } catch {
    throw new Error(
      'Could not import "oxfmt" - it must be installed alongside @electron/lint-roller to use --oxfmt',
    );
  }
}

function loadOxfmtConfig(configPath: string | undefined): FormatConfig {
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
  } catch {
    throw new Error(`Couldn't parse oxfmt config at ${resolved}`);
  }

  // These only make sense when oxfmt is discovering files itself
  delete config.$schema;
  delete config.ignorePatterns;
  delete config.overrides;

  return config as FormatConfig;
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
  {
    config,
    fix = false,
    ignoreGlobs = [],
    oxfmt = false,
    oxfmtConfig,
    typescript = false,
  }: Options,
) {
  const oxlintBin = resolveOxlintBin();
  const formatter = oxfmt ? await loadOxfmt() : undefined;
  const formatConfig = oxfmt ? loadOxfmtConfig(oxfmtConfig) : {};

  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-roller-oxlint-'));

  const langs = typescript ? [...JS_LANGS, ...TS_LANGS] : JS_LANGS;

  try {
    const blocks = new Map<string, Block>();
    const problems = new Map<string, Problem[]>([[UNKNOWN_FILE, []]]);
    const filepaths: string[] = [];

    const addProblem = (filepath: string, problem: Problem) => {
      problems.get(filepath)!.push(problem);
    };

    for (const document of await workspace.getAllMarkdownDocuments()) {
      const uri = URI.parse(document.uri);
      const filepath = workspace.getWorkspaceRelativePath(uri);

      filepaths.push(filepath);
      problems.set(filepath, []);

      const codeBlocks = (await getCodeBlocks(document.getText())).filter(
        (code) => code.lang && langs.includes(code.lang.toLowerCase()),
      );

      for (const codeBlock of codeBlocks) {
        const lang = codeBlock.lang!.toLowerCase();
        const line = codeBlock.position!.start.line;
        const column = codeBlock.position!.start.column;

        if (codeBlock.lang !== lang) {
          addProblem(filepath, {
            line,
            column,
            message: 'Code block language identifier should be all lowercase',
          });
        }

        // Skip blocks with @nolint in their info string
        if (codeBlock.meta?.split(' ').includes('@nolint')) {
          continue;
        }

        // Line endings are normalized here and restored when writing fixes
        const value = codeBlock.value.replace(/\r$/gm, '');

        // Skip empty code blocks
        if (!value.trim()) {
          continue;
        }

        const wrappedText = wrapOrphanObjectInParens(value);
        const ext = lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : lang;

        // Name the file after the original Markdown file and the starting
        // line number of the code block so that any stray output from oxlint
        // is understandable - the counter prefix guarantees it is unique
        const tempFile = path.join(
          tempDir,
          `${blocks.size}-${filepath.replace(/[^\w-]/g, '-')}-${line}.${ext}`,
        );

        fs.writeFileSync(tempFile, `${wrappedText}\n`);

        blocks.set(path.basename(tempFile), {
          filepath,
          document,
          codeBlock,
          value,
          tempFile,
          // Only consider it an orphan object/array if that's the whole block,
          // if only some lines got wrapped then round-tripping it through the
          // formatter won't work so treat it as regular code there
          isOrphanObject: wrappedText === `(${value})`,
        });
      }
    }

    if (blocks.size) {
      for (const diagnostic of await runOxlint(oxlintBin, tempDir, { config, fix })) {
        const block = blocks.get(path.basename(diagnostic.filename));
        const span = diagnostic.labels[0]?.span ?? { line: 1, column: 1 };
        const rule = diagnostic.code ? ` [${diagnostic.code}]` : '';

        if (!block) {
          addProblem(UNKNOWN_FILE, {
            line: span.line,
            column: span.column,
            message: `${diagnostic.filename}: ${diagnostic.message}${rule}`,
          });
          continue;
        }

        // The code block position is the position of the opening code
        // fence so the first line of code is one after that, which
        // matches up nicely with the 1-based line from oxlint
        addProblem(block.filepath, {
          line: block.codeBlock.position!.start.line + span.line,
          column: block.codeBlock.position!.start.column - 1 + span.column,
          message: `${diagnostic.message}${rule}`,
        });
      }
    }

    const changes = new Map<TextDocument, TextEdit[]>();

    for (const block of blocks.values()) {
      const { codeBlock, document, filepath, isOrphanObject, value } = block;
      const position = codeBlock.position!;
      const wasWrapped = wrapOrphanObjectInParens(value) !== value;

      // The current content of the code block, as it would appear in the doc
      let text = value;

      if (fix) {
        text = fs.readFileSync(block.tempFile, 'utf8').replace(/\n$/, '');
        if (wasWrapped) {
          text = removeParensWrappingOrphanedObject(text);
        }
      }

      // See comment on `isOrphanObject` above about partially wrapped blocks
      if (formatter && (isOrphanObject || !wasWrapped)) {
        const { code, errors } = await formatter.format(
          block.tempFile,
          `${isOrphanObject ? `(${text})` : text}\n`,
          formatConfig,
        );

        // Any parsing errors will already have been reported by oxlint
        if (!errors.length) {
          let formatted = code.replace(/\n$/, '');

          // With "semi: false" style the formatter guards a leading paren,
          // bracket, or backtick with a semicolon, which is just noise at
          // the start of a documentation snippet, so strip that back off
          if (formatted.startsWith(';') && !text.startsWith(';')) {
            formatted = formatted.slice(1);
          }

          // Orphan objects/arrays were wrapped in parens which the formatter
          // may have kept, and with "semi: true" style will have followed
          // with a semicolon - strip that all back off again too
          if (isOrphanObject) {
            formatted = removeParensWrappingOrphanedObject(formatted.replace(/;$/, ''));
          }

          if (formatted !== text) {
            if (fix) {
              text = formatted;
            } else {
              // Report the first line which differs to give the user a hint
              const lines = text.split('\n');
              const idx = formatted.split('\n').findIndex((line, idx) => line !== lines[idx]);

              addProblem(filepath, {
                line: position.start.line + 1 + Math.max(0, idx),
                column: position.start.column,
                message: 'Code block is not formatted (oxfmt)',
              });
            }
          }
        }
      }

      if (fix && text !== value) {
        const eol = document.getText().includes('\r\n') ? '\r\n' : '\n';

        // Code block might be indented or in a blockquote, so grab whatever
        // preceded the opening code fence and use that to prefix each line,
        // with trailing whitespace trimmed for blank lines. Note that the
        // code block positions are 1-based, but Range uses 0-based
        const prefix = document.getText({
          start: { line: position.start.line - 1, character: 0 },
          end: { line: position.start.line - 1, character: position.start.column - 1 },
        });
        const blankPrefix = prefix.trimEnd();
        const newText = text
          .split('\n')
          .map((line) => (line.length ? `${prefix}${line}` : blankPrefix))
          .join(eol);

        // The code block position includes the surrounding code fences,
        // so replace everything from the start of the first line inside
        // them up to the start of the line with the closing code fence
        const range: Range = {
          start: { line: position.start.line, character: 0 },
          end: { line: position.end.line - 1, character: 0 },
        };

        const edits = changes.get(document) ?? [];
        edits.push({ range, newText: `${newText}${eol}` });
        changes.set(document, edits);
      }
    }

    for (const [document, edits] of changes) {
      const uri = URI.parse(document.uri);
      console.log(`File has changed: ${workspace.getWorkspaceRelativePath(uri)}`);
      fs.writeFileSync(uri.fsPath, TextDocument.applyEdits(document, edits));
    }

    let totalErrors = 0;

    for (const filepath of [...filepaths, UNKNOWN_FILE]) {
      const fileProblems = problems.get(filepath)!;

      if (!fileProblems.length) {
        continue;
      }

      totalErrors += fileProblems.length;
      fileProblems.sort((a, b) => a.line - b.line || a.column - b.column);

      console.log(`\n   ${filepath}`);

      for (const problem of fileProblems) {
        const lineInfo = `${problem.line}:${problem.column}: `.padEnd(10);
        console.log(`         ${lineInfo}${problem.message}`);
      }
    }

    console.log(`\nThere are ${totalErrors} errors in '${workspaceRoot}'`);

    return totalErrors > 0;
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

function parseCommandLine() {
  const showUsage = (): never => {
    console.log(
      'Usage: lint-roller-markdown-oxlint [--root <dir>] <globs> [-h|--help] [--fix] ' +
        '[--ignore <globs>] [--ignore-path <path>] [--config <path>] [--typescript] ' +
        '[--oxfmt] [--oxfmt-config <path>]',
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
        oxfmt: {
          type: 'boolean',
        },
        'oxfmt-config': {
          type: 'string',
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
    oxfmt: opts.oxfmt || !!opts['oxfmt-config'],
    oxfmtConfig: opts['oxfmt-config'],
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
