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
      { stdio: 'pipe' },
    );

    expect(stderr.toString('utf-8')).toContain('EMD001/no-shortcut-reference-links');
    expect(status).toEqual(1);
  });
});
