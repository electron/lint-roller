import * as cp from 'node:child_process';
import * as path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

function runLintMarkdownLinks(...args: string[]) {
  return cp.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../dist/bin/lint-markdown-links.js'), ...args],
    { stdio: 'pipe' },
  );
}

describe('electron-lint-markdown-links', () => {
  it('requires --root', () => {
    const { status, stdout } = runLintMarkdownLinks(
      path.resolve(FIXTURES_DIR, 'broken-internal-link.md'),
    );

    expect(stdout.toString('utf-8')).toContain('Usage');
    expect(status).toEqual(1);
  });

  it('should catch broken internal links', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      path.resolve(FIXTURES_DIR, 'broken-internal-link.md'),
    );

    expect(stdout.toString('utf-8')).toContain('Broken link');
    expect(status).toEqual(1);
  });

  it.skip('should by default ignore broken external links', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      path.resolve(FIXTURES_DIR, 'broken-external-link.md'),
    );

    expect(status).toEqual(0);
  });

  it('should catch broken external links with --fetch-external-links', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--fetch-external-links',
      path.resolve(FIXTURES_DIR, 'broken-external-link.md'),
    );

    expect(stdout.toString('utf-8')).toContain('Broken link');
    expect(status).toEqual(1);
  });

  it.skip('can warn about redirected external links with --check-redirects', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--fetch-external-links',
      '--check-redirects',
      path.resolve(FIXTURES_DIR, 'redirected-external-link.md'),
    );

    console.log(stdout.toString('utf-8'));

    expect(stdout.toString('utf-8')).toContain('Link redirection');
    expect(status).toEqual(0);
  });
});
