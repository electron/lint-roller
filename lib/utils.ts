import * as path from 'node:path';

import * as klaw from 'klaw';

export async function findMatchingFiles(top: string, test: (filename: string) => boolean) {
  return new Promise<string[]>((resolve) => {
    const matches: string[] = [];
    klaw(top, {
      filter: (f) => path.basename(f) !== '.bin' && path.basename(f) !== 'node_modules',
    })
      .on('end', () => resolve(matches))
      .on('data', (item) => {
        if (test(item.path)) {
          matches.push(item.path);
        }
      });
  });
}
