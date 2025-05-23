#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { TextDocument, TextEdit, Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import {
  dynamicImport,
  removeParensWrappingOrphanedObject,
  wrapOrphanObjectInParens,
} from '../lib/helpers.js';
import { getCodeBlocks, DocsWorkspace } from '../lib/markdown.js';

interface Options {
  fix?: boolean;
  ignoreGlobs?: string[];
  semi?: boolean;
}

interface LintMessage {
  ruleId: string;
  message: string;
  line: number;
  column: number;
}

interface LintResult {
  filePath: string;
  messages: LintMessage[];
  errorCount: number;
  warningCount: number;
  output?: string;
}

const DISABLED_RULES = [
  'no-labels',
  'no-lone-blocks',
  'no-undef',
  'no-unused-expressions',
  'no-unused-vars',
  'n/no-callback-literal',
];

async function main(
  workspaceRoot: string,
  globs: string[],
  { fix = false, ignoreGlobs = [], semi = false }: Options,
) {
  const { default: standard } = await dynamicImport('standard');

  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);

  let lastFilePath: string | undefined;
  let totalErrors = 0;

  for (const document of await workspace.getAllMarkdownDocuments()) {
    const uri = URI.parse(document.uri);
    const filepath = workspace.getWorkspaceRelativePath(uri);
    const changes: TextEdit[] = [];

    const jsCodeBlocks = (await getCodeBlocks(document.getText())).filter(
      (code) => code.lang && ['javascript', 'js'].includes(code.lang.toLowerCase()),
    );

    for (const codeBlock of jsCodeBlocks) {
      if (codeBlock.lang && codeBlock.lang.toLowerCase() !== codeBlock.lang) {
        totalErrors += 1;

        if (filepath !== lastFilePath) {
          console.log(`\n   ${filepath}`);
          lastFilePath = filepath;
        }

        const line = codeBlock.position!.start.line;
        const column = codeBlock.position!.start.column;
        const lineInfo = `${line}:${column}: `.padEnd(10);
        console.log(`         ${lineInfo}Code block language identifier should be all lowercase`);
      }

      // Skip blocks with @nolint in their info string
      if (codeBlock.meta?.split(' ').includes('@nolint')) {
        continue;
      }

      // Skip empty code blocks
      if (!codeBlock.value.trim()) {
        continue;
      }

      const eslintComments = [`/* eslint-disable ${DISABLED_RULES.join(', ')} */`];
      const wrappedText = wrapOrphanObjectInParens(codeBlock.value);

      // Don't enforce semis if it's an orphan object
      if (semi && wrappedText === codeBlock.value) {
        eslintComments.push('/* eslint semi: ["error", "always"] */');
      }

      const results: LintResult[] = await standard.lintText(
        `${eslintComments.join('\n')}\n${wrappedText}\n`,
        fix ? { fix: true } : undefined,
      );

      for (const result of results) {
        totalErrors += result.errorCount + result.warningCount;

        for (const message of result.messages) {
          if (filepath !== lastFilePath) {
            console.log(`\n   ${filepath}`);
            lastFilePath = filepath;
          }

          const line = codeBlock.position!.start.line - 1;
          const indent = codeBlock.position!.start.column - 1;
          const lineInfo = `${line + message.line}:${indent + message.column}: `.padEnd(10);
          console.log(`         ${lineInfo}${message.message}`);
        }

        if (fix && result.output) {
          const position = codeBlock.position!;

          // Strip off the eslint comments at the start of the text
          let newText = removeParensWrappingOrphanedObject(
            result.output.split('\n').slice(eslintComments.length).join('\n'),
          );

          // Code block might be indented - only indent non-blank lines
          if (position.start.column > 1) {
            newText = newText
              .split('\n')
              .map((line) =>
                line.length ? line.padStart(line.length + position.start.column - 1) : line,
              )
              .join('\n');
          }

          // The code block position includes the surrounding code fence,
          // so use the line numbers inside of the code fence. Note that
          // the code block positions are 1-based, but Range uses 0-based
          const range: Range = {
            start: {
              line: position.start.line,
              character: 0,
            },
            end: {
              line: position.end.line - 2,
              character: Number.POSITIVE_INFINITY,
            },
          };
          changes.push({ range, newText });
        }
      }
    }

    if (fix && changes.length) {
      console.log(`File has changed: ${workspace.getWorkspaceRelativePath(uri)}`);
      fs.writeFileSync(uri.fsPath, TextDocument.applyEdits(document, changes));
    }
  }

  console.log(`\nThere are ${totalErrors} errors in '${workspaceRoot}'`);

  return totalErrors > 0;
}

function parseCommandLine() {
  const showUsage = (): never => {
    console.log(
      'Usage: lint-roller-markdown-standard [--root <dir>] <globs> [-h|--help] [--fix]' +
        '[--ignore <globs>] [--ignore-path <path>] [--semi]',
    );
    process.exit(1);
  };

  try {
    const opts = parseArgs({
      allowPositionals: true,
      options: {
        fix: {
          type: 'boolean',
        },
        semi: {
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
    fix: opts.fix,
    ignoreGlobs: opts.ignore,
    semi: opts.semi,
  })
    .then((errors) => {
      if (errors) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
