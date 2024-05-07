#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as path from 'node:path';

if (require.main === module) {
  const { status } = cp.spawnSync(
    process.execPath,
    [
      require.resolve('markdownlint-cli'),
      '-r',
      path.resolve(__dirname, '../../markdownlint-rules/index.js'),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' },
  );
  if (status) process.exit(status);
}
