import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path, { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const API_HISTORY_SCHEMA = resolve(FIXTURES_DIR, 'api-history.schema.json');
const BREAKING_CHANGES_FILE = resolve(FIXTURES_DIR, 'api-history-breaking-changes.md');

const stdoutRegex =
  /Processed (\d+) API history block\(s\) in (\d+) document\(s\) with (\d+) error\(s\) and (\d+) warning\(s\)./;

function runLintMarkdownApiHistory(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve(__dirname, '../dist/bin/lint-markdown-api-history.js'), ...args],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
}

// Have to do this because beforeAll doesn't have a context
let _tempDocsFolder: string | null = null;

async function createOrGetExistingTempDocsFolder(): Promise<string> {
  if (_tempDocsFolder) {
    return _tempDocsFolder;
  }

  _tempDocsFolder = await mkdtemp(path.join(tmpdir(), 'lint-roller-markdown-api-history-'));
  return _tempDocsFolder;
}

type GenerateRandomApiDocumentsResult = {
  generatedDocumentCount: number;
  generatedBlockCount: number;
  generatedErrorCount: number;
  generatedWarningCount: number;
};

// Have to do this because beforeAll doesn't have a context
let _generateRandomApiDocumentsResult: GenerateRandomApiDocumentsResult | null = null;

async function generateRandomApiDocuments(): Promise<GenerateRandomApiDocumentsResult> {
  const maxDocuments = 100;
  const maxBlocksPerDocument = 20;
  const changeOfStringError = 0.5;
  const changeOfHeadingError = 0.5;
  const testPrNumbers = ['22533', '26789', '37094'];
  const testHeadingIds = [
    'deprecated-browserwindowsettrafficlightpositionposition',
    'behavior-changed-windowflashframebool-will-flash-dock-icon-continuously-on-macos',
    'default-changed-renderers-without-nodeintegration-true-are-sandboxed-by-default',
  ];

  if (_generateRandomApiDocumentsResult) {
    return _generateRandomApiDocumentsResult;
  }

  function generateRandomPrUrl() {
    const randomPrNumber = testPrNumbers[Math.floor(Math.random() * testPrNumbers.length)];
    return `https://github.com/electron/electron/pull/${randomPrNumber}`;
  }

  function generateRandomBreakingHeadingId() {
    return testHeadingIds[Math.floor(Math.random() * testHeadingIds.length)];
  }

  function randomlyGenerateStringWarnChar() {
    const isError = Math.random() < changeOfStringError;

    if (isError) {
      // Will cause a warning but not a yaml parse error
      return { isError, stringWarnChar: '#' };
    } else {
      return { isError, stringWarnChar: '' };
    }
  }

  function randomlyGenerateHeading(blockIdx: number) {
    const isError = Math.random() < changeOfHeadingError;

    if (isError) {
      return { isError, heading: '' };
    } else {
      return { isError, heading: `#### API History Block ${blockIdx}` };
    }
  }

  let generatedDocumentCount = Math.floor(Math.random() * maxDocuments) || 1;
  let generatedBlockCount = 0;
  let generatedErrorCount = 0;
  let generatedWarningCount = 0;

  for (let documentIdx = 0; documentIdx < generatedDocumentCount; documentIdx++) {
    const blocks = Math.floor(Math.random() * maxBlocksPerDocument) || 1;
    generatedBlockCount += blocks;

    let content = '';

    for (let blockIdx = 0; blockIdx < blocks; blockIdx++) {
      // No point in generating every type of error and warning since the other tests already
      //  cover that and in a real use case we wouldn't have that many errors and warnings in
      //  every document. This is just to test the performance of the linter.
      const { isError: IsStringWarn, stringWarnChar } = randomlyGenerateStringWarnChar();
      if (IsStringWarn) generatedWarningCount++;

      const { isError: IsHeadingError, heading } = randomlyGenerateHeading(blockIdx);
      if (IsHeadingError) generatedErrorCount++;

      content +=
        `${heading}\n\n` +
        '<!--\n' +
        '```YAML history\n' +
        'added:\n' +
        `  - pr-url: ${generateRandomPrUrl()}\n` +
        'changes:\n' +
        `  - pr-url: ${generateRandomPrUrl()}\n` +
        `    description: "Made \`trafficLightPosition\` work for \`customButtonOnHover\`."\n` +
        'deprecated:\n' +
        `  - pr-url: ${generateRandomPrUrl()}\n` +
        `    breaking-changes-header: ${generateRandomBreakingHeadingId()} ${stringWarnChar}\n` +
        '```\n' +
        '-->\n\n' +
        'Set a custom position for the traffic light buttons in frameless window.\n' +
        'Passing `{ x: 0, y: 0 }` will reset the position to default.\n\n';
    }

    const tempDocsFolder = await createOrGetExistingTempDocsFolder();
    await writeFile(resolve(tempDocsFolder, `${documentIdx}.md`), content);
  }

  _generateRandomApiDocumentsResult = {
    generatedDocumentCount,
    generatedBlockCount,
    generatedErrorCount,
    generatedWarningCount,
  };
  return _generateRandomApiDocumentsResult;
}

describe('lint-roller-markdown-api-history', () => {
  beforeAll(async () => {
    await createOrGetExistingTempDocsFolder();
    await generateRandomApiDocuments();
  });

  afterAll(async () => {
    const tempDocsFolder = await createOrGetExistingTempDocsFolder();
    await rm(tempDocsFolder, { recursive: true, force: true });
  });

  it('should run clean when there are no errors', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-valid.md',
    );

    expect(stdout).toMatch(stdoutRegex);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(0);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(0);
  });

  it('should not run clean when there are yaml errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-yaml-invalid.md',
    );

    expect(stderr).toMatch(/must be array/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are schema errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-schema-invalid.md',
    );

    expect(stderr).toMatch(/"keyword": "minLength"/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are format errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-format-invalid.md',
    );

    expect(stderr).toMatch(/did you use the correct format?/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are missing heading ids', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-heading-missing.md',
    );

    expect(stderr).toMatch(/Couldn't find the following breaking changes header/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are placement errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-placement-invalid.md',
    );

    expect(stderr).toMatch(/API history block must be preceded by a heading/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are string errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-string-invalid.md',
    );

    expect(stderr).toMatch(/Possible string value starts\/ends with a non-alphanumeric character/);
    expect(stderr).toMatch(/must be string/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(1);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are description errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'api-history-description-invalid.md',
    );

    expect(stderr).toMatch(/Possible description field is not surrounded by double quotes./);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are yaml comments', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      '{api-history-line-comment,api-history-separated-comment,api-history-valid-hashtags}.md',
    );

    expect(stderr).toMatch(/API History cannot contain YAML comments./);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(3);
    expect(Number(documents)).toEqual(3);
    expect(Number(errors)).toEqual(2);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('can ignore a glob', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      '--ignore',
      '**/api-history-yaml-invalid.md',
      '{api-history-valid,api-history-yaml-invalid}.md',
    );

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(0);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(0);
  });

  it('can ignore multiple globs', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      '--ignore',
      '**/api-history-valid.md',
      '--ignore',
      '**/api-history-yaml-invalid.md',
      '{api-history-valid,api-history-yaml-invalid}.md',
    );

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(0);
    expect(Number(documents)).toEqual(0);
    expect(Number(errors)).toEqual(0);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(0);
  });

  it('can ignore from a file', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--ignore-path',
      resolve(FIXTURES_DIR, 'ignorepaths'),
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      '{api-history-valid,api-history-yaml-invalid}.md',
    );

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(0);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(0);
  });

  it('should lint api history', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      '{api-history-valid,api-history-yaml-invalid,api-history-heading-missing}.md',
    );

    expect(stdout).toMatch(stdoutRegex);
    expect(stderr).toMatch(/Couldn't find the following breaking changes header/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(3);
    expect(Number(documents)).toEqual(3);
    expect(Number(errors)).toEqual(2);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should lint a large amount of api history', async () => {
    const tempDocsFolder = await createOrGetExistingTempDocsFolder();

    const {
      generatedDocumentCount,
      generatedBlockCount,
      generatedErrorCount,
      generatedWarningCount,
    } = await generateRandomApiDocuments();

    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      tempDocsFolder,
      '--schema',
      API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-descriptions',
      '--disallow-comments',
      'false',
      '*.md',
    );

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(generatedBlockCount);
    expect(Number(documents)).toEqual(generatedDocumentCount);
    expect(Number(errors)).toEqual(generatedErrorCount);
    expect(Number(warnings)).toEqual(generatedWarningCount);
    expect(status).toEqual(generatedErrorCount > 0 ? 1 : 0);
  });
});
