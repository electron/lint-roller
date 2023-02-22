#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as path from 'node:path';
import { argv } from 'node:process';

if (require.main === module) {
  const { status } = cp.spawnSync(
    path.resolve(__dirname, '../../node_modules/.bin/markdownlint'),
    ['-r', path.resolve(__dirname, '../../markdownlint-rules'), ...argv.slice(2)],
    { stdio: 'inherit' },
  );
  if (status) process.exit(status);
}
