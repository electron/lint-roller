#!/usr/bin/env node

import { access, constants, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Ajv, { ValidateFunction } from 'ajv';
import type { fromHtml as FromHtmlFunction } from 'hast-util-from-html';
import type { HTML, Heading } from 'mdast';
import type { fromMarkdown as FromMarkdownFunction } from 'mdast-util-from-markdown';
import * as minimist from 'minimist';
import type { Literal, Node } from 'unist';
import type { visit as VisitFunction } from 'unist-util-visit';
import { URI } from 'vscode-uri';
import { parse as parseYaml } from 'yaml';

import { dynamicImport } from '../lib/helpers';
import { DocsWorkspace } from '../lib/markdown';

// "<any char>: <match group>"
const possibleStringRegex = /^[ \S]+?: *?(\S[ \S]+?)$/gm;
const nonAlphaNumericDotRegex = /[^a-zA-Z0-9.]/g;
const possibleDescriptionRegex = /^[ \S]+?description: *?(\S[ \S]+?)$/gm;

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

interface Options {
  // Check if the API history block is preceded by a heading
  checkPlacement: boolean;
  // Check if the 'breaking-changes-header' heading id's in the API history block exist in the breaking changes file at this filepath
  breakingChangesFile: string;
  // Check if the API history block contains strings that might cause issues when parsing the YAML
  checkStrings: boolean;
  // Check if the API history block contains descriptions that aren't surrounded by double quotation marks
  checkDescriptions: boolean;
  // Array of glob patterns to ignore when processing files
  ignoreGlobs: string[];
  // Check if the API history block's YAML adheres to the JSON schema at this filepath
  schema: string;

  // TODO: Implement this when GH_TOKEN isn't needed to fetch PR release versions anymore
  // checkPullRequestLinks: boolean;
}

interface PossibleHistoryBlock {
  previousNode?: Node;
  value: string;
}

function isHTML(node: Node): node is HTML {
  return node.type === 'html';
}

export async function findPossibleApiHistoryBlocks(
  content: string,
): Promise<PossibleHistoryBlock[]> {
  const { fromMarkdown } = (await dynamicImport('mdast-util-from-markdown')) as {
    fromMarkdown: typeof FromMarkdownFunction;
  };
  const { visit } = (await dynamicImport('unist-util-visit')) as {
    visit: typeof VisitFunction;
  };
  const tree = fromMarkdown(content);
  const codeBlocks: PossibleHistoryBlock[] = [];

  visit(
    tree,
    // Very loose check for YAML history blocks to help catch user error
    (node): node is HTML =>
      isHTML(node) &&
      node.value.includes('```') &&
      node.value.toLowerCase().includes('yaml') &&
      node.value.toLowerCase().includes('history'),
    (node: HTML, index) => {
      codeBlocks.push({
        previousNode: index !== null ? tree.children[index - 1] : undefined,
        value: node.value,
      });
    },
  );

  return codeBlocks;
}

type LintingResults = {
  historyBlockCounter: number;
  documentCounter: number;
  errorCounter: number;
  warningCounter: number;
};

async function main(
  workspaceRoot: string,
  globs: string[],
  {
    checkPlacement,
    breakingChangesFile,
    checkStrings,
    checkDescriptions,
    schema,
    ignoreGlobs = [],
  }: Options,
): Promise<LintingResults> {
  let documentCounter = 0;
  let historyBlockCounter = 0;
  let errorCounter = 0;
  let warningCounter = 0;

  try {
    const { fromHtml } = (await dynamicImport('hast-util-from-html')) as {
      fromHtml: typeof FromHtmlFunction;
    };
    const { fromMarkdown } = (await dynamicImport('mdast-util-from-markdown')) as {
      fromMarkdown: typeof FromMarkdownFunction;
    };

    const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);

    let validateAgainstSchema: ValidateFunction<ApiHistory> | null = null;

    if (schema) {
      try {
        const ajv = new Ajv();
        const ApiHistorySchemaFile = await readFile(schema, { encoding: 'utf-8' });
        const ApiHistorySchema = JSON.parse(ApiHistorySchemaFile);
        validateAgainstSchema = ajv.compile<ApiHistory>(ApiHistorySchema);
      } catch (error) {
        throw new Error(
          `Error occurred while attempting to read API history schema and compile AJV validator:\n${error}\n`,
        );
      }
    }

    let breakingChangesFileHeadingIds: string[] | null = null;

    if (breakingChangesFile) {
      try {
        const breakingChanges = await readFile(breakingChangesFile, { encoding: 'utf-8' });
        const markdownBreakingChanges = fromMarkdown(breakingChanges);
        const headings = markdownBreakingChanges.children.filter(
          (e) => e.type === 'heading' && e.depth === 3,
        ) as Heading[];
        // Convert to GitHub heading ID format
        breakingChangesFileHeadingIds = headings.map((heading) =>
          heading.children.reduce(
            (acc, cur) =>
              acc +
              (cur as Literal<string>).value
                .toLowerCase()
                .replace(/ /g, '-')
                .replace(/[^a-zA-Z0-9-]/g, ''),
            '',
          ),
        );
      } catch (error) {
        throw new Error(
          `Error occurred while attempting to read breaking changes file and parse the heading IDs:\n${error}\n`,
        );
      }
    }

    for (const document of await workspace.getAllMarkdownDocuments()) {
      const uri = URI.parse(document.uri);
      const filepath = workspace.getWorkspaceRelativePath(uri);

      documentCounter++;

      const documentText = document.getText();
      if (!documentText.includes('<!--')) continue;

      const possibleHistoryBlocks = await findPossibleApiHistoryBlocks(documentText);

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
          codeBlock.meta?.trim().toLowerCase() !== 'history'
        ) {
          console.error(
            'Error occurred while parsing Markdown document:\n\n' +
              `'${filepath}'\n\n` +
              "Couldn't extract matches from possible API history block, did you use the correct format?\n\n" +
              'Possible API history block:\n\n' +
              `${possibleHistoryBlock.value}\n`,
          );
          errorCounter++;
          continue;
        }

        // Special chars in YAML strings may break the parser if not surrounded by quotes,
        //  including just causing the parser to read a value as null instead of throwing an error
        //  <https://stackoverflow.com/questions/19109912/yaml-do-i-need-quotes-for-strings-in-yaml>
        if (checkStrings) {
          const possibleStrings = codeBlock.value.matchAll(possibleStringRegex);

          for (const [matchedLine, matchedGroup] of possibleStrings) {
            const trimmedMatchedGroup = matchedGroup.trim();
            const isMatchedGroupInsideQuotes =
              (trimmedMatchedGroup.startsWith('"') && trimmedMatchedGroup.endsWith('"')) ||
              (trimmedMatchedGroup.startsWith("'") && trimmedMatchedGroup.endsWith("'"));

            // Most special characters won't cause a problem if they're inside quotes
            if (isMatchedGroupInsideQuotes) continue;

            // I've only seen errors occur when the first or last character is a special character - @piotrpdev
            const isFirstCharNonAlphaNumeric =
              trimmedMatchedGroup[0].match(nonAlphaNumericDotRegex) !== null;
            const isLastCharNonAlphaNumeric =
              trimmedMatchedGroup.at(-1)?.match(nonAlphaNumericDotRegex) !== null;
            if (isFirstCharNonAlphaNumeric || isLastCharNonAlphaNumeric) {
              console.warn(
                'Warning occurred while parsing Markdown document:\n\n' +
                  `'${filepath}'\n\n` +
                  'Possible string value starts/ends with a non-alphanumeric character.\n\n' +
                  'This might cause issues when parsing the YAML (might not throw an error)\n\n' +
                  'Matched group:\n\n' +
                  `${matchedGroup}\n\n` +
                  'Matched line:\n\n' +
                  `${matchedLine}\n\n` +
                  'API history block:\n\n' +
                  `${possibleHistoryBlock.value}\n`,
              );
              // Not throwing an error because it might be a false positive or desired behavior
              warningCounter++;
            }
          }
        }

        // Throw an error if a description isn't surrounded by double quotation marks
        if (checkDescriptions) {
          const possibleDescription = codeBlock.value.matchAll(possibleDescriptionRegex);

          for (const [matchedLine, matchedGroup] of possibleDescription) {
            const trimmedMatchedGroup = matchedGroup.trim();
            const isMatchedGroupInsideQuotes =
              (trimmedMatchedGroup.startsWith('"') && trimmedMatchedGroup.endsWith('"')) ||
              (trimmedMatchedGroup.startsWith("'") && trimmedMatchedGroup.endsWith("'"));

            if (isMatchedGroupInsideQuotes) continue;

            console.error(
              'Error occurred while parsing Markdown document:\n\n' +
                `'${filepath}'\n\n` +
                'Possible description field is not surrounded by double quotes.\n\n' +
                'This might cause issues when parsing the YAML (might not throw an error)\n\n' +
                'Matched group:\n\n' +
                `${matchedGroup}\n\n` +
                'Matched line:\n\n' +
                `${matchedLine}\n\n` +
                'API history block:\n\n' +
                `${possibleHistoryBlock.value}\n`,
            );
            errorCounter++;
            continue;
          }
        }

        if (checkPlacement) {
          if (possibleHistoryBlock.previousNode?.type !== 'heading') {
            console.error(
              'Error occurred while parsing Markdown document:\n\n' +
                `'${filepath}'\n\n` +
                'API history block must be preceded by a heading\n\n' +
                'API history block:\n\n' +
                `${possibleHistoryBlock.value}\n`,
            );
            errorCounter++;
            continue;
          }
        }

        let unsafeHistory = null;

        try {
          unsafeHistory = parseYaml(codeBlock.value);
        } catch (error) {
          console.error(
            'Error occurred while parsing Markdown document:\n\n' +
              `'${filepath}'\n\n` +
              `(YAML) ${error}\n\n` +
              'API history block:\n\n' +
              `${possibleHistoryBlock.value}\n`,
          );
          errorCounter++;
          continue;
        }

        if (!schema || validateAgainstSchema === null) continue;

        const isValid = validateAgainstSchema(unsafeHistory);

        if (!isValid) {
          console.error(
            'Error occurred while parsing Markdown document:\n\n' +
              `'${filepath}'\n\n` +
              'Error validating YAML\n\n' +
              'Validation errors:\n\n' +
              `${JSON.stringify(validateAgainstSchema.errors, null, 4)}\n\n` +
              'Parsed YAML:\n\n' +
              `${JSON.stringify(unsafeHistory, null, 4)}\n\n` +
              'API history block:\n\n' +
              `${possibleHistoryBlock.value}\n`,
          );
          errorCounter++;
          continue;
        }

        if (breakingChangesFile && breakingChangesFileHeadingIds !== null) {
          const safeHistory = unsafeHistory as ApiHistory;

          const breakingChangeHeaders: string[] = [];

          const changesAndDeprecations = [
            ...(safeHistory.changes ?? []),
            ...(safeHistory.deprecated ?? []),
          ];

          for (const change of changesAndDeprecations) {
            if (change['breaking-changes-header']) {
              breakingChangeHeaders.push(change['breaking-changes-header']);
            }
          }

          for (const header of breakingChangeHeaders) {
            if (!breakingChangesFileHeadingIds.includes(header)) {
              console.error(
                'Error occurred while parsing Markdown document:\n\n' +
                  `'${filepath}'\n\n` +
                  "Couldn't find the following breaking changes header:\n\n" +
                  `'${header}'\n\n` +
                  `in this breaking changes file:\n\n` +
                  `'${breakingChangesFile}'\n\n` +
                  'Parsed YAML:\n\n' +
                  `${JSON.stringify(safeHistory, null, 4)}\n\n` +
                  'API history block:\n\n' +
                  `${possibleHistoryBlock.value}\n\n`,
              );
              errorCounter++;
            }
          }
        }

        // ? Maybe collect all api history and export it to a single file for future use.
      }

      // ? Maybe replace user YAML with result of <https://eemeli.org/yaml/#tostring-options> for consistent style (but not in CI)
    }
  } catch (error) {
    errorCounter++;
    console.error('Error occurred while linting:\n', error);
  } finally {
    return { historyBlockCounter, documentCounter, errorCounter, warningCounter };
  }
}

function parseCommandLine() {
  const showUsage = (arg?: string): boolean => {
    if (!arg || arg.startsWith('-')) {
      console.log(
        'Usage: lint-roller-markdown-api-history [--root <dir>] <globs>' +
          ' [-h|--help]' +
          ' [--check-placement] [--breaking-changes-file <path>] [--check-strings] [--check-descriptions]' +
          ' [--schema <path>]' +
          ' [--ignore <globs>] [--ignore-path <path>]',
      );
      process.exit(1);
    }

    return true;
  };

  const opts = minimist(process.argv.slice(2), {
    boolean: ['help', 'check-placement', 'check-strings', 'check-descriptions'],
    string: ['root', 'ignore', 'ignore-path', 'schema', 'breaking-changes-file'],
    unknown: showUsage,
    default: {
      'check-placement': true,
      'check-strings': true,
      'check-descriptions': true,
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
    }

    if (opts['breaking-changes-file']) {
      opts['breaking-changes-file'] = resolve(process.cwd(), opts['breaking-changes-file']);
    }

    const { historyBlockCounter, documentCounter, errorCounter, warningCounter } = await main(
      resolve(process.cwd(), opts.root),
      opts._,
      {
        checkPlacement: opts['check-placement'],
        breakingChangesFile: opts['breaking-changes-file'],
        checkStrings: opts['check-strings'],
        checkDescriptions: opts['check-descriptions'],
        ignoreGlobs: opts.ignore,
        schema: opts.schema,
      },
    );

    console.log(
      `Processed ${historyBlockCounter} API history block(s) in ${documentCounter} document(s) with ${errorCounter} error(s) and ${warningCounter} warning(s).`,
    );

    if (errorCounter > 0) process.exit(1);
  } catch (error) {
    console.error(`Error(s) occurred while initializing 'lint-markdown-api-history':\n${error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  init().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
