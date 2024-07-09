import { spawnSync } from 'node:child_process';
import path, { resolve } from 'node:path';
import { readdir, unlink, writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const MOCKUP_API_HISTORY_SCHEMA = resolve(FIXTURES_DIR, 'mockup-api-history.schema.json');
const MOCKUP_BREAKING_CHANGES_FILE = resolve(FIXTURES_DIR, 'mockup-breaking-changes.md');
const MOCKUP_DOCS_API_FOLDER = resolve(FIXTURES_DIR, 'api-history/mockup-api');

const stdoutRegex =
  /Processed (\d+) API history block\(s\) in (\d+) document\(s\) with (\d+) error\(s\) and (\d+) warning\(s\)./;

function runLintMarkdownApiHistory(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve(__dirname, '../dist/bin/lint-markdown-api-history.js'), ...args],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
}

async function clearMockupApiFolder() {
  for (const file of await readdir(MOCKUP_DOCS_API_FOLDER)) {
    if (file === '.gitkeep') continue;
    await unlink(path.join(MOCKUP_DOCS_API_FOLDER, file));
  }
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
    'deprecated-mockup-number-1',
    'deprecated-mockup-number-2',
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
      return { isError, stringWarnChar: '$' };
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
        `    description: ${stringWarnChar}Made \`trafficLightPosition\` work for \`customButtonOnHover\`.\n` +
        'deprecated:\n' +
        `  - pr-url: ${generateRandomPrUrl()}\n` +
        `    breaking-changes-header: ${generateRandomBreakingHeadingId()}\n` +
        '```\n' +
        '-->\n\n' +
        'Set a custom position for the traffic light buttons in frameless window.\n' +
        'Passing `{ x: 0, y: 0 }` will reset the position to default.\n\n';
    }

    await writeFile(resolve(MOCKUP_DOCS_API_FOLDER, `${documentIdx}.md`), content);
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
    await clearMockupApiFolder();
    await generateRandomApiDocuments();
  });

  afterAll(async () => {
    await clearMockupApiFolder();
  });

  it('should run clean when there are no errors', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
      'api-history-yaml-invalid.md',
    );

    expect(stderr).toMatch(/YAMLParseError: Nested mappings are not allowed/);

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
      MOCKUP_API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      'api-history-string-invalid.md',
    );

    expect(stderr).toMatch(/Possible string value starts\/ends with a non-alphanumeric character/);
    expect(stderr).toMatch(/YAMLParseError: Nested mappings are not allowed/);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(1);
    expect(Number(warnings)).toEqual(1);
    expect(status).toEqual(1);
  });

  it('can ignore a glob', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--ignore-path',
      resolve(FIXTURES_DIR, 'ignorepaths'),
      '--check-placement',
      '--check-strings',
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
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '{api-history-valid,api-history-yaml-invalid,api-history-heading-missing}.md',
    );

    expect(stdout).toMatch(stdoutRegex);
    expect(stderr).toMatch(/Couldn't find the following breaking changes header/);

    console.log(stdout);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(3);
    expect(Number(documents)).toEqual(3);
    expect(Number(errors)).toEqual(2);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(1);
  });

  it('should lint a large amount of api history', async () => {
    const {
      generatedDocumentCount,
      generatedBlockCount,
      generatedErrorCount,
      generatedWarningCount,
    } = await generateRandomApiDocuments();

    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      MOCKUP_DOCS_API_FOLDER,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
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
