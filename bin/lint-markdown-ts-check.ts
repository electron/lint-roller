#!/usr/bin/env node

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as minimist from 'minimist';
import { rimraf } from 'rimraf';
import { URI } from 'vscode-uri';

import {
  chunkFilenames,
  findCurlyBracedDirectives,
  spawnAsync,
  wrapOrphanObjectInParens,
} from '../lib/helpers';
import { getCodeBlocks, DocsWorkspace } from '../lib/markdown';

interface Options {
  ignoreGlobs?: string[];
}

const ELECTRON_MODULES = [
  'app',
  'autoUpdater',
  'contextBridge',
  'crashReporter',
  'dialog',
  'BrowserWindow',
  'ipcMain',
  'ipcRenderer',
  'Menu',
  'MessageChannelMain',
  'nativeImage',
  'net',
  'protocol',
  'session',
  'systemPreferences',
  'Tray',
  'utilityProcess',
  'webFrame',
  'webFrameMain',
];

const NODE_IMPORTS =
  "const childProcess = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path')";

const DEFAULT_IMPORTS = `${NODE_IMPORTS}; const { ${ELECTRON_MODULES.join(
  ', ',
)} } = require('electron');`;

async function typeCheckFiles(
  tempDir: string,
  filenameMapping: Map<string, string>,
  filenames: string[],
) {
  const tscExec = path.join(require.resolve('typescript'), '..', '..', 'bin', 'tsc');
  const options = ['--noEmit', '--pretty', '--moduleDetection', 'force'];
  if (filenames.find((filename) => filename.endsWith('.js'))) {
    options.push('--checkJs');
  }
  const args = [
    tscExec,
    ...options,
    path.join(tempDir, 'electron.d.ts'),
    path.join(tempDir, 'ambient.d.ts'),
    ...filenames,
  ];
  const { status, stderr, stdout } = await spawnAsync(process.execPath, args);

  if (stderr) {
    throw new Error(stderr);
  }

  // Replace the temp file paths with the original source filename
  let correctedOutput = stdout.replace(
    new RegExp(
      `${path.relative(process.cwd(), tempDir)}${path.sep}`.replace(/\\/g, path.posix.sep),
      'g',
    ),
    '',
  );

  // Strip any @ts-expect-error/@ts-ignore comments we added
  correctedOutput = correctedOutput.replace(/ \/\/ @ts-(?:expect-error|ignore)/g, '');

  if (correctedOutput.trim()) {
    for (const [filename, originalFilename] of filenameMapping.entries()) {
      correctedOutput = correctedOutput.replace(
        new RegExp(path.basename(filename), 'g'),
        originalFilename,
      );
    }

    console.log(correctedOutput);
  }

  return status;
}

function parseDirectives(directive: string, value: string) {
  return findCurlyBracedDirectives(directive, value)
    .map((parsed) => parsed.match(/^([^:\r\n\t\f\v ]+):\s?(.+)$/))
    .filter((parsed): parsed is RegExpMatchArray => parsed !== null);
}

// TODO(dsanders11): Refactor to make this script general purpose and
// not tied to Electron - will require passing in the list of modules
// as a CLI option, probably a file since there's a lot of info
async function main(workspaceRoot: string, globs: string[], { ignoreGlobs = [] }: Options) {
  const workspace = new DocsWorkspace(workspaceRoot, globs, ignoreGlobs);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-ts-check-'));

  try {
    const filenames: string[] = [];
    const originalFilenames = new Map<string, string>();
    const isolateFilenames = new Set<string>();

    // Copy over the typings so that a relative path can be used
    fs.copyFileSync(path.join(process.cwd(), 'electron.d.ts'), path.join(tempDir, 'electron.d.ts'));

    let ambientModules = '';
    let errors = false;

    for (const document of await workspace.getAllMarkdownDocuments()) {
      const uri = URI.parse(document.uri);
      const filepath = workspace.getWorkspaceRelativePath(uri);
      const codeBlocks = (await getCodeBlocks(document)).filter(
        (code) =>
          code.lang && ['javascript', 'js', 'typescript', 'ts'].includes(code.lang.toLowerCase()),
      );

      for (const codeBlock of codeBlocks) {
        const isTypeScript =
          codeBlock.lang && ['typescript', 'ts'].includes(codeBlock.lang.toLowerCase());
        const line = codeBlock.position!.start.line;
        const indent = codeBlock.position!.start.column - 1;

        const tsNoCheck = codeBlock.meta?.split(' ').includes('@ts-nocheck');
        const tsNoIsolate = codeBlock.meta?.split(' ').includes('@ts-noisolate');
        const tsExpectErrorLines = codeBlock.meta
          ?.match(/\B@ts-expect-error=\[([\d,]*)\]\B/)?.[1]
          .split(',')
          .map((line) => parseInt(line));
        const tsIgnoreLines = codeBlock.meta
          ?.match(/\B@ts-ignore=\[([\d,]*)\]\B/)?.[1]
          .split(',')
          .map((line) => parseInt(line));
        const tsTypeLines = codeBlock.meta ? parseDirectives('@ts-type', codeBlock.meta) : [];
        const tsWindowTypeLines = codeBlock.meta
          ? parseDirectives('@ts-window-type', codeBlock.meta)
          : [];

        if (
          tsNoCheck &&
          (tsExpectErrorLines || tsIgnoreLines || tsTypeLines.length || tsWindowTypeLines.length)
        ) {
          console.log(
            `${filepath}:${line}:${
              indent + 1
            }: Code block has both @ts-nocheck and @ts-expect-error/@ts-ignore/@ts-type/@ts-window-type, they conflict`,
          );
          errors = true;
          continue;
        }

        // There should be no overlap between @ts-expect-error and @ts-ignore
        if (
          tsExpectErrorLines &&
          tsIgnoreLines &&
          tsExpectErrorLines.some((line) => tsIgnoreLines.includes(line))
        ) {
          console.log(
            `${filepath}:${line}:${
              indent + 1
            }: Code block has both @ts-expect-error and @ts-ignore with same line number(s)`,
          );
          errors = true;
          continue;
        }

        // Skip blocks with @ts-nocheck in their info string
        if (tsNoCheck) {
          continue;
        }

        // Skip empty code blocks
        if (!codeBlock.value.trim()) {
          continue;
        }

        const codeLines = codeBlock.value.split('\n');
        let insertedInitialLine = false;
        let types = '';
        let windowTypes = '';

        const insertComment = (comment: string, line: number) => {
          // Inserting additional lines will make the tsc output
          // incorrect which would be a pain to manually adjust,
          // and there is no @ts-ignore-line, so tack the comment
          // on to the end of the previous line - looks ugly but
          // we never have to see it since it's in a temp file.
          // The first line of the file is an edge case where an
          // insertion is necessary, so take that into account
          if (line === 1) {
            codeLines.unshift(comment);
            insertedInitialLine = true;
          } else {
            const offset = insertedInitialLine ? 1 : 2;
            const codeLine = codeLines[line - offset];
            // If the line is already a comment, fully replace it,
            // otherwise tsc won't pick up the inserted comment
            if (codeLine.match(/^\s*\/\/\s/)) {
              codeLines[line - offset] = comment;
            } else {
              codeLines[line - offset] = `${codeLine} ${comment}`;
            }
          }
        };

        // Blocks can have @ts-ignore=[1,10,50] in their info string
        // (1-based lines) to insert an "// @ts-ignore" comment before
        // specified lines, in order to ignore specific lines (like
        // requires of extra modules) without skipping the whole block
        for (const line of tsIgnoreLines ?? []) {
          insertComment('// @ts-ignore', line);
        }

        // Blocks can also have @ts-expect-error
        for (const line of tsExpectErrorLines ?? []) {
          insertComment('// @ts-expect-error', line);
        }

        // Indent the lines if necessary so that tsc output is accurate
        const code = wrapOrphanObjectInParens(
          codeLines
            .map((line) => (line.length ? line.padStart(line.length + indent) : line))
            .join('\n'),
        );

        // If there are no require() or import lines, insert a default set of
        // imports so that most snippets will have what they need.
        // This isn't foolproof and might cause name conflicts
        const imports = codeBlock.value.match(/^\s*(?:import .* from )|(?:.* = require())/m)
          ? ''
          : DEFAULT_IMPORTS;

        // Insert the necessary number of blank lines so that the line
        // numbers in output from tsc is accurate to the original file
        const blankLines = '\n'.repeat(insertedInitialLine ? line - 3 : line - 2);

        // Filename is unique since it is the name of the original Markdown
        // file, with the starting line number of the codeblock appended
        const filename = path.join(
          tempDir,
          `${filepath
            .replace(new RegExp(path.sep.replace(/\\/g, '\\\\'), 'g'), '-')
            .replace(/\./g, '-')}-${line}.${isTypeScript ? 'ts' : 'js'}`,
        );

        // Blocks can have @ts-type={name:type} in their info
        // string to declare a global variable for a block
        if (tsTypeLines.length) {
          // To support this feature, generate a random name for a
          // module, generate an ambient module declaration for the
          // module, and then import the global variables we're
          // defining from that module name - there's no code on
          // disk for it, only an ambient module declaration which
          // tsc will use to type the phantom variables being imported
          const moduleName = crypto.randomBytes(16).toString('hex');
          const extraTypes = tsTypeLines
            .map((type) => `  export var ${type[1]}: ${type[2]};`)
            .join('\n');
          ambientModules += `declare module "${moduleName}" {\n${extraTypes}\n}\n\n`;
          types = `const {${tsTypeLines
            .map((type) => type[1])
            .join(',')}} = require('${moduleName}')`;
        }

        // Blocks can have @ts-window-type={name:type} in their
        // info string to extend the Window object for a block
        if (!tsNoIsolate && tsWindowTypeLines.length) {
          const extraTypes = tsWindowTypeLines
            .map((type) => `    ${type[1]}: ${type[2]};`)
            .join('\n');
          // Needs an export {} at the end to make TypeScript happy
          windowTypes = `declare global {\n  interface Window {\n${extraTypes}\n  }\n}\n\nexport {};\n\n`;
          fs.writeFileSync(filename.replace(/.[jt]s$/, '-window.d.ts'), windowTypes);
          isolateFilenames.add(filename);
        } else if (!tsNoIsolate && code.match(/^\s*declare global /m)) {
          isolateFilenames.add(filename);
        } else {
          filenames.push(filename);
        }

        fs.writeFileSync(filename, `// @ts-check\n${imports}\n${blankLines}${code}\n${types}`);
        originalFilenames.set(filename, filepath);
      }
    }

    fs.writeFileSync(path.join(tempDir, 'ambient.d.ts'), ambientModules);

    // Files for code blocks with window type directives or 'declare global' need
    // to be processed separately since window types are by nature global, and
    // they would bleed between blocks otherwise, which can cause problems
    for (const filename of isolateFilenames) {
      const filenames = [filename];
      const windowTypesFilename = filename.replace(/.[jt]s$/, '-window.d.ts');
      try {
        fs.statSync(windowTypesFilename);
        filenames.unshift(windowTypesFilename);
      } catch {}

      const status = await typeCheckFiles(tempDir, originalFilenames, filenames);
      errors = errors || status !== 0;
    }

    // For the rest of the files, run them all at once so it doesn't take forever
    for (const chunk of chunkFilenames(filenames)) {
      const status = await typeCheckFiles(tempDir, originalFilenames, chunk);
      errors = errors || status !== 0;
    }

    return errors;
  } finally {
    await rimraf(tempDir);
  }
}

function parseCommandLine() {
  const showUsage = (arg?: string): boolean => {
    if (!arg || arg.startsWith('-')) {
      console.log(
        'Usage: electron-lint-markdown-ts-check --root <dir> <globs> [-h|--help]' +
          '[--ignore <globs>] [--ignore-path <path>]',
      );
      process.exit(1);
    }

    return true;
  };

  const opts = minimist(process.argv.slice(2), {
    boolean: ['help'],
    string: ['root', 'ignore', 'ignore-path'],
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

    for (const ignore of ignores.split('\n')) {
      opts.ignore.push(ignore.trimEnd());
    }
  }

  main(path.resolve(process.cwd(), opts.root), opts._, {
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
