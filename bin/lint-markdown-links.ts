#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  createLanguageService,
  DiagnosticLevel,
  DiagnosticOptions,
  ILogger,
  LogLevel,
} from '@dsanders11/vscode-markdown-languageservice';
import { CancellationTokenSource } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import { DocsWorkspace, MarkdownLinkComputer, MarkdownParser } from '../lib/markdown.js';

class NoOpLogger implements ILogger {
  readonly level = LogLevel.Off;

  log(): void {}
}

const diagnosticOptions: DiagnosticOptions = {
  ignoreLinks: [],
  validateDuplicateLinkDefinitions: DiagnosticLevel.error,
  validateFileLinks: DiagnosticLevel.error,
  validateFragmentLinks: DiagnosticLevel.error,
  validateMarkdownFileLinkFragments: DiagnosticLevel.error,
  validateReferences: DiagnosticLevel.error,
  validateUnusedLinkDefinitions: DiagnosticLevel.error,
};

async function fetchExternalLink(link: string, checkRedirects = false) {
  const url = new URL(link);
  if (url.hostname.endsWith('.npmjs.com')) {
    console.log('Skipping npmjs.com link check', link);
    return true;
  }

  try {
    const response = await fetch(link, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.39 Electron/29.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
      },
    });
    if (response.status !== 200) {
      console.log('Broken link', link, response.status, response.statusText);
    } else {
      if (checkRedirects && response.redirected) {
        const wwwUrl = new URL(link);
        wwwUrl.hostname = `www.${wwwUrl.hostname}`;

        // For now cut down on noise to find meaningful redirects
        const wwwRedirect = wwwUrl.toString() === response.url;
        const trailingSlashRedirect = `${link}/` === response.url;

        if (!wwwRedirect && !trailingSlashRedirect) {
          console.log('Link redirection', link, '->', response.url);
        }
      }

      return true;
    }
  } catch {
    console.log('Broken link', link);
  }

  return false;
}

interface Options {
  allowAbsoluteLinks?: boolean;
  fetchExternalLinks?: boolean;
  checkRedirects?: boolean;
  ignoreGlobs?: string[];
}

async function main(
  workspaceRoot: string,
  globs: string[],
  {
    allowAbsoluteLinks = false,
    fetchExternalLinks = false,
    checkRedirects = false,
    ignoreGlobs = [],
  }: Options,
) {
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const parser = new MarkdownParser();
  const linkComputer = new MarkdownLinkComputer(workspace);
  const languageService = createLanguageService({
    workspace,
    parser,
    logger: new NoOpLogger(),
    linkComputer,
  });

  const cts = new CancellationTokenSource();
  let errors = false;

  const externalLinks = new Set<string>();

  try {
    // Collect diagnostics for all documents in the workspace
    for (const document of await workspace.getAllMarkdownDocuments()) {
      const absoluteLinks = new Set<any>();

      for (let link of await languageService.getDocumentLinks(document, cts.token)) {
        if (link.target === undefined) {
          link = (await languageService.resolveDocumentLink(link, cts.token)) ?? link;
        }

        if (!allowAbsoluteLinks && link.data && link.data.source.hrefText.startsWith('/')) {
          absoluteLinks.add(link);
        }

        if (
          link.target &&
          link.target.startsWith('http') &&
          new URL(link.target).hostname !== 'localhost'
        ) {
          externalLinks.add(link.target);
        }
      }
      const diagnostics = await languageService.computeDiagnostics(
        document,
        diagnosticOptions,
        cts.token,
      );

      if (diagnostics.length || absoluteLinks.size) {
        console.log(
          'File Location:',
          path.relative(URI.file(workspace.root).path, URI.parse(document.uri).path),
        );
      }

      for (const diagnostic of diagnostics) {
        console.log(
          `\tBroken link on line ${diagnostic.range.start.line + 1}:`,
          diagnostic.message,
        );
        errors = true;
      }

      for (const link of absoluteLinks) {
        console.log(
          `\tAbsolute link on line ${link.range.start.line + 1}:`,
          link.data.source.hrefText,
        );
        errors = true;
      }
    }
  } finally {
    cts.dispose();
  }

  if (fetchExternalLinks) {
    const externalLinkStates = await Promise.all(
      Array.from(externalLinks).map((link) => fetchExternalLink(link, checkRedirects)),
    );

    errors = errors || !externalLinkStates.every((x) => x);
  }

  return errors;
}

function parseCommandLine() {
  const showUsage = (): never => {
    console.log(
      'Usage: lint-roller-markdown-links [--root <dir>] <globs> [-h|--help] [--allow-absolute-links]' +
        '[--fetch-external-links] [--check-redirects] [--ignore <globs>]',
    );
    process.exit(1);
  };

  try {
    const opts = parseArgs({
      allowPositionals: true,
      options: {
        'allow-absolute-links': {
          type: 'boolean',
        },
        'fetch-external-links': {
          type: 'boolean',
        },
        'check-redirects': {
          type: 'boolean',
        },
        root: {
          type: 'string',
        },
        ignore: {
          type: 'string',
          multiple: true,
        },
        'ignore-path': {
          type: 'string',
        },
        help: {
          type: 'boolean',
        },
      },
    });

    if (opts.values.help || !opts.positionals.length) return showUsage();

    return opts;
  } catch {
    return showUsage();
  }
}

if ((await fs.promises.realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const { values: opts, positionals } = parseCommandLine();

  if (!opts.root) {
    opts.root = '.';
  }

  if (opts.ignore) {
    opts.ignore = Array.isArray(opts.ignore) ? opts.ignore : [opts.ignore];
  } else {
    opts.ignore = [];
  }

  if (opts['ignore-path']) {
    const ignores = fs.readFileSync(path.resolve(opts['ignore-path']), { encoding: 'utf-8' });

    for (const ignore of ignores.split('\n')) {
      opts.ignore.push(ignore.trimEnd());
    }
  }

  main(path.resolve(process.cwd(), opts.root), positionals, {
    allowAbsoluteLinks: opts['allow-absolute-links'],
    fetchExternalLinks: opts['fetch-external-links'],
    checkRedirects: opts['check-redirects'],
    ignoreGlobs: opts.ignore,
  })
    .then((errors) => {
      if (errors) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
