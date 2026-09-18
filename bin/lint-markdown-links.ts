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

interface Options {
  allowAbsoluteLinks?: boolean;
  ignoreGlobs?: string[];
  resourceRoot?: string;
}

async function main(
  workspaceRoot: string,
  globs: string[],
  { allowAbsoluteLinks = false, ignoreGlobs = [], resourceRoot }: Options,
) {
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs, resourceRoot);
  const parser = new MarkdownParser();
  const linkComputer = new MarkdownLinkComputer(workspace, resourceRoot);
  const languageService = createLanguageService({
    workspace,
    parser,
    logger: new NoOpLogger(),
    linkComputer,
  });

  const cts = new CancellationTokenSource();
  let errors = false;

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

  return errors;
}

function parseCommandLine() {
  const showUsage = (): never => {
    console.log(
      'Usage: lint-roller-markdown-links [--root <dir>] <globs> [-h|--help] [--allow-absolute-links] ' +
        '[--ignore <globs>] [--ignore-path <path>] [--resource-root <dir>]',
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
        root: {
          type: 'string',
        },
        'resource-root': {
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
    ignoreGlobs: opts.ignore,
    resourceRoot: opts['resource-root']
      ? path.resolve(process.cwd(), opts['resource-root'])
      : undefined,
  })
    .then((errors) => {
      if (errors) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
