import * as cp from 'node:child_process';
import * as path from 'node:path';

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

    expect(stderr).toContain('EMD001/no-shortcut-reference-links');
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

    expect(stderr.replace(`${FIXTURES_DIR}${path.sep}`, '<root>')).toMatchSnapshot();
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
});
