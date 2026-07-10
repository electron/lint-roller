import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
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

// Async variant which doesn't block the event loop, so that an
// in-process HTTP server can respond while the CLI runs
function runLintMarkdownLinksAsync(...args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = cp.spawn(
        process.execPath,
        [path.resolve(__dirname, '../dist/bin/lint-markdown-links.js'), ...args],
        { stdio: 'pipe' },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf-8').on('data', (data) => (stdout += data));
      child.stderr.setEncoding('utf-8').on('data', (data) => (stderr += data));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    },
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
      '**/broken-{external,image,internal}-link.md',
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

  it('should catch broken image links', () => {
    const { status, stdout } = runLintMarkdownLinks('--root', FIXTURES_DIR, 'broken-image-link.md');

    expect(stdout).toContain('Broken link');
    expect(status).toEqual(1);
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

  it('can warn about redirected external links with --check-redirects', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/old') {
        res.writeHead(307, { location: '/new' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html></html>');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as import('node:net').AddressInfo;

    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));

    try {
      await fs.writeFile(
        path.join(tmpdir, 'redirected-external-link.md'),
        `# Redirected External Link\n\n[redirected](http://127.0.0.1:${port}/old)\n`,
      );

      const { status, stdout } = await runLintMarkdownLinksAsync(
        '--root',
        tmpdir,
        '--fetch-external-links',
        '--check-redirects',
        'redirected-external-link.md',
      );

      expect(stdout).toContain('Link redirection');
      expect(stdout).toContain(`http://127.0.0.1:${port}/old -> http://127.0.0.1:${port}/new`);
      expect(status).toEqual(0);
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
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

  it('should retry failed external link fetches', { timeout: 30_000 }, async () => {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
      requestCount++;
      if (requestCount <= 2) {
        req.socket.destroy();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html></html>');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as import('node:net').AddressInfo;

    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));

    try {
      await fs.writeFile(
        path.join(tmpdir, 'flaky-external-link.md'),
        `# Flaky External Link\n\n[flaky](http://127.0.0.1:${port}/flaky)\n`,
      );

      const { status, stdout } = await runLintMarkdownLinksAsync(
        '--root',
        tmpdir,
        '--fetch-external-links',
        'flaky-external-link.md',
      );

      expect(stdout).toEqual(expect.not.stringContaining('Broken link'));
      expect(status).toEqual(0);
      expect(requestCount).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it('should retry external link fetches that hang', { timeout: 30_000 }, async () => {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
      requestCount++;
      if (requestCount > 1) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html></html>');
      }
      // On the first request, hold the socket open without responding
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as import('node:net').AddressInfo;

    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));

    try {
      await fs.writeFile(
        path.join(tmpdir, 'hanging-external-link.md'),
        `# Hanging External Link\n\n[hanging](http://127.0.0.1:${port}/hanging)\n`,
      );

      const { status, stdout } = await runLintMarkdownLinksAsync(
        '--root',
        tmpdir,
        '--fetch-external-links',
        'hanging-external-link.md',
      );

      expect(stdout).toEqual(expect.not.stringContaining('Broken link'));
      expect(status).toEqual(0);
      expect(requestCount).toBeGreaterThanOrEqual(2);
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it('should skip npmjs.com links', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'skipped-external-link.md',
      '--fetch-external-links',
    );

    expect(status).toEqual(0);
    expect(stdout).toContain('Skipping');
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

  it('should allow absolute links with --allow-absolute-links', () => {
    const { status } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      'absolute-internal-link.md',
      '--allow-absolute-links',
    );

    expect(status).toEqual(0);
  });

  it('should detect broken absolute links', () => {
    const { status, stdout, stderr } = runLintMarkdownLinks(
      '--root',
      FIXTURES_DIR,
      '--allow-absolute-links',
      'subdir/docs/resource-root-absolute-link.md',
    );

    expect(stderr).toEqual('');
    expect(stdout).toContain('Broken link');
    expect(status).toEqual(1);
  });

  it('should flag links outside workspace root as broken by default', () => {
    const { status, stdout } = runLintMarkdownLinks(
      '--root',
      path.resolve(FIXTURES_DIR, 'subdir', 'docs'),
      'outside-workspace-link.md',
    );

    expect(stdout).toContain('Broken link');
    expect(status).toEqual(1);
  });

  describe('--resource-root', () => {
    const docsDir = path.resolve(FIXTURES_DIR, 'subdir', 'docs');
    const subdir = path.resolve(FIXTURES_DIR, 'subdir');
    const staticDir = path.resolve(FIXTURES_DIR, 'static');

    it('should allow links outside workspace root when --resource-root is set', () => {
      const { status } = runLintMarkdownLinks(
        '--root',
        docsDir,
        '--resource-root',
        subdir,
        'outside-workspace-link.md',
      );

      expect(status).toEqual(0);
    });

    it('should flag links outside the resource root as broken', () => {
      const { status, stdout } = runLintMarkdownLinks(
        '--root',
        docsDir,
        '--resource-root',
        subdir,
        'outside-resource-root-link.md',
      );

      expect(stdout).toContain('Broken link');
      expect(status).toEqual(1);
    });

    it('should check for absolute links inside the resource root', () => {
      const { status, stdout, stderr } = runLintMarkdownLinks(
        '--root',
        docsDir,
        '--allow-absolute-links',
        '--resource-root',
        staticDir,
        'resource-root-absolute-link.md',
      );

      expect(stderr).toEqual('');
      expect(stdout).toEqual('');
      expect(status).toEqual(0);
    });
  });
});
