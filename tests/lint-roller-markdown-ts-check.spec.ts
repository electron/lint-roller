import * as cp from 'node:child_process';
import * as path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

function runLintMarkdownTsCheck(...args: string[]) {
  return cp.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../dist/bin/lint-markdown-ts-check.js'), ...args],
    {
      stdio: 'pipe',
      encoding: 'utf-8',
      cwd: FIXTURES_DIR,
      env: { NODE_OPTIONS: '--no-deprecation' },
    },
  );
}

describe('lint-roller-markdown-ts-check', () => {
  it('should run clean when there are no errors', () => {
    const { status, stdout } = runLintMarkdownTsCheck('--root', FIXTURES_DIR, 'ts-check-clean.md');

    expect(stdout).toEqual('');
    expect(status).toEqual(0);
  });

  it('can ignore a glob', () => {
    const { status } = runLintMarkdownTsCheck(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/ts-check.md',
      '{ts-check,ts-check-clean}.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore multiple globs', () => {
    const { status } = runLintMarkdownTsCheck(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/ts-check.md',
      '--ignore',
      '**/dirty.md',
      '{dirty,ts-check,ts-check-clean}.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore from a file', () => {
    const { status } = runLintMarkdownTsCheck(
      '--root',
      FIXTURES_DIR,
      '--ignore-path',
      path.resolve(FIXTURES_DIR, 'ignorepaths'),
      '{dirty,ts-check,ts-check-clean}.md',
    );

    expect(status).toEqual(0);
  });

  it('should type check code blocks', () => {
    const { status, stdout } = runLintMarkdownTsCheck('--root', FIXTURES_DIR, 'ts-check.md');

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('can use a custom config', () => {
    const { status, stdout, stderr } = runLintMarkdownTsCheck(
      '--root',
      FIXTURES_DIR,
      '--config',
      'custom-config.json',
      'ts-check-custom-config.md',
    );

    expect(stdout).toEqual('');
    expect(stderr).toEqual('');
    expect(status).toEqual(0);
  });
});
