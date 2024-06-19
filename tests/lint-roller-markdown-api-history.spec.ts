import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const MOCKUP_API_HISTORY_SCHEMA = resolve(FIXTURES_DIR, 'mockup-api-history.schema.json');

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
      'api-history-valid.md',
    );

    expect(stdout).toMatch(stdoutRegex);
    expect(Number(stdoutRegex.exec(stdout)?.[3])).toEqual(0); // 0 errors
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
    expect(Number(stdoutRegex.exec(stdout)?.[3])).toEqual(1); // 1 error
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
    expect(Number(stdoutRegex.exec(stdout)?.[3])).toEqual(1); // 1 error
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
    expect(Number(stdoutRegex.exec(stdout)?.[3])).toEqual(1); // 1 error
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

    expect(Number(stdoutRegex.exec(stdout)?.[1])).toEqual(1); // 1 block
    expect(Number(stdoutRegex.exec(stdout)?.[2])).toEqual(1); // 1 document
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

    expect(Number(stdoutRegex.exec(stdout)?.[1])).toEqual(0); // 0 blocks
    expect(Number(stdoutRegex.exec(stdout)?.[2])).toEqual(0); // 0 documents
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

    expect(Number(stdoutRegex.exec(stdout)?.[1])).toEqual(1); // 1 block
    expect(Number(stdoutRegex.exec(stdout)?.[2])).toEqual(1); // 1 document
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
    expect(Number(stdoutRegex.exec(stdout)?.[1])).toEqual(2); // 2 block
    expect(Number(stdoutRegex.exec(stdout)?.[2])).toEqual(2); // 2 document
    expect(Number(stdoutRegex.exec(stdout)?.[3])).toEqual(1); // 1 errors
    expect(stdout).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  // TODO: Add more tests
});
