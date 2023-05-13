#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as minimist from 'minimist';

import { TextDocument, TextEdit, Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import {
  dynamicImport,
  removeParensWrappingOrphanedObject,
  wrapOrphanObjectInParens,
} from '../lib/helpers';
import { getCodeBlocks, DocsWorkspace } from '../lib/markdown';

interface Options {
  fix?: boolean;
  ignoreGlobs?: string[];
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
  { fix = false, ignoreGlobs = [] }: Options,
) {
  const { default: standard } = await dynamicImport('standard');

  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);

  let lastFilePath: string | undefined;
  let totalErrors = 0;

  for (const document of await workspace.getAllMarkdownDocuments()) {
    const uri = URI.parse(document.uri);
    const filepath = workspace.getWorkspaceRelativePath(uri);
    const changes: TextEdit[] = [];

    const jsCodeBlocks = (await getCodeBlocks(document)).filter(
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

      // Skip empty code blocks
      if (!codeBlock.value.trim()) {
        continue;
      }

      const eslintDisable = `/* eslint-disable ${DISABLED_RULES.join(', ')} */`;

      const results: LintResult[] = await standard.lintText(
        `${eslintDisable}\n${wrapOrphanObjectInParens(codeBlock.value)}\n`,
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
          const lineInfo = `${line + message.line}:${message.column}: `.padEnd(10);
          console.log(`         ${lineInfo}${message.message}`);
        }

        if (fix && result.output) {
          const newText = removeParensWrappingOrphanedObject(
            result.output.slice(`${eslintDisable}\n`.length),
          );

          // The code block position includes the surrounding code fence,
          // so use the line numbers inside of the code fence. Note that
          // the code block positions are 1-based, but Range uses 0-based
          const range: Range = {
            start: {
              line: codeBlock.position!.start.line,
              character: 0,
            },
            end: {
              line: codeBlock.position!.end.line - 2,
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
  const showUsage = (arg?: string): boolean => {
    if (!arg || arg.startsWith('-')) {
      console.log(
        'Usage: electron-lint-markdown-standard --root <dir> <globs> [-h|--help] [--fix]' +
          '[--ignore <globs>] [--ignore-path <path>]',
      );
      process.exit(1);
    }

    return true;
  };

  const opts = minimist(process.argv.slice(2), {
    boolean: ['help', 'fix'],
    string: ['root', 'ignore', 'ignore-path'],
    unknown: showUsage,
  });

  if (opts.help || !opts.root || !opts._.length) showUsage();

  return opts;
}

if (require.main === module) {
  const opts = parseCommandLine();

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

  main(path.resolve(process.cwd(), opts.root), opts._, {
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
