import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

let TEMP_CONFIG_DIR: string;

async function runMarkdownlint(args: string[], configOptions: Record<string, unknown> = {}) {
  const configFilePath = path.resolve(TEMP_CONFIG_DIR, `.markdownlint-cli2.jsonc`);
  await fs.writeFile(
    configFilePath,
    JSON.stringify({
      config: {
        extends: path.resolve(__dirname, '../configs/markdownlint.json'),
        ...configOptions,
      },
      customRules: [path.resolve(__dirname, '../markdownlint-rules/index.js')],
    }),
  );

  args.push('--config', configFilePath);

  return cp.spawnSync('npx', ['markdownlint-cli2', ...args], {
    stdio: 'pipe',
    encoding: 'utf-8',
    shell: os.platform() === 'win32',
  });
}

describe('markdownlint-cli2', () => {
  beforeAll(async () => {
    TEMP_CONFIG_DIR = await fs.mkdtemp(
      path.join(os.tmpdir(), 'lint-roller-markdownlint-cli2-test-'),
    );
  });

  afterAll(async () => {
    await fs.rm(TEMP_CONFIG_DIR, { recursive: true, force: true });
  });

  it('should not allow shortcut links', async () => {
    const { status, stderr } = await runMarkdownlint([
      path.resolve(FIXTURES_DIR, 'shortcut-links.md'),
    ]);

    expect(stderr).toContain('MD054/link-image-style');
    expect(status).toEqual(1);
  });

  it('should allow GitHub alert syntax', async () => {
    const { status } = await runMarkdownlint([path.resolve(FIXTURES_DIR, 'github-alerts.md')]);

    expect(status).toEqual(0);
  });

  it('should not allow opening angle brackets if EMD002 enabled', async () => {
    const { status, stderr } = await runMarkdownlint(
      [path.resolve(FIXTURES_DIR, 'angle-brackets.md')],
      { EMD002: true },
    );

    expect(stderr).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('should allow escaped opening angle brackets if EMD002 enabled', async () => {
    const { status, stderr } = await runMarkdownlint(
      [path.resolve(FIXTURES_DIR, 'escaped-angle-brackets.md')],
      { EMD002: true },
    );

    expect(stderr).toBe('');
    expect(status).toEqual(0);
  });

  it('should not allow opening curly braces if EMD003 enabled', async () => {
    const { status, stderr } = await runMarkdownlint(
      [path.resolve(FIXTURES_DIR, 'curly-braces.md')],
      { EMD003: true },
    );

    expect(stderr).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('should allow escaped opening curly braces if EMD003 enabled', async () => {
    const { status, stderr } = await runMarkdownlint(
      [path.resolve(FIXTURES_DIR, 'escaped-curly-braces.md')],
      { EMD003: true },
    );

    expect(stderr).toBe('');
    expect(status).toEqual(0);
  });

  it('should not allow newlines in link text if EMD004 enabled', async () => {
    const { status, stderr } = await runMarkdownlint(
      [path.resolve(FIXTURES_DIR, 'newline-in-link-text.md')],
      { EMD004: true, 'no-space-in-links': false },
    );

    expect(stderr).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('should allow newlines in link text if EMD004 not enabled', async () => {
    const { status, stderr } = await runMarkdownlint(
      [path.resolve(FIXTURES_DIR, 'newline-in-link-text.md')],
      { EMD004: false, 'no-space-in-links': false },
    );

    expect(stderr).toBe('');
    expect(status).toEqual(0);
  });
});
