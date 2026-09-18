import * as fs from 'node:fs';

import { TextDocument, TextEdit, Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { getCodeBlocks, DocsWorkspace } from './markdown.js';
import type { Code } from './markdown.js';

export const JS_LANGS = ['javascript', 'js', 'cjs', 'mjs'];
export const TS_LANGS = ['typescript', 'ts', 'cts', 'mts'];

export interface CodeBlock {
  /** Workspace-relative path of the Markdown file */
  filepath: string;
  document: TextDocument;
  code: Code;
  /** Lowercased language identifier from the info string */
  lang: string;
  /** File extension matching `lang` */
  ext: string;
  /** Contents of the code block with line endings normalized to LF */
  value: string;
  /** 1-based line of the opening code fence */
  line: number;
  /** 1-based column of the opening code fence */
  column: number;
}

export interface Problem {
  line: number;
  column: number;
  message: string;
}

/**
 * Collects problems per file and prints them in the order the files were
 * first seen, in the same format lint-roller-markdown-standard used
 */
export class Problems {
  private readonly problems = new Map<string, Problem[]>();

  addFile(filepath: string) {
    if (!this.problems.has(filepath)) {
      this.problems.set(filepath, []);
    }
  }

  add(filepath: string, problem: Problem) {
    this.addFile(filepath);
    this.problems.get(filepath)!.push(problem);
  }

  print(workspaceRoot: string): number {
    let totalErrors = 0;

    for (const [filepath, fileProblems] of this.problems) {
      if (!fileProblems.length) {
        continue;
      }

      totalErrors += fileProblems.length;
      fileProblems.sort((a, b) => a.line - b.line || a.column - b.column);

      console.log(`\n   ${filepath}`);

      for (const problem of fileProblems) {
        const lineInfo = `${problem.line}:${problem.column}: `.padEnd(10);
        console.log(`         ${lineInfo}${problem.message}`);
      }
    }

    console.log(`\nThere are ${totalErrors} errors in '${workspaceRoot}'`);

    return totalErrors;
  }
}

/**
 * Finds all fenced code blocks in the workspace whose (case-insensitive)
 * language identifier is one of `langs`, skipping empty blocks and those
 * marked `@nolint` in their info string. With `checkCase` any language
 * identifiers which aren't lowercase are reported to `problems`.
 */
export async function findCodeBlocks(
  workspace: DocsWorkspace,
  langs: string[],
  problems: Problems,
  { checkCase = false } = {},
): Promise<CodeBlock[]> {
  const blocks: CodeBlock[] = [];

  for (const document of await workspace.getAllMarkdownDocuments()) {
    const filepath = workspace.getWorkspaceRelativePath(URI.parse(document.uri));

    // Register every file up front so output ordering follows the workspace
    problems.addFile(filepath);

    for (const code of await getCodeBlocks(document.getText())) {
      const lang = code.lang?.toLowerCase();

      if (!lang || !langs.includes(lang)) {
        continue;
      }

      const line = code.position!.start.line;
      const column = code.position!.start.column;

      if (checkCase && code.lang !== lang) {
        problems.add(filepath, {
          line,
          column,
          message: 'Code block language identifier should be all lowercase',
        });
      }

      if (code.meta?.split(' ').includes('@nolint')) {
        continue;
      }

      // Line endings are normalized here and restored in writeCodeBlockChanges
      const value = code.value.replace(/\r$/gm, '');

      if (!value.trim()) {
        continue;
      }

      blocks.push({
        filepath,
        document,
        code,
        lang,
        ext: lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : lang,
        value,
        line,
        column,
      });
    }
  }

  return blocks;
}

/**
 * Writes new content for code blocks back to their Markdown files,
 * preserving line endings and any indentation or blockquote prefix
 */
export function writeCodeBlockChanges(workspace: DocsWorkspace, changes: Map<CodeBlock, string>) {
  const edits = new Map<TextDocument, TextEdit[]>();

  for (const [block, text] of changes) {
    if (text === block.value) {
      continue;
    }

    const { document } = block;
    const position = block.code.position!;
    const eol = document.getText().includes('\r\n') ? '\r\n' : '\n';

    // Note that the code block positions are 1-based, but Range is 0-based
    const getLine = (line: number) =>
      document
        .getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } })
        .replace(/\r?\n$/, '');
    const openingFenceLine = getLine(position.start.line - 1);
    const closingFenceLine = getLine(position.end.line - 1);

    // Code block might be indented, in a blockquote, or start on the same
    // line as a list marker, so take whatever preceded the opening code fence
    // (with anything other than blockquote markers blanked out) and use that
    // to prefix each line, with trailing whitespace trimmed for blank lines
    const prefix = openingFenceLine.slice(0, position.start.column - 1).replace(/[^\s>]/g, ' ');
    const blankPrefix = prefix.trimEnd();

    // An unterminated code block runs to the end of the document and can't
    // be safely rewritten, so leave it be - other tools will flag it
    if (
      position.end.line === position.start.line ||
      !/^[\s>]*(`{3,}|~{3,})\s*$/.test(closingFenceLine)
    ) {
      continue;
    }

    const newText = text
      .split('\n')
      .map((line) => (line.length ? `${prefix}${line}` : blankPrefix))
      .join(eol);

    // The code block position includes the surrounding code fences,
    // so replace everything from the start of the first line inside
    // them up to the start of the line with the closing code fence
    const range: Range = {
      start: { line: position.start.line, character: 0 },
      end: { line: position.end.line - 1, character: 0 },
    };

    const documentEdits = edits.get(document) ?? [];
    documentEdits.push({ range, newText: `${newText}${eol}` });
    edits.set(document, documentEdits);
  }

  for (const [document, documentEdits] of edits) {
    const uri = URI.parse(document.uri);
    console.log(`File has changed: ${workspace.getWorkspaceRelativePath(uri)}`);
    fs.writeFileSync(uri.fsPath, TextDocument.applyEdits(document, documentEdits));
  }
}

/** 0-based, inclusive range of lines in a code block */
export interface LineRange {
  start: number;
  end: number;
}

// A line ending with one of these continues onto the next line, e.g.
// `const options =` followed by an object literal on the next line
const CONTINUES_ONTO_NEXT_LINE = /[=([{,:?+\-*/%&|^!~<>]$/;

// A line starting with one of these continues on from the previous line,
// e.g. a method chain or operator following an array literal (now that
// comments are out of the picture)
const CONTINUES_FROM_PREVIOUS_LINE = /^(?:[.?,:)\]}*%&|^=<>/]|[+-](?![+-]))/;

/**
 * Blanks out the insides of comments and string literals in some code, so
 * that brackets and such in them don't confuse things, leaving every other
 * character (including newlines) at the same index
 */
export function maskStringsAndComments(code: string): string {
  let state: 'code' | 'line-comment' | 'block-comment' | "'" | '"' | '`' = 'code';
  let masked = '';

  // Unclosed braces for each template literal substitution being scanned
  const substitutions: number[] = [];

  for (let idx = 0; idx < code.length; idx++) {
    const char = code[idx];
    const next = code[idx + 1];

    switch (state) {
      case 'code':
        if (char === '/' && (next === '/' || next === '*')) {
          state = next === '/' ? 'line-comment' : 'block-comment';
          masked += '  ';
          idx++;
        } else if (char === "'" || char === '"' || char === '`') {
          state = char;
          masked += char;
        } else if (char === '}' && substitutions.at(-1) === 0) {
          substitutions.pop();
          state = '`';
          masked += ' ';
        } else {
          if (substitutions.length && (char === '{' || char === '}')) {
            substitutions[substitutions.length - 1] += char === '{' ? 1 : -1;
          }
          masked += char;
        }
        break;

      case 'line-comment':
        if (char === '\n') state = 'code';
        masked += char === '\n' ? char : ' ';
        break;

      case 'block-comment':
        if (char === '*' && next === '/') {
          state = 'code';
          masked += '  ';
          idx++;
        } else {
          masked += char === '\n' ? char : ' ';
        }
        break;

      default:
        // In a string of the `state` kind of quote
        if (char === '\\') {
          masked += next === '\n' ? ' \n' : next === undefined ? ' ' : '  ';
          idx++;
        } else if (char === state) {
          state = 'code';
          masked += char;
        } else if (char === '\n' && state !== '`') {
          // An unterminated string ends at the end of the line
          state = 'code';
          masked += char;
        } else if (char === '$' && next === '{' && state === '`') {
          substitutions.push(0);
          state = 'code';
          masked += '  ';
          idx++;
        } else {
          masked += char === '\n' ? char : ' ';
        }
    }
  }

  return masked;
}

/**
 * Finds bare object (and array) literals sitting on lines of their own in a
 * code block, which are common in documentation but need wrapping in parens
 * to be parsed as an expression rather than a block statement (the idea is
 * from zeke/standard-markdown, this just finds them a little more carefully)
 */
export function findOrphanObjects(value: string): LineRange[] {
  const lines = maskStringsAndComments(value).split('\n');
  const orphans: LineRange[] = [];
  let previousLine = '';

  for (let start = 0; start < lines.length; start++) {
    const opener = lines[start][0];

    if ((opener === '{' || opener === '[') && !CONTINUES_ONTO_NEXT_LINE.test(previousLine)) {
      const closer = opener === '{' ? '}' : ']';
      const rest = lines.slice(start).join('\n');
      let depth = 0;
      let end = -1;

      for (let idx = 0; idx < rest.length; idx++) {
        if (rest[idx] === opener) {
          depth++;
        } else if (rest[idx] === closer && --depth === 0) {
          // The matching closer should end a line for this to be a bare
          // literal, rather than say `[a, b].forEach(`
          if (/^[ \t]*(?:\n|$)/.test(rest.slice(idx + 1))) {
            end = start + rest.slice(0, idx).split('\n').length - 1;
          }
          break;
        }
      }

      if (end !== -1) {
        // What follows a literal might carry on the statement, e.g. `.map(`
        const nextLine = lines.slice(end + 1).find((line) => line.trim());

        if (!nextLine || !CONTINUES_FROM_PREVIOUS_LINE.test(nextLine.trim())) {
          orphans.push({ start, end });
          previousLine = lines[end].trim();
          start = end;
          continue;
        }
      }
    }

    if (lines[start].trim()) {
      previousLine = lines[start].trim();
    }
  }

  return orphans;
}

/**
 * What `wrapOrphanObjects` puts at the start of each literal's first line
 * (so putting columns on that line out by this much) and after its end
 */
export const ORPHAN_OBJECT_PREFIX = ';(';
export const ORPHAN_OBJECT_SUFFIX = ');';

/**
 * Wraps each of the bare object literals in a code block in parens, guarded
 * by semicolons so they stay separate from the statements on either side
 */
export function wrapOrphanObjects(value: string, orphans: LineRange[]): string {
  const lines = value.split('\n');

  for (const { start, end } of orphans) {
    lines[start] = `${ORPHAN_OBJECT_PREFIX}${lines[start]}`;
    lines[end] = `${lines[end]}${ORPHAN_OBJECT_SUFFIX}`;
  }

  return lines.join('\n');
}

/**
 * Undoes `wrapOrphanObjects` given the same ranges, or returns undefined if
 * the text has changed such that the wrapping is no longer where it was put
 */
export function unwrapOrphanObjects(text: string, orphans: LineRange[]): string | undefined {
  const lines = text.split('\n');

  for (const { start, end } of orphans) {
    if (
      !lines[start]?.startsWith(ORPHAN_OBJECT_PREFIX) ||
      !lines[end]?.endsWith(ORPHAN_OBJECT_SUFFIX)
    ) {
      return undefined;
    }

    lines[start] = lines[start].slice(ORPHAN_OBJECT_PREFIX.length);
    lines[end] = lines[end].slice(0, -ORPHAN_OBJECT_SUFFIX.length);
  }

  return lines.join('\n');
}
