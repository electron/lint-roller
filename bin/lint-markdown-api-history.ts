#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as minimist from 'minimist';

import { DocsWorkspace, MarkdownParser } from '../lib/markdown';
import { TextDocument, TextEdit, Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { parse as parseYaml } from 'yaml';

import type { HTML } from 'mdast';
import type { Node, Literal } from 'unist';
import type { visit as VisitFunction } from 'unist-util-visit';
import type { fromMarkdown as FromMarkdownFunction } from 'mdast-util-from-markdown';
import { dynamicImport } from '../lib/helpers';

const apiHistoryRegex: RegExp = /<!--\r?\n(```YAML history\r?\n([\s\S]*?)\r?\n```)\r?\n-->/g;

// TODO: Add option for CI to use to validate the PR that triggered the CI run
interface Options {
  checkPlacement?: boolean;
  checkPullRequestLinks?: boolean;
  checkBreakingChangesHeaders?: boolean;
  checkDescriptions?: boolean;
  validateWithSchema?: boolean;
  ignoreGlobs?: string[];
}

export async function getApiHistoryBlocks(content: string): Promise<HTML[]> {
  const { fromMarkdown } = (await dynamicImport('mdast-util-from-markdown')) as {
    fromMarkdown: typeof FromMarkdownFunction;
  };
  const { visit } = (await dynamicImport('unist-util-visit')) as {
    visit: typeof VisitFunction;
  };
  const tree = fromMarkdown(content);
  const codeBlocks: HTML[] = [];

  visit(
    tree,
    // ! Don't use test() because it doesn't reset the regex state
    (node) =>
      node.type === 'html' && (node as Literal<string>).value.search(apiHistoryRegex) !== -1,
    (node: Node) => {
      codeBlocks.push(node as HTML);
    },
  );

  return codeBlocks;
}

async function main(
  workspaceRoot: string,
  globs: string[],
  {
    checkPlacement = true,
    checkPullRequestLinks = false,
    checkBreakingChangesHeaders = false,
    checkDescriptions = false,
    validateWithSchema = true,
    ignoreGlobs = [],
  }: Options,
) {
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const parser = new MarkdownParser();
  let errors = false;

  // Collect diagnostics for all documents in the workspace
  for (const document of await workspace.getAllMarkdownDocuments()) {
    const uri = URI.parse(document.uri);
    const filepath = workspace.getWorkspaceRelativePath(uri);
    const changes: TextEdit[] = [];

    const historyBlocks = await getApiHistoryBlocks(document.getText());

    for (const historyBlock of historyBlocks) {
      const regexMatchIterator = historyBlock.value.matchAll(apiHistoryRegex);
      const regexMatches = Array.from(regexMatchIterator);

      if (regexMatches.length !== 1 || regexMatches[0].length !== 3) {
        console.error(
          `Error parsing ${filepath}\nInternal error: Couldn't extract matches from history block`,
        );
        // ? Does this cause a memory leak? Maybe break for loop first.
        process.exit(1);
      }

      const historyYaml = regexMatches[0][2];

      try {
        const history = parseYaml(historyYaml);
        console.log(history);
      } catch (error) {
        console.error(`Error parsing ${filepath}\n(YAML) ${error}`);
        // ? Does this cause a memory leak? Maybe break for loop first.
        process.exit(1);
      }
    }

    // TODO: Replace user YAML with result of <https://eemeli.org/yaml/#tostring-options> for consistent style (but not in CI)
  }

  return errors;
}

function parseCommandLine() {
  const showUsage = (arg?: string): boolean => {
    if (!arg || arg.startsWith('-')) {
      console.log(
        'Usage: lint-roller-markdown-api-history [--root <dir>] <globs> [-h|--help] [--check-placement] ' +
          '[--check-pull-request-links] [--check-breaking-changes-headers] [--check-descriptions] [--validate-with-schema] [--ignore <globs>]',
      );
      process.exit(1);
    }

    return true;
  };

  const opts = minimist(process.argv.slice(2), {
    boolean: [
      'help',
      'check-placement',
      'check-pull-request-links',
      'check-breaking-changes-headers',
      'check-descriptions',
      'validate-with-schema',
    ],
    string: ['root', 'ignore', 'ignore-path'],
    unknown: showUsage,
  });

  if (opts.help || !opts._.length) showUsage();

  return opts;
}

if (require.main === module) {
  const opts = parseCommandLine();

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

  main(path.resolve(process.cwd(), opts.root), opts._, {
    checkPlacement: opts['check-placement'],
    checkPullRequestLinks: opts['check-pull-request-links'],
    checkBreakingChangesHeaders: opts['check-breaking-changes-headers'],
    checkDescriptions: opts['check-descriptions'],
    validateWithSchema: opts['validate-with-schema'],
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
