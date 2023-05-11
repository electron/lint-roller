import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

function runLintMarkdownStandard(...args: string[]) {
  return cp.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../dist/bin/lint-markdown-standard.js'), ...args],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
}

describe('electron-lint-markdown-standard', () => {
  it('requires --root', () => {
    const { status, stdout } = runLintMarkdownStandard('broken-internal-link.md');

    expect(stdout).toContain('Usage');
    expect(status).toEqual(1);
  });

  it('should run clean when there are no errors', () => {
    const { status } = runLintMarkdownStandard('--root', FIXTURES_DIR, 'clean.md');

    expect(status).toEqual(0);
  });

  it('can ignore a glob', () => {
    const { status } = runLintMarkdownStandard(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/dirty.md',
      '{clean,dirty}.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore multiple globs', () => {
    const { status } = runLintMarkdownStandard(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/cleanable.md',
      '--ignore',
      '**/dirty.md',
      '*.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore from a file', () => {
    const { status } = runLintMarkdownStandard(
      '--root',
      FIXTURES_DIR,
      '--ignore-path',
      path.resolve(FIXTURES_DIR, 'ignorepaths'),
      '{clean,cleanable,dirty}.md',
    );

    expect(status).toEqual(0);
  });

  it('can detect errors in code blocks', () => {
    const { status, stdout } = runLintMarkdownStandard('--root', FIXTURES_DIR, 'dirty.md');

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('can fix cleanable errors with --fix option', async () => {
    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));
    fs.copyFile(path.join(FIXTURES_DIR, 'cleanable.md'), path.join(tmpdir, 'cleanable.md'));

    try {
      const { status, stdout } = runLintMarkdownStandard('--fix', '--root', tmpdir, 'cleanable.md');

      expect(
        await fs.readFile(path.join(tmpdir, 'cleanable.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: cleanable.md');
      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
    }
  });

  it('outputs uncleanable errors with --fix option', async () => {
    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));
    fs.copyFile(path.join(FIXTURES_DIR, 'dirty.md'), path.join(tmpdir, 'dirty.md'));

    try {
      const { status, stdout } = runLintMarkdownStandard('--fix', '--root', tmpdir, 'dirty.md');

      expect(
        await fs.readFile(path.join(tmpdir, 'dirty.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: dirty.md');
      expect(stdout).toContain("Expected '===' and instead saw '=='");
      expect(stdout).toContain('There are 4 errors');
      expect(status).toEqual(1);
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
    }
  });
});
