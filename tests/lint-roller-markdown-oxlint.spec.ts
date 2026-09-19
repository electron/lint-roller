import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const OXLINT_CONFIG = path.resolve(FIXTURES_DIR, 'oxlintrc.json');

function runLintMarkdownOxlint(...args: string[]) {
  return cp.spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../dist/bin/lint-markdown-oxlint.js'),
      '--config',
      OXLINT_CONFIG,
      ...args,
    ],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
}

async function withTempCopy(fixture: string, fn: (tmpdir: string) => Promise<void>) {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));
  await fs.copyFile(path.join(FIXTURES_DIR, fixture), path.join(tmpdir, fixture));

  try {
    await fn(tmpdir);
  } finally {
    await fs.rm(tmpdir, { recursive: true, force: true });
  }
}

describe('lint-roller-markdown-oxlint', () => {
  it('should run clean when there are no errors', () => {
    const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'clean.md');

    expect(stdout).toContain('There are 0 errors');
    expect(status).toEqual(0);
  });

  it('does not care about formatting', () => {
    const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'semi.md');

    expect(stdout).toContain('There are 0 errors');
    expect(status).toEqual(0);
  });

  it('can ignore a glob', () => {
    const { status } = runLintMarkdownOxlint(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/dirty.md',
      '{clean,dirty}.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore multiple globs', () => {
    const { status } = runLintMarkdownOxlint(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/cleanable.md',
      '--ignore',
      '**/dirty.md',
      '{clean,cleanable,dirty,semi}.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore from a file', () => {
    const { status } = runLintMarkdownOxlint(
      '--root',
      FIXTURES_DIR,
      '--ignore-path',
      path.resolve(FIXTURES_DIR, 'ignorepaths'),
      '{clean,cleanable,dirty}.md',
    );

    expect(status).toEqual(0);
  });

  it('can detect errors in code blocks', () => {
    const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'dirty.md');

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('only lints TypeScript blocks with --typescript', () => {
    {
      const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'typescript.md');

      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);
    }

    {
      const { status, stdout } = runLintMarkdownOxlint(
        '--root',
        FIXTURES_DIR,
        '--typescript',
        'typescript.md',
      );

      expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
      expect(status).toEqual(1);
    }
  });

  it('can fix cleanable errors with --fix option', async () => {
    await withTempCopy('cleanable.md', async (tmpdir) => {
      const { status, stdout } = runLintMarkdownOxlint('--fix', '--root', tmpdir, 'cleanable.md');

      expect(
        await fs.readFile(path.join(tmpdir, 'cleanable.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: cleanable.md');
      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);
    });
  });

  it('outputs uncleanable errors with --fix option', async () => {
    await withTempCopy('dirty.md', async (tmpdir) => {
      const { status, stdout } = runLintMarkdownOxlint('--fix', '--root', tmpdir, 'dirty.md');

      expect(
        await fs.readFile(path.join(tmpdir, 'dirty.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: dirty.md');
      expect(stdout).toContain('Expected === and instead saw ==');
      expect(stdout).toContain('There are 5 errors');
      expect(status).toEqual(1);
    });
  });

  it('preserves blockquotes and indentation with --fix option', async () => {
    const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'edge-cases.md');

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);

    await withTempCopy('edge-cases.md', async (tmpdir) => {
      const { status, stdout } = runLintMarkdownOxlint('--fix', '--root', tmpdir, 'edge-cases.md');

      expect(
        await fs.readFile(path.join(tmpdir, 'edge-cases.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: edge-cases.md');
      expect(stdout).toContain('There are 1 errors');
      expect(status).toEqual(1);
    });
  });
});
