#!/usr/bin/env node

import { readFile, access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as minimist from 'minimist';

import { DocsWorkspace } from '../lib/markdown';
import { URI } from 'vscode-uri';
import { parse as parseYaml } from 'yaml';

import type { HTML } from 'mdast';
import type { Node, Literal } from 'unist';
import type { visit as VisitFunction } from 'unist-util-visit';
import type { fromHtml as FromHtmlFunction } from 'hast-util-from-html';
import type { fromMarkdown as FromMarkdownFunction } from 'mdast-util-from-markdown';
import { dynamicImport } from '../lib/helpers';
import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';

interface ChangeSchema {
  'pr-url': string;
  'breaking-changes-header'?: string;
  description?: string;
}

interface ApiHistory {
  added?: ChangeSchema[];
  deprecated?: ChangeSchema[];
  changes?: ChangeSchema[];
}

// TODO: Add option for CI to use to validate the PR that triggered the CI run
interface Options {
  checkPlacement: boolean;
  checkPullRequestLinks: boolean;
  checkBreakingChangesHeaders: boolean;
  checkDescriptions: boolean;
  ignoreGlobs: string[];
  schema: string;
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
    schema,
    ignoreGlobs = [],
  }: Options,
) {
  const { fromHtml } = (await dynamicImport('hast-util-from-html')) as {
    fromHtml: typeof FromHtmlFunction;
  };
  const { fromMarkdown } = (await dynamicImport('mdast-util-from-markdown')) as {
    fromMarkdown: typeof FromMarkdownFunction;
  };

  let documentCounter = 0;
  let historyBlockCounter = 0;
  let errorCounter = 0;

  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);

  let validateAgainstSchema: ValidateFunction<ApiHistory> | null = null;

  if (schema) {
    try {
      const ajv = new Ajv();
      const ApiHistorySchemaFile = await readFile(schema, { encoding: 'utf-8' });
      const ApiHistorySchema = JSON.parse(ApiHistorySchemaFile) as JSONSchemaType<ApiHistory>;
      validateAgainstSchema = ajv.compile(ApiHistorySchema);
    } catch (error) {
      console.error(`Error reading API history schema:\n${error}`);
      return true;
    }
  }

  for (const document of await workspace.getAllMarkdownDocuments()) {
    const uri = URI.parse(document.uri);
    const filepath = workspace.getWorkspaceRelativePath(uri);

    documentCounter++;

    const possibleHistoryBlocks = await findPossibleApiHistoryBlocks(document.getText());

    for (const possibleHistoryBlock of possibleHistoryBlocks) {
      historyBlockCounter++;

      const {
        children: [htmlComment],
      } = fromHtml(possibleHistoryBlock.value);

      if (htmlComment.type !== 'comment') continue;

      const {
        children: [codeBlock],
      } = fromMarkdown(htmlComment.value);

      if (
        codeBlock.type !== 'code' ||
        codeBlock.lang?.toLowerCase() !== 'yaml' ||
        codeBlock.meta?.trim() !== 'history'
      ) {
        console.error(
          `Error parsing ${filepath}\n
          Couldn't extract matches from possible history block, did you use the correct format?:\n
          ${possibleHistoryBlock.value}`,
        );
        errorCounter++;
        continue;
      }

      let unsafeHistory = null;

      try {
        unsafeHistory = parseYaml(codeBlock.value);
      } catch (error) {
        console.error(
          `Error parsing\n
          ${possibleHistoryBlock.value}\n
          in: ${filepath}\n
          (YAML) ${error}`,
        );
        errorCounter++;
        continue;
      }

      if (!schema || validateAgainstSchema === null) continue;

      const isValid = validateAgainstSchema(unsafeHistory);

      if (!isValid) {
        console.error(
          `Error validating YAML:\n
          ${possibleHistoryBlock.value}\n
          in: ${filepath}\n
          ${JSON.stringify(unsafeHistory, null, 4)}\n
          ${JSON.stringify(validateAgainstSchema.errors, null, 4)}`,
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
        'Usage: lint-roller-markdown-api-history [--root <dir>] <globs>' +
          ' [-h|--help]' +
          ' [--check-placement] [--check-pull-request-links] [--check-breaking-changes-headers] [--check-descriptions]' +
          ' [--schema <path>]' +
          ' [--ignore <globs>] [--ignore-path <path>]',
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
    ],
    string: ['root', 'ignore', 'ignore-path', 'schema'],
    unknown: showUsage,
    default: {
      'check-placement': true,
      'check-pull-request-links': false,
      'check-breaking-changes-headers': false,
      'check-descriptions': false,
    },
  });

  if (opts.help || !opts._.length) showUsage();

  return opts;
}

async function init() {
  try {
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
      const ignores = await readFile(resolve(opts['ignore-path']), { encoding: 'utf-8' });

      for (const ignore of ignores.split('\n')) {
        opts.ignore.push(ignore.trimEnd());
      }
    }

    if (opts.schema) {
      opts.schema = resolve(process.cwd(), opts.schema);
      try {
        await access(opts.schema, constants.F_OK | constants.R_OK);
      } catch (error) {
        console.error(`Error accessing schema file: ${opts.schema}\n${error}`);
        process.exit(1);
      }
    }

    const errors = await main(resolve(process.cwd(), opts.root), opts._, {
      checkPlacement: opts['check-placement'],
      checkPullRequestLinks: opts['check-pull-request-links'],
      checkBreakingChangesHeaders: opts['check-breaking-changes-headers'],
      checkDescriptions: opts['check-descriptions'],
      ignoreGlobs: opts.ignore,
      schema: opts.schema,
    });

    if (errors) process.exit(1);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  init().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
