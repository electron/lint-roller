#!/usr/bin/env node

import { readFile, access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as minimist from 'minimist';

import { DocsWorkspace } from '../lib/markdown';
import { URI } from 'vscode-uri';
import { parse as parseYaml } from 'yaml';

import type { HTML, Heading } from 'mdast';
import type { Node, Literal } from 'unist';
import type { visit as VisitFunction } from 'unist-util-visit';
import type { fromHtml as FromHtmlFunction } from 'hast-util-from-html';
import type { fromMarkdown as FromMarkdownFunction } from 'mdast-util-from-markdown';
import { dynamicImport } from '../lib/helpers';
import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';
import AdmZip = require('adm-zip');

// "<any char>: <match group>"
const possibleStringRegex = /^[ \S]+?: *?(\S[ \S]+?)$/gm;
const nonAlphaNumericDotRegex = /[^a-zA-Z0-9.]/g;

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
  checkPlacement: boolean;
  checkPullRequestLinks: boolean;
  breakingChangesFile: string;
  checkStrings: boolean;
  ignoreGlobs: string[];
  schema: string;
}

interface HTMLWithPreviousNode extends HTML {
  previousNode?: Node;
}

// If you change this, you might want to update the one in the website transformer
export interface PrReleaseVersions {
  release: string | null;
  backports: Array<string>;
}

// If you change this, you might want to update the one in the website transformer
export type PrReleaseVersionsContainer = { [key: number]: PrReleaseVersions };

// If you change this, you might want to update the one in the website transformer
interface PrReleaseArtifact {
  data: PrReleaseVersionsContainer;
  endCursor: string;
}

function getCIPrNumber(): number | null {
  if (process.env.GITHUB_REF_NAME?.endsWith('/merge')) {
    // https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables
    return Number(process.env.GITHUB_REF_NAME.split('/')[0]);
  } else if (process.env.CIRCLE_PULL_REQUEST?.includes('/pull/')) {
    // https://circleci.com/docs/variables/#built-in-environment-variables
    return Number(process.env.CIRCLE_PULL_REQUEST.split('/').at(-1));
  } else {
    return null;
  }
}

let _allPrReleaseVersions: PrReleaseVersionsContainer;

// If you change this, you might want to update the one in the website transformer
// TODO: Change this when GH_TOKEN isn't needed to fetch PR release versions anymore
async function getAllPrReleaseVersions(): Promise<PrReleaseVersionsContainer> {
  try {
    if (_allPrReleaseVersions) {
      return _allPrReleaseVersions;
    }

    if (process.env.NODE_ENV === 'test') {
      const versions: PrReleaseVersionsContainer = {
        22533: {
          release: '',
          backports: [] as string[],
        },
        26789: {
          release: '',
          backports: [] as string[],
        },
        37094: {
          release: '',
          backports: [] as string[],
        },
      };

      _allPrReleaseVersions = versions;

      const ciPrNumber = getCIPrNumber();
      if (ciPrNumber) {
        console.log(
          'Detected PR number:\n\n' +
            `'${ciPrNumber}'\n\n` +
            'using CI environment variables. Adding to list of PRs...\n',
        );
        _allPrReleaseVersions[ciPrNumber] = {
          release: '',
          backports: [],
        };
      }

      return _allPrReleaseVersions;
    }

    if (!process.env.GH_TOKEN) {
      throw new Error(`GH_TOKEN is required for fetching PR release versions.`);
    }

    const fetchOptions = {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
      },
    };

    const artifactsListResponse = await fetch(
      'https://api.github.com/repos/electron/website/actions/artifacts',
      fetchOptions,
    );
    const latestArtifact = (await artifactsListResponse.json()).artifacts
      .filter(({ name }: { name: string }) => name === 'resolved-pr-versions')
      .sort((a: { id: number }, b: { id: number }) => a.id > b.id)[0];

    const archiveDownloadResponse = await fetch(latestArtifact.archive_download_url, fetchOptions);
    const buffer = Buffer.from(await archiveDownloadResponse.arrayBuffer());

    const zip = new AdmZip(buffer);
    const parsedData = JSON.parse(zip.readAsText(zip.getEntries()[0]!)) as PrReleaseArtifact;

    if (!parsedData?.data) {
      throw new Error(`No data found in the PR release versions artifact.`);
    }

    _allPrReleaseVersions = parsedData.data;

    const ciPrNumber = getCIPrNumber();
    if (ciPrNumber) {
      console.log(
        'Detected PR number:\n\n' +
          `'${ciPrNumber}'\n\n` +
          'using CI environment variables. Adding to list of PRs...\n',
      );
      _allPrReleaseVersions[ciPrNumber] = {
        release: '',
        backports: [],
      };
    }

    return _allPrReleaseVersions;
  } catch (error) {
    console.error(`Error occurred while checking PR links:\n${error}\n`);
    process.exit(1);
  }
}

export async function findPossibleApiHistoryBlocks(
  content: string,
): Promise<HTMLWithPreviousNode[]> {
  const { fromMarkdown } = (await dynamicImport('mdast-util-from-markdown')) as {
    fromMarkdown: typeof FromMarkdownFunction;
  };
  const { visit } = (await dynamicImport('unist-util-visit')) as {
    visit: typeof VisitFunction;
  };
  const tree = fromMarkdown(content);
  const codeBlocks: HTMLWithPreviousNode[] = [];

  visit(
    tree,
    // Very loose check for YAML history blocks to help catch user error
    (node) =>
      node.type === 'html' &&
      (node as Literal<string>).value.toLowerCase().includes('```') &&
      (node as Literal<string>).value.toLowerCase().includes('yaml') &&
      (node as Literal<string>).value.toLowerCase().includes('history'),
    (node: Node, index) => {
      // We don't want to modify the original node
      // ? Maybe just copy the previous node's type instead of the whole node
      const shallowNodeCopy = { ...node } as HTMLWithPreviousNode;
      if (index !== null) {
        const previousNode = tree.children[index - 1];
        if (previousNode) shallowNodeCopy.previousNode = previousNode;
      }
      codeBlocks.push(shallowNodeCopy);
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
    checkPullRequestLinks,
    breakingChangesFile,
    checkStrings,
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
        const ApiHistorySchema = JSON.parse(ApiHistorySchemaFile) as JSONSchemaType<ApiHistory>;
        validateAgainstSchema = ajv.compile(ApiHistorySchema);
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

        if (checkPlacement) {
          if (
            !possibleHistoryBlock.previousNode ||
            possibleHistoryBlock.previousNode.type !== 'heading'
          ) {
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

        if (checkPullRequestLinks) {
          const allPrReleaseVersions = await getAllPrReleaseVersions();

          const safeHistory = unsafeHistory as ApiHistory;
          const prsInHistory: Array<string> = [];

          // Copied from <https://github.com/electron/website/blob/a5d30f1ede6b20ea00d487c198c71560745063ab/src/transformers/api-history.ts#L154-L174>
          safeHistory.added?.forEach((added) => {
            prsInHistory.push(added['pr-url'].split('/').at(-1)!);
          });

          safeHistory.changes?.forEach((change) => {
            prsInHistory.push(change['pr-url'].split('/').at(-1)!);
          });

          safeHistory.deprecated?.forEach((deprecated) => {
            prsInHistory.push(deprecated['pr-url'].split('/').at(-1)!);
          });

          for (const prNumber of prsInHistory) {
            if (!allPrReleaseVersions.hasOwnProperty(Number(prNumber))) {
              // ? Should this be an error or warning?
              console.warn(
                'Warning occurred while parsing Markdown document:\n\n' +
                  `'${filepath}'\n\n` +
                  `Couldn't find PR number:\n\n` +
                  `'${prNumber}'\n\n` +
                  'in list of all PRs included in releases.\n\n' +
                  `Maybe the list is stale? Are you documenting a new change?\n\n` +
                  'Parsed YAML:\n\n' +
                  `${JSON.stringify(safeHistory, null, 4)}\n\n` +
                  'API history block:\n\n' +
                  `${possibleHistoryBlock.value}\n\n`,
              );
              warningCounter++;
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
          ' [--check-placement] [--check-pull-request-links] [--breaking-changes-file <path>] [--check-strings]' +
          ' [--schema <path>]' +
          ' [--ignore <globs>] [--ignore-path <path>]',
      );
      process.exit(1);
    }

    return true;
  };

  const opts = minimist(process.argv.slice(2), {
    boolean: ['help', 'check-placement', 'check-pull-request-links', 'check-strings'],
    string: ['root', 'ignore', 'ignore-path', 'schema', 'breaking-changes-file'],
    unknown: showUsage,
    default: {
      'check-placement': true,
      // TODO: Change this when GH_TOKEN isn't needed to fetch PR release versions anymore
      'check-pull-request-links': false,
      'check-strings': true,
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
        throw new Error(
          `Error occurred while attempting to access JSON Schema file: '${opts.schema}'\n${error}`,
        );
      }
    }

    if (opts['breaking-changes-file']) {
      opts['breaking-changes-file'] = resolve(process.cwd(), opts['breaking-changes-file']);
      try {
        await access(opts['breaking-changes-file'], constants.F_OK | constants.R_OK);
      } catch (error) {
        throw new Error(
          `Error occurred while attempting to access breaking changes file: '${opts['breaking-changes-file']}'\n${error}`,
        );
      }
    }

    if (opts['check-pull-request-links'] && process.env.NODE_ENV !== 'test') {
      // TODO: Change this when GH_TOKEN isn't needed to fetch PR release versions anymore
      if (!process.env.GH_TOKEN) {
        throw new Error(
          'GH_TOKEN environment variable is required for checking pull request links.',
        );
      }
    }

    const { historyBlockCounter, documentCounter, errorCounter, warningCounter } = await main(
      resolve(process.cwd(), opts.root),
      opts._,
      {
        checkPlacement: opts['check-placement'],
        checkPullRequestLinks: opts['check-pull-request-links'],
        breakingChangesFile: opts['breaking-changes-file'],
        checkStrings: opts['check-strings'],
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
