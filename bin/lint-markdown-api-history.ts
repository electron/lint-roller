#!/usr/bin/env node

// ? Optimize these imports
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as minimist from 'minimist';

import { DocsWorkspace } from '../lib/markdown';
import { URI } from 'vscode-uri';
import { parse as parseYaml } from 'yaml';

import type { HTML } from 'mdast';
import type { Node, Literal } from 'unist';
import type { visit as VisitFunction } from 'unist-util-visit';
import type { fromMarkdown as FromMarkdownFunction } from 'mdast-util-from-markdown';
import { dynamicImport } from '../lib/helpers';
import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';

const apiHistoryRegex: RegExp = /<!--\r?\n(```YAML history\r?\n([\s\S]*?)\r?\n```)\r?\n-->/g;

interface ChangeSchema {
  'pr-url': string;
  'breaking-changes-header'?: string;
  description?: string;
}

interface ApiHistory {
  added?: ChangeSchema[];
  deprecated?: ChangeSchema[];
  removed?: ChangeSchema[];
  changes?: ChangeSchema[];
}

// TODO: Add option for CI to use to validate the PR that triggered the CI run
interface Options {
  checkPlacement?: boolean;
  checkPullRequestLinks?: boolean;
  checkBreakingChangesHeaders?: boolean;
  checkDescriptions?: boolean;
  validateWithSchema?: boolean;
  ignoreGlobs?: string[];
}

export async function findPossibleApiHistoryBlocks(content: string): Promise<HTML[]> {
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
    // Very loose check for YAML history blocks to help catch user error
    (node) =>
      node.type === 'html' &&
      (node as Literal<string>).value.toLowerCase().includes('```') &&
      (node as Literal<string>).value.toLowerCase().includes('yaml') &&
      (node as Literal<string>).value.toLowerCase().includes('history'),
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
    checkPlacement,
    checkPullRequestLinks,
    checkBreakingChangesHeaders,
    checkDescriptions,
    validateWithSchema,
    ignoreGlobs = [],
  }: Options,
) {
  let documentCounter = 0;
  let historyBlockCounter = 0;
  let errorCounter = 0;

  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);

  let validateAgainstSchema: ValidateFunction<ApiHistory> | null = null;

  if (validateWithSchema) {
    try {
      const ajv = new Ajv();
      // TODO: Allow user to provide path to schema file
      const ApiHistorySchemaFile = fs.readFileSync(
        path.resolve(__dirname, '../../', 'api-history.schema.json'),
        { encoding: 'utf-8' },
      );
      const ApiHistorySchema = JSON.parse(ApiHistorySchemaFile) as JSONSchemaType<ApiHistory>;
      validateAgainstSchema = ajv.compile(ApiHistorySchema);
    } catch (error) {
      console.error(`Error reading API history schema: ${error}`);
      return true;
    }
  }

  // Collect diagnostics for all documents in the workspace
  for (const document of await workspace.getAllMarkdownDocuments()) {
    const uri = URI.parse(document.uri);
    const filepath = workspace.getWorkspaceRelativePath(uri);

    documentCounter++;

    const possibleHistoryBlocks = await findPossibleApiHistoryBlocks(document.getText());

    for (const possibleHistoryBlock of possibleHistoryBlocks) {
      historyBlockCounter++;

      const regexMatchIterator = possibleHistoryBlock.value.matchAll(apiHistoryRegex);
      const regexMatches = Array.from(regexMatchIterator);

      if (regexMatches.length !== 1 || regexMatches[0].length !== 3) {
        console.error(
          `Error parsing ${filepath}\nCouldn't extract matches from possible history block, did you use the correct format?:\n${possibleHistoryBlock.value}`,
        );
        errorCounter++;
        continue;
      }

      const historyYaml = regexMatches[0][2];

      let unsafeHistory = null;

      try {
        unsafeHistory = parseYaml(historyYaml);
      } catch (error) {
        console.error(
          `Error parsing\n${possibleHistoryBlock.value}\nin: ${filepath}\n(YAML) ${error}`,
        );
        errorCounter++;
        continue;
      }

      if (!validateWithSchema || validateAgainstSchema === null) continue;

      const isValid = validateAgainstSchema(unsafeHistory);

      if (!isValid) {
        console.error(
          `Error validating YAML:\n${possibleHistoryBlock.value}\nin: ${filepath}\n${JSON.stringify(unsafeHistory, null, 4)}\n${JSON.stringify(validateAgainstSchema.errors, null, 4)}`,
        );
        errorCounter++;
        continue;
      }

      // ? Maybe collect all api history and export it to a single file for future use.
    }

    // TODO: Replace user YAML with result of <https://eemeli.org/yaml/#tostring-options> for consistent style (but not in CI)
  }

  console.log(
    `Processed ${historyBlockCounter} API history block(s) in ${documentCounter} document(s) with ${errorCounter} error(s).`,
  );

  return errorCounter > 0;
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
    default: {
      'check-placement': true,
      'check-pull-request-links': false,
      'check-breaking-changes-headers': false,
      'check-descriptions': false,
      'validate-with-schema': true,
    },
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
