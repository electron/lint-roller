import * as cp from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

describe('electron-markdownlint', () => {
  it('should not allow shortcut links', () => {
    const { status, stderr } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        path.resolve(FIXTURES_DIR, 'shortcut-links.md'),
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    expect(stderr).toContain('MD054/link-image-style');
    expect(status).toEqual(1);
  });

  it('should allow GitHub alert syntax', () => {
    const { status } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        path.resolve(FIXTURES_DIR, 'github-alerts.md'),
      ],
      { stdio: 'pipe' },
    );

    expect(status).toEqual(0);
  });

  it('should not allow opening angle brackets if EMD002 enabled', () => {
    const { status, stderr, stdout } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        '--enable',
        'EMD002',
        '--',
        path.resolve(FIXTURES_DIR, 'angle-brackets.md'),
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    let fixturesRoot = `${FIXTURES_DIR}${path.sep}`;

    if (os.platform() === 'win32') {
      fixturesRoot = fixturesRoot.replace(/\\/g, '\\\\');
    }

    expect(stderr.replace(new RegExp(fixturesRoot, 'g'), '<root>')).toMatchSnapshot();
    expect(stdout).toBe('');
    expect(status).toEqual(1);
  });

  it('should allow escaped opening angle brackets if EMD002 enabled', () => {
    const { status, stderr, stdout } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        '--enable',
        'EMD002',
        '--',
        path.resolve(FIXTURES_DIR, 'escaped-angle-brackets.md'),
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    expect(stderr).toBe('');
    expect(stdout).toBe('');
    expect(status).toEqual(0);
  });

  it('should not allow opening curly braces if EMD003 enabled', () => {
    const { status, stderr, stdout } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        '--enable',
        'EMD003',
        '--',
        path.resolve(FIXTURES_DIR, 'curly-braces.md'),
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    let fixturesRoot = `${FIXTURES_DIR}${path.sep}`;

    if (os.platform() === 'win32') {
      fixturesRoot = fixturesRoot.replace(/\\/g, '\\\\');
    }

    expect(stderr.replace(new RegExp(fixturesRoot, 'g'), '<root>')).toMatchSnapshot();
    expect(stdout).toBe('');
    expect(status).toEqual(1);
  });

  it('should allow escaped opening curly braces if EMD003 enabled', () => {
    const { status, stderr, stdout } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        '--enable',
        'EMD003',
        '--',
        path.resolve(FIXTURES_DIR, 'escaped-curly-braces.md'),
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    expect(stderr).toBe('');
    expect(stdout).toBe('');
    expect(status).toEqual(0);
  });

  it('should not allow newlines in link text if EMD004 enabled', () => {
    const { status, stderr, stdout } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        '--enable',
        'EMD004',
        '--',
        path.resolve(FIXTURES_DIR, 'newline-in-link-text.md'),
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    let fixturesRoot = `${FIXTURES_DIR}${path.sep}`;

    if (os.platform() === 'win32') {
      fixturesRoot = fixturesRoot.replace(/\\/g, '\\\\');
    }

    expect(stderr.replace(new RegExp(fixturesRoot, 'g'), '<root>')).toMatchSnapshot();
    expect(stdout).toBe('');
    expect(status).toEqual(1);
  });

  it('should allow newlines in link text if EMD004 not enabled', () => {
    const { status, stderr, stdout } = cp.spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/bin/markdownlint-cli-wrapper.js'),
        '--disable',
        'EMD004',
        '--',
        path.resolve(FIXTURES_DIR, 'newline-in-link-text.md'),
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    expect(stderr).toBe('');
    expect(stdout).toBe('');
    expect(status).toEqual(0);
  });
});
