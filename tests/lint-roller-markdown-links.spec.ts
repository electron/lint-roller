import * as cp from 'node:child_process';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

function runLintMarkdownLinks(...args: string[]) {
  return cp.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../dist/bin/lint-markdown-links.js'), ...args],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
}

describe('lint-roller-markdown-links', () => {
  it('should catch broken internal links', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'broken-internal-link.md',
    );

    expect(stdout).toContain('Broken link');
    expect(status).toEqual(1);
  });

  it('can ignore a glob', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/{{absolute,broken,valid}-*-link.md,*angle-brackets.md,api-history-*.md}',
      '*.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore multiple globs', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/absolute-internal-link.md',
      '--ignore',
      '**/broken-{external,internal}-link.md',
      '--ignore',
      '**/{broken,valid}-cross-file-link.md',
      '--ignore',
      '**/*angle-brackets.md',
      '--ignore',
      '**/api-history-*.md',
      '*.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore from a file', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--ignore-path',
      path.resolve(FIXTURES_DIR, 'ignorepaths'),
      '*.md',
    );

    expect(status).toEqual(0);
  });

  it('should catch broken cross-file links', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'broken-cross-file-link.md',
    );

    expect(stdout).toContain('Broken link');
    expect(status).toEqual(1);
  });

  it('should allow valid cross-file links', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'valid-cross-file-link.md',
    );

    expect(stdout).toEqual(expect.not.stringContaining('Broken link'));
    expect(status).toEqual(0);
  });

  it('should by default ignore broken external links', () => {
    const { status } = runLintMarkdownLinks('--root', FIXTURES_DIR, 'broken-external-link.md');

    expect(status).toEqual(0);
  });

  it('should catch broken external links with --fetch-external-links', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--fetch-external-links',
      'broken-external-link.md',
    );

    expect(stdout).toContain('Broken link');
    expect(status).toEqual(1);
  });

  it('can warn about redirected external links with --check-redirects', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--fetch-external-links',
      '--check-redirects',
      'redirected-external-link.md',
    );

    expect(stdout).toContain('Link redirection');
    expect(status).toEqual(0);
  });

  it('should accept options after the globs', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'broken-external-link.md',
      '--fetch-external-links',
    );

    expect(stdout).toContain('Broken link');
    expect(status).toEqual(1);
  });

  it('should be able to fetch GitHub label URLs', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'github-label-link.md',
      '--fetch-external-links',
    );

    expect(status).toEqual(0);
  });

  it('should be able to fetch twitter links', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'twitter-link.md',
      '--fetch-external-links',
    );

    expect(status).toEqual(0);
  });

  it('should disallow absolute links by default', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'absolute-internal-link.md',
    );

    expect(stdout).toContain('Absolute link');
    expect(status).toEqual(1);
  });

  it('should allow absolute links by with --allow-absolute-links', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'absolute-internal-link.md',
      '--allow-absolute-links',
    );

    expect(status).toEqual(0);
  });
});
