import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const MOCKUP_API_HISTORY_SCHEMA = resolve(FIXTURES_DIR, 'mockup-api-history.schema.json');
const MOCKUP_BREAKING_CHANGES_FILE = resolve(FIXTURES_DIR, 'mockup-breaking-changes.md');

const stdoutRegex =
  /Processed (\d+) API history block\(s\) in (\d+) document\(s\) with (\d+) error\(s\)./;

function runLintMarkdownApiHistory(...args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve(__dirname, '../dist/bin/lint-markdown-api-history.js'), ...args],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
}

describe('lint-roller-markdown-api-history', () => {
  it('should run clean when there are no errors', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      'api-history-valid.md',
    );

    expect(stdout).toMatch(stdoutRegex);

    const [, , errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(errors)).toEqual(0);
    expect(status).toEqual(0);
  });

  it('should not run clean when there are yaml errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      'api-history-yaml-invalid.md',
    );

    expect(stderr).toMatch(/YAMLParseError: Nested mappings are not allowed/);

    const [, , errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(errors)).toEqual(1);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are schema errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      'api-history-schema-invalid.md',
    );

    expect(stderr).toMatch(/"keyword": "minLength"/);

    const [, , errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(errors)).toEqual(1);
    expect(status).toEqual(1);
  });

  it('should not run clean when there are format errors', () => {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      'api-history-format-invalid.md',
    );

    expect(stderr).toMatch(/did you use the correct format?/);

    const [, , errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(errors)).toEqual(1);
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
      'api-history-heading-missing.md',
    );

    expect(stderr).toMatch(/Couldn't find breaking changes header/);

    const [, , errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(errors)).toEqual(1);
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
      'api-history-placement-invalid.md',
    );

    expect(stderr).toMatch(/API history block must be preceded by a heading/);

    const [, , errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(errors)).toEqual(1);
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
      'api-history-string-invalid.md',
    );

    expect(stderr).toMatch(/Possible string value starts\/ends with a non-alphanumeric character/);
    expect(stderr).toMatch(/YAMLParseError: Nested mappings are not allowed/);

    const [, , errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(errors)).toEqual(1);
    expect(status).toEqual(1);
  });

  it('can ignore a glob', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--ignore',
      '**/api-history-yaml-invalid.md',
      '{api-history-valid,api-history-yaml-invalid}.md',
    );

    const [blocks, documents] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(status).toEqual(0);
  });

  it('can ignore multiple globs', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--ignore',
      '**/api-history-valid.md',
      '--ignore',
      '**/api-history-yaml-invalid.md',
      '{api-history-valid,api-history-yaml-invalid}.md',
    );

    const [blocks, documents] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(blocks)).toEqual(0);
    expect(Number(documents)).toEqual(0);
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
      '{api-history-valid,api-history-yaml-invalid}.md',
    );

    const [blocks, documents] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(blocks)).toEqual(1); // 1 block
    expect(Number(documents)).toEqual(1); // 1 document
    expect(status).toEqual(0);
  });

  it('should lint api history', () => {
    const { status, stdout } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '{api-history-valid,api-history-yaml-invalid}.md',
    );

    expect(stdout).toMatch(stdoutRegex);

    const [blocks, documents, errors] = stdoutRegex.exec(stdout)?.slice(1, 4) ?? [];

    expect(Number(blocks)).toEqual(2); // 2 block
    expect(Number(documents)).toEqual(2); // 2 document
    expect(Number(errors)).toEqual(1); // 1 errors
    expect(status).toEqual(1);
  });

  // TODO: Add more tests
});
