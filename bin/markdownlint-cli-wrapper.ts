#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as path from 'node:path';

if (require.main === module) {
  const command = process.platform === 'win32' ? 'markdownlint.cmd' : 'markdownlint';
  const { status } = cp.spawnSync(
    path.resolve(__dirname, `../../node_modules/.bin/${command}`),
    ['-r', path.resolve(__dirname, '../../markdownlint-rules'), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  if (status) process.exit(status);
}
