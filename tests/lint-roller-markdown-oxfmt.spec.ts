import * as cp from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const BIN = path.resolve(__dirname, '../dist/bin/lint-markdown-oxfmt.js');
const CONFIG_NO_SEMI = path.resolve(FIXTURES_DIR, 'oxfmtrc-nosemi.json');
const CONFIG_NO_SEMI_JSONC = path.resolve(FIXTURES_DIR, 'oxfmtrc-nosemi.jsonc');
const CONFIG_SEMI = path.resolve(FIXTURES_DIR, 'oxfmtrc-semi.json');

function runLintMarkdownOxfmt(...args: string[]) {
  return cp.spawnSync(process.execPath, [BIN, ...args], { stdio: 'pipe', encoding: 'utf-8' });
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

describe('lint-roller-markdown-oxfmt', () => {
  it('should run clean when code blocks are formatted', () => {
    const { status, stdout } = runLintMarkdownOxfmt(
      '--root',
      FIXTURES_DIR,
      '--config',
      CONFIG_NO_SEMI,
      '{clean,typescript}.md',
    );

    expect(stdout).toContain('There are 0 errors');
    expect(status).toEqual(0);
  });

  it('can ignore globs', () => {
    const { status } = runLintMarkdownOxfmt(
      '--root',
      FIXTURES_DIR,
      '--config',
      CONFIG_NO_SEMI,
      '--ignore',
      '**/dirty.md',
      '--ignore',
      '**/semi.md',
      '{clean,dirty,semi}.md',
    );

    expect(status).toEqual(0);
  });

  it('can detect unformatted code blocks', () => {
    const { status, stdout } = runLintMarkdownOxfmt(
      '--root',
      FIXTURES_DIR,
      '--config',
      CONFIG_NO_SEMI,
      'dirty.md',
    );

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('reports code blocks which cannot be parsed', () => {
    const { status, stdout } = runLintMarkdownOxfmt(
      '--root',
      FIXTURES_DIR,
      '--config',
      CONFIG_NO_SEMI,
      'unparseable.md',
    );

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);
  });

  it('uses the config to determine style', () => {
    {
      // Error if there are no semicolons and the config wants them
      const { status } = runLintMarkdownOxfmt(
        '--root',
        FIXTURES_DIR,
        '--config',
        CONFIG_SEMI,
        'clean.md',
      );
      expect(status).toEqual(1);
    }

    {
      // Error if there are semicolons and the config does not want them
      const { status } = runLintMarkdownOxfmt(
        '--root',
        FIXTURES_DIR,
        '--config',
        CONFIG_NO_SEMI,
        'semi.md',
      );
      expect(status).toEqual(1);
    }

    {
      // No error if there are semicolons and the config wants them
      const { status } = runLintMarkdownOxfmt(
        '--root',
        FIXTURES_DIR,
        '--config',
        CONFIG_SEMI,
        'semi.md',
      );
      expect(status).toEqual(0);
    }
  });

  it('looks for .oxfmtrc.json in the working directory by default', async () => {
    await withTempCopy('semi.md', async (tmpdir) => {
      const run = () =>
        cp.spawnSync(process.execPath, [BIN, 'semi.md'], {
          cwd: tmpdir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });

      // oxfmt defaults to double quotes, so this should fail
      expect(run().status).toEqual(1);

      await fs.copyFile(CONFIG_SEMI, path.join(tmpdir, '.oxfmtrc.json'));

      expect(run().status).toEqual(0);
    });
  });

  it('accepts a JSONC config', () => {
    const { status, stdout } = runLintMarkdownOxfmt(
      '--root',
      FIXTURES_DIR,
      '--config',
      CONFIG_NO_SEMI_JSONC,
      'clean.md',
    );

    expect(stdout).toContain('There are 0 errors');
    expect(status).toEqual(0);
  });

  it('errors if the config is not valid', async () => {
    await withTempCopy('clean.md', async (tmpdir) => {
      await fs.writeFile(path.join(tmpdir, '.oxfmtrc.json'), '{"semi":"sometimes"}');

      const { status, stderr } = cp.spawnSync(process.execPath, [BIN, 'clean.md'], {
        cwd: tmpdir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      expect(stderr).toContain('Invalid oxfmt config');
      expect(stderr).toContain('expected a boolean');
      expect(status).toEqual(1);
    });
  });

  it('errors if the config does not exist', () => {
    const { status, stderr } = runLintMarkdownOxfmt(
      '--root',
      FIXTURES_DIR,
      '--config',
      path.resolve(FIXTURES_DIR, 'does-not-exist.json'),
      'clean.md',
    );

    expect(stderr).toContain('oxfmt config not found');
    expect(status).toEqual(1);
  });

  it('handles blockquotes, list items, leading parens and stray object literals', async () => {
    const { status, stdout } = runLintMarkdownOxfmt(
      '--root',
      FIXTURES_DIR,
      '--config',
      CONFIG_NO_SEMI,
      'edge-cases.md',
    );

    expect(stdout.replace(FIXTURES_DIR, '<root>')).toMatchSnapshot();
    expect(status).toEqual(1);

    await withTempCopy('edge-cases.md', async (tmpdir) => {
      const { status, stdout } = runLintMarkdownOxfmt(
        '--fix',
        '--root',
        tmpdir,
        '--config',
        CONFIG_NO_SEMI,
        'edge-cases.md',
      );

      expect(
        await fs.readFile(path.join(tmpdir, 'edge-cases.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);

      // And it's clean afterwards, with either style
      for (const config of [CONFIG_NO_SEMI, CONFIG_SEMI]) {
        expect(
          runLintMarkdownOxfmt('--root', tmpdir, '--config', config, '--fix', 'edge-cases.md')
            .status,
        ).toEqual(0);
        expect(
          runLintMarkdownOxfmt('--root', tmpdir, '--config', config, 'edge-cases.md').status,
        ).toEqual(0);
      }
    });
  });

  it('can format code blocks with --fix option', async () => {
    await withTempCopy('cleanable.md', async (tmpdir) => {
      const { status, stdout } = runLintMarkdownOxfmt(
        '--fix',
        '--root',
        tmpdir,
        '--config',
        CONFIG_NO_SEMI,
        'cleanable.md',
      );

      expect(
        await fs.readFile(path.join(tmpdir, 'cleanable.md'), { encoding: 'utf-8' }),
      ).toMatchSnapshot();
      expect(stdout).toContain('File has changed: cleanable.md');
      expect(stdout).toContain('There are 0 errors');
      expect(status).toEqual(0);

      // And it's clean afterwards
      expect(
        runLintMarkdownOxfmt('--root', tmpdir, '--config', CONFIG_NO_SEMI, 'cleanable.md').status,
      ).toEqual(0);
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
        const { status, stdout } = runLintMarkdownOxfmt(
          '--root',
          tmpdir,
          '--config',
          CONFIG_NO_SEMI,
          'clean.md',
        );

        expect(stdout).toContain('There are 0 errors');
        expect(status).toEqual(0);
      }

      {
        const { status, stdout } = runLintMarkdownOxfmt(
          '--fix',
          '--root',
          tmpdir,
          '--config',
          CONFIG_NO_SEMI,
          'cleanable.md',
        );

        const fixed = await fs.readFile(path.join(tmpdir, 'cleanable.md'), 'utf-8');

        expect(fixed).toContain('var foo = 1\r\n');
        expect(fixed.replace(/\r\n/g, '')).not.toContain('\n');
        expect(stdout).toContain('There are 0 errors');
        expect(status).toEqual(0);
      }
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
    }
  });
});
