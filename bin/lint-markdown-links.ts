#!/usr/bin/env node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createLanguageService,
  DiagnosticLevel,
  DiagnosticOptions,
  ILogger,
} from '@dsanders11/vscode-markdown-languageservice';
import * as minimist from 'minimist';
import fetch from 'node-fetch';
import { CancellationTokenSource } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import { DocsWorkspace, MarkdownLinkComputer, MarkdownParser } from '../lib/markdown';

class NoOpLogger implements ILogger {
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
  try {
    const response = await fetch(link);
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
  fetchExternalLinks?: boolean;
  checkRedirects?: boolean;
  ignoreGlobs?: string[];
}

async function main(
  workspaceRoot: string,
  globs: string[],
  { fetchExternalLinks = false, checkRedirects = false, ignoreGlobs = [] }: Options,
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
      for (let link of await languageService.getDocumentLinks(document, cts.token)) {
        if (link.target === undefined) {
          link = (await languageService.resolveDocumentLink(link, cts.token)) ?? link;
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

      if (diagnostics.length) {
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
  const showUsage = (arg?: string): boolean => {
    if (!arg || arg.startsWith('-')) {
      console.log(
        'Usage: electron-lint-markdown-links --root <dir> <globs> [-h|--help] [--fetch-external-links] ' +
          '[--check-redirects [--ignore <globs>]',
      );
      process.exit(1);
    }

    return true;
  };

  const opts = minimist(process.argv.slice(2), {
    boolean: ['help', 'fetch-external-links', 'check-redirects'],
    string: ['root', 'ignore', 'ignore-path'],
    stopEarly: true,
    unknown: showUsage,
  });

  if (opts.help || !opts.root || !opts._.length) showUsage();

  return opts;
}

if (require.main === module) {
  const opts = parseCommandLine();

  if (opts.ignore) {
    opts.ignore = Array.isArray(opts.ignore) ? opts.ignore : [opts.ignore];
  } else {
    opts.ignore = [];
  }

  if (opts['ignore-path']) {
    const ignores = fs.readFileSync(path.resolve(opts['ignore-path']), { encoding: 'utf-8' });

    for (const ignore of ignores.split(os.EOL)) {
      opts.ignore.push(ignore.trimEnd());
    }
  }

  main(path.resolve(process.cwd(), opts.root), opts._, {
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
