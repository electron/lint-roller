import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const OXLINT_CONFIG = path.resolve(FIXTURES_DIR, 'oxlintrc.json');
const OXFMT_CONFIG_NO_SEMI = path.resolve(FIXTURES_DIR, 'oxfmtrc-nosemi.json');
const OXFMT_CONFIG_NO_SEMI_JSONC = path.resolve(FIXTURES_DIR, 'oxfmtrc-nosemi.jsonc');
const OXFMT_CONFIG_SEMI = path.resolve(FIXTURES_DIR, 'oxfmtrc-semi.json');

function runLintMarkdownOxlint(...args: string[]) {
  return cp.spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../dist/bin/lint-markdown-oxlint.js'),
      '--config',
      OXLINT_CONFIG,
      ...args,
    ],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
}

async function withTempCopy(fixture: string, fn: (tmpdir: string) => Promise<void>) {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));
  await fs.copyFile(path.join(FIXTURES_DIR, fixture), path.join(tmpdir, fixture));

  try {
    await fn(tmpdir);
  } finally {
    await fs.rm(tmpdir, { recursive: true, force: true });
  }
}

describe('lint-roller-markdown-oxlint', () => {
  it('should run clean when there are no errors', () => {
    const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'clean.md');

    expect(stdout).toContain('There are 0 errors');
    expect(status).toEqual(0);
  });

  it('does not care about semicolons without --oxfmt', () => {
    const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'semi.md');

    expect(stdout).toContain('There are 0 errors');
    expect(status).toEqual(0);
  });

  it('can ignore a glob', () => {
    const { status } = runLintMarkdownOxlint(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/dirty.md',
      '{clean,dirty}.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore multiple globs', () => {
    const { status } = runLintMarkdownOxlint(
      '--root',
      FIXTURES_DIR,
      '--ignore',
      '**/cleanable.md',
      '--ignore',
      '**/dirty.md',
      '{clean,cleanable,dirty,semi}.md',
    );

    expect(status).toEqual(0);
  });

  it('can ignore from a file', () => {
    const { status } = runLintMarkdownOxlint(
      '--root',
      FIXTURES_DIR,
      '--ignore-path',
      path.resolve(FIXTURES_DIR, 'ignorepaths'),
      '{clean,cleanable,dirty}.md',
    );

    expect(status).toEqual(0);
  });

  it('can detect errors in code blocks', () => {
    const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'dirty.md');

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('only lints TypeScript blocks with --typescript', () => {
    {
      const { status, stdout } = runLintMarkdownOxlint('--root', FIXTURES_DIR, 'typescript.md');

      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);
    }

    {
      const { status, stdout } = runLintMarkdownOxlint(
        '--root',
        FIXTURES_DIR,
        '--typescript',
        'typescript.md',
      );

      expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
      expect(status).toEqual(1);
    }
  });

  it('can fix cleanable errors with --fix option', async () => {
    await withTempCopy('cleanable.md', async (tmpdir) => {
      const { status, stdout } = runLintMarkdownOxlint('--fix', '--root', tmpdir, 'cleanable.md');

      expect(
        await fs.readFile(path.join(tmpdir, 'cleanable.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: cleanable.md');
      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);
    });
  });

  it('outputs uncleanable errors with --fix option', async () => {
    await withTempCopy('dirty.md', async (tmpdir) => {
      const { status, stdout } = runLintMarkdownOxlint('--fix', '--root', tmpdir, 'dirty.md');

      expect(
        await fs.readFile(path.join(tmpdir, 'dirty.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: dirty.md');
      expect(stdout).toContain('Expected === and instead saw ==');
      expect(stdout).toContain('There are 4 errors');
      expect(status).toEqual(1);
    });
  });

  describe('with --oxfmt', () => {
    it('should run clean when code blocks are formatted', () => {
      const { status, stdout } = runLintMarkdownOxlint(
        '--root',
        FIXTURES_DIR,
        '--oxfmt-config',
        OXFMT_CONFIG_NO_SEMI,
        'clean.md',
      );

      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);
    });

    it('can detect lint and formatting errors in code blocks', () => {
      const { status, stdout } = runLintMarkdownOxlint(
        '--root',
        FIXTURES_DIR,
        '--oxfmt-config',
        OXFMT_CONFIG_NO_SEMI,
        'dirty.md',
      );

      expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
      expect(status).toEqual(1);
    });

    it('uses the oxfmt config to determine style', () => {
      {
        // Error if there are no semicolons and the config wants them
        const { status } = runLintMarkdownOxlint(
          '--root',
          FIXTURES_DIR,
          '--oxfmt-config',
          OXFMT_CONFIG_SEMI,
          'clean.md',
        );
        expect(status).toEqual(1);
      }

      {
        // Error if there are semicolons and the config does not want them
        const { status } = runLintMarkdownOxlint(
          '--root',
          FIXTURES_DIR,
          '--oxfmt-config',
          OXFMT_CONFIG_NO_SEMI,
          'semi.md',
        );
        expect(status).toEqual(1);
      }

      {
        // No error if there are semicolons and the config wants them
        const { status } = runLintMarkdownOxlint(
          '--root',
          FIXTURES_DIR,
          '--oxfmt-config',
          OXFMT_CONFIG_SEMI,
          'semi.md',
        );
        expect(status).toEqual(0);
      }
    });

    it('looks for .oxfmtrc.json in the working directory by default', async () => {
      await withTempCopy('semi.md', async (tmpdir) => {
        const run = () =>
          cp.spawnSync(
            process.execPath,
            [
              path.resolve(__dirname, '../dist/bin/lint-markdown-oxlint.js'),
              '--config',
              OXLINT_CONFIG,
              '--oxfmt',
              'semi.md',
            ],
            { cwd: tmpdir, stdio: 'pipe', encoding: 'utf-8' },
          );

        // oxfmt defaults to double quotes, so this should fail
        expect(run().status).toEqual(1);

        await fs.copyFile(OXFMT_CONFIG_SEMI, path.join(tmpdir, '.oxfmtrc.json'));

        expect(run().status).toEqual(0);
      });
    });

    it('accepts a JSONC oxfmt config', () => {
      const { status, stdout } = runLintMarkdownOxlint(
        '--root',
        FIXTURES_DIR,
        '--oxfmt-config',
        OXFMT_CONFIG_NO_SEMI_JSONC,
        'clean.md',
      );

      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);
    });

    it('handles blockquotes, list items, leading parens and stray object literals', async () => {
      const { status, stdout } = runLintMarkdownOxlint(
        '--root',
        FIXTURES_DIR,
        '--oxfmt-config',
        OXFMT_CONFIG_NO_SEMI,
        'edge-cases.md',
      );

      expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
      expect(status).toEqual(1);

      await withTempCopy('edge-cases.md', async (tmpdir) => {
        const { status, stdout } = runLintMarkdownOxlint(
          '--fix',
          '--root',
          tmpdir,
          '--oxfmt-config',
          OXFMT_CONFIG_NO_SEMI,
          'edge-cases.md',
        );

        expect(
          await fs.readFile(path.join(tmpdir, 'edge-cases.md'), { encoding: 'utf-8' }),
        ).toMatchSnapshot();
        expect(stdout).toContain('There are 0 errors');
        expect(status).toEqual(0);
      });
    });

    it('preserves CRLF line endings', async () => {
      const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-roller-'));

      try {
        for (const fixture of ['clean.md', 'cleanable.md']) {
          const content = await fs.readFile(path.join(FIXTURES_DIR, fixture), 'utf-8');
          await fs.writeFile(path.join(tmpdir, fixture), content.replace(/\n/g, '\r\n'));
        }

        {
          const { status, stdout } = runLintMarkdownOxlint(
            '--root',
            tmpdir,
            '--oxfmt-config',
            OXFMT_CONFIG_NO_SEMI,
            'clean.md',
          );

          expect(stdout).toContain('There are 0 errors');
          expect(status).toEqual(0);
        }

        {
          const { status, stdout } = runLintMarkdownOxlint(
            '--fix',
            '--root',
            tmpdir,
            '--oxfmt-config',
            OXFMT_CONFIG_NO_SEMI,
            'cleanable.md',
          );

          const fixed = await fs.readFile(path.join(tmpdir, 'cleanable.md'), 'utf-8');

          expect(fixed).toContain('const foo = 1\r\n');
          expect(fixed.replace(/\r\n/g, '')).not.toContain('\n');
          expect(stdout).toContain('There are 0 errors');
          expect(status).toEqual(0);
        }
      } finally {
        await fs.rm(tmpdir, { recursive: true, force: true });
      }
    });

    it('errors if the oxfmt config does not exist', () => {
      const { status, stderr } = runLintMarkdownOxlint(
        '--root',
        FIXTURES_DIR,
        '--oxfmt-config',
        path.resolve(FIXTURES_DIR, 'does-not-exist.json'),
        'clean.md',
      );

      expect(stderr).toContain('oxfmt config not found');
      expect(status).toEqual(1);
    });

    it('can fix lint and formatting errors with --fix option', async () => {
      await withTempCopy('cleanable.md', async (tmpdir) => {
        const { status, stdout } = runLintMarkdownOxlint(
          '--fix',
          '--root',
          tmpdir,
          '--oxfmt-config',
          OXFMT_CONFIG_NO_SEMI,
          'cleanable.md',
        );

        expect(
          await fs.readFile(path.join(tmpdir, 'cleanable.md'), { encoding: 'utf-8' }),
        ).toMatchSnapshot();
        expect(stdout).toContain('File has changed: cleanable.md');
        expect(stdout).toContain('There are 0 errors');
        expect(status).toEqual(0);
      });
    });

    it('outputs uncleanable errors with --fix option', async () => {
      await withTempCopy('dirty.md', async (tmpdir) => {
        const { status, stdout } = runLintMarkdownOxlint(
          '--fix',
          '--root',
          tmpdir,
          '--oxfmt-config',
          OXFMT_CONFIG_NO_SEMI,
          'dirty.md',
        );

        expect(
          await fs.readFile(path.join(tmpdir, 'dirty.md'), { encoding: 'utf-8' }),
        ).toMatchSnapshot();
        expect(stdout).toContain('File has changed: dirty.md');
        expect(stdout).toContain('Expected === and instead saw ==');
        expect(stdout).toContain('There are 4 errors');
        expect(status).toEqual(1);
      });
    });
  });
});
