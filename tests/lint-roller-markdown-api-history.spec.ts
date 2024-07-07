import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const MOCKUP_API_HISTORY_SCHEMA = resolve(FIXTURES_DIR, 'mockup-api-history.schema.json');
const MOCKUP_BREAKING_CHANGES_FILE = resolve(FIXTURES_DIR, 'mockup-breaking-changes.md');

const stdoutRegex =
  /Processed (\d+) API history block\(s\) in (\d+) document\(s\) with (\d+) error\(s\) and (\d+) warning\(s\)./;

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
      '--check-placement',
      '--check-strings',
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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

  function cleanPullRequestLinksTest() {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-pull-request-links',
      'true',
      'api-history-valid.md',
    );

    expect(stderr).not.toMatch(/Couldn't find PR number/);

    const [documents, blocks, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(0);
    expect(Number(warnings)).toEqual(0);
    expect(status).toEqual(0);
  }

  function dirtyPullRequestLinksTest(CI = false) {
    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-pull-request-links',
      'true',
      'api-history-pull-request-invalid.md',
    );

    const [documents, blocks, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    if (CI) {
      expect(stdout).toMatch(/Detected PR number/);
      expect(stderr).not.toMatch(/Couldn't find PR number/);
      expect(Number(warnings)).toEqual(0);
    } else {
      expect(stderr).toMatch(/Couldn't find PR number/);
      expect(Number(warnings)).toEqual(1);
    }

    expect(Number(blocks)).toEqual(1);
    expect(Number(documents)).toEqual(1);
    expect(Number(errors)).toEqual(0);
    expect(status).toEqual(0);
  }

  it.runIf(process.env.GH_TOKEN)(
    'should not run clean when there are pull request link errors (GH_TOKEN)',
    () => {
      dirtyPullRequestLinksTest();
    },
  );

  it.runIf(process.env.GH_TOKEN)(
    'should run clean when there are no pull request link errors (GH_TOKEN)',
    () => {
      cleanPullRequestLinksTest();
    },
  );

  it('should not run clean when there are pull request link errors (mock data)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    dirtyPullRequestLinksTest();
    vi.unstubAllEnvs();
  });

  it('should run clean when there are no pull request link errors (mock data)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    cleanPullRequestLinksTest();
    vi.unstubAllEnvs();
  });

  it('should run clean when pull request link is in CI env vars (mock data)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CIRCLE_PULL_REQUEST', 'https://github.com/electron/lint-roller/pull/225332672');
    dirtyPullRequestLinksTest(true);
    vi.unstubAllEnvs();
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
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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
      '--check-pull-request-links',
      'false',
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
    vi.stubEnv('NODE_ENV', 'test');

    const { status, stdout, stderr } = runLintMarkdownApiHistory(
      '--root',
      FIXTURES_DIR,
      '--schema',
      MOCKUP_API_HISTORY_SCHEMA,
      '--breaking-changes-file',
      MOCKUP_BREAKING_CHANGES_FILE,
      '--check-placement',
      '--check-strings',
      '--check-pull-request-links',
      '{api-history-valid,api-history-yaml-invalid,api-history-heading-missing,api-history-pull-request-invalid}.md',
    );

    expect(stdout).toMatch(stdoutRegex);
    expect(stderr).toMatch(/Couldn't find the following breaking changes header/);
    expect(stderr).toMatch(/Couldn't find PR number/);

    console.log(stdout);

    const [blocks, documents, errors, warnings] = stdoutRegex.exec(stdout)?.slice(1, 5) ?? [];

    expect(Number(blocks)).toEqual(4);
    expect(Number(documents)).toEqual(4);
    expect(Number(errors)).toEqual(2);
    expect(Number(warnings)).toEqual(1);
    expect(status).toEqual(1);

    vi.unstubAllEnvs();
  });
});
