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

/** A bare object (or array) literal found by `findOrphanObjects` */
export interface OrphanObject {
  /** 0-based line the literal starts on, at column 0 */
  start: number;
  /** 0-based line with its closing bracket */
  end: number;
  /** Column on the `end` line just past the closing bracket */
  endColumn: number;
}

// A line ending with one of these continues onto the next line, e.g.
// `const options =` followed by an object literal on the next line (`/`
// is left out as it is far more likely to be closing a regex than division)
const CONTINUES_ONTO_NEXT_LINE = /[=([{,:?+\-*%&|^!~<>]$/;

// A line starting with one of these continues on from the previous line,
// e.g. a method chain or operator following an array literal (this is only
// used once comments are out of the picture, and leaves out `/` likewise)
const CONTINUES_FROM_PREVIOUS_LINE = /^(?:[.?,:)\]}*%&|^=<>]|[+-](?![+-]))/;

// A `/` following one of these (or one of the keywords, or nothing at all)
// starts a regex literal rather than being division
const PRECEDES_REGEX_LITERAL =
  /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|instanceof|new|delete|void|throw|yield|await))[ \t\n]*$/;

const CLOSING_BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * Blanks out the insides of comments, string literals and regex literals in
 * some code, so that brackets and such in them don't confuse things, leaving
 * every other character (including newlines) at the same index
 */
export function maskStringsAndComments(code: string): string {
  let state: 'code' | 'line-comment' | 'block-comment' | 'regex' | 'regex-class' | "'" | '"' | '`' =
    'code';
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
        } else if (char === '/' && PRECEDES_REGEX_LITERAL.test(masked)) {
          state = 'regex';
          masked += char;
        } else if (char === "'" || char === '"' || char === '`') {
          state = char;
          masked += char;
        } else if (char === '}' && substitutions.at(-1) === 0) {
          substitutions.pop();
          state = '`';
          masked += char;
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

      case 'regex':
      case 'regex-class':
        if (char === '\\' && next !== '\n' && next !== undefined) {
          masked += '  ';
          idx++;
        } else if ((char === '/' && state === 'regex') || char === '\n') {
          // (a regex literal can't span lines so a newline means this
          // was something else, but either way it is over)
          state = 'code';
          masked += char;
        } else {
          if (char === '[' && state === 'regex') state = 'regex-class';
          else if (char === ']' && state === 'regex-class') state = 'regex';
          masked += ' ';
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
          // The substitution is code again, and its `${` and `}` are kept
          // so that the code visibly continues on from the template around it
          substitutions.push(0);
          state = 'code';
          masked += '${';
          idx++;
        } else {
          masked += char === '\n' ? char : ' ';
        }
    }
  }

  return masked;
}

/**
 * Finds the index of the bracket matching the opening one at `from`, or -1,
 * in code which has been through `maskStringsAndComments`
 */
export function matchingBracket(code: string, from: number): number {
  const opener = code[from];
  const closer = CLOSING_BRACKETS[opener];
  let depth = 0;

  for (let idx = from; closer && idx < code.length; idx++) {
    if (code[idx] === opener) {
      depth++;
    } else if (code[idx] === closer && --depth === 0) {
      return idx;
    }
  }

  return -1;
}

/**
 * Sizes up the literal starting at column 0 of line `start` (of masked
 * code), if it turns out to be one which needs wrapping
 */
function measureOrphanObject(lines: string[], start: number): OrphanObject | undefined {
  const rest = lines.slice(start).join('\n');
  const close = matchingBracket(rest, 0);

  if (close === -1) {
    return undefined;
  }

  const literalLines = rest.slice(0, close + 1).split('\n');
  const end = start + literalLines.length - 1;
  const sameLine = /^.*/.exec(rest.slice(close + 1))![0].trim();
  const nextLine = (lines.slice(end + 1).find((line) => line.trim()) ?? '').trim();

  // Code carrying straight on from the closing bracket, or on the next
  // line, e.g. `[a, b].forEach(`, makes this part of some larger statement
  // which is left well alone (that is fine for an array literal anyway, and
  // an object literal gets reported as the syntax error it technically is)
  if (sameLine ? sameLine !== ';' : CONTINUES_FROM_PREVIOUS_LINE.test(nextLine)) {
    return undefined;
  }

  return { start, end, endColumn: literalLines[literalLines.length - 1].length };
}

/**
 * Finds bare object (and array) literals sitting on lines of their own in a
 * code block, which are common in documentation but need wrapping in parens
 * to be parsed as an expression rather than a block statement (the idea is
 * from zeke/standard-markdown, this just finds them a little more carefully)
 */
export function findOrphanObjects(value: string): OrphanObject[] {
  const lines = maskStringsAndComments(value).split('\n');
  const orphans: OrphanObject[] = [];
  let previousLine = '';

  for (let idx = 0; idx < lines.length; idx++) {
    const opener = lines[idx][0];
    const orphan =
      (opener === '{' || opener === '[') && !CONTINUES_ONTO_NEXT_LINE.test(previousLine)
        ? measureOrphanObject(lines, idx)
        : undefined;

    if (orphan) {
      orphans.push(orphan);
      idx = orphan.end;
    }

    if (lines[idx].trim()) {
      previousLine = lines[idx].trim();
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
export function wrapOrphanObjects(value: string, orphans: OrphanObject[]): string {
  const lines = value.split('\n');

  for (const { start, end, endColumn } of orphans) {
    lines[end] =
      lines[end].slice(0, endColumn) + ORPHAN_OBJECT_SUFFIX + lines[end].slice(endColumn);
    lines[start] = ORPHAN_OBJECT_PREFIX + lines[start];
  }

  return lines.join('\n');
}

/**
 * Undoes `wrapOrphanObjects` given the same literals, putting up with the
 * code having changed a bit in between (e.g. had lint fixes applied) but
 * returning undefined if the wrapping can no longer be found
 */
export function unwrapOrphanObjects(text: string, orphans: OrphanObject[]): string | undefined {
  const masked = maskStringsAndComments(text);
  const lineOffsets = [0];
  let result = text;

  for (let idx = text.indexOf('\n'); idx !== -1; idx = text.indexOf('\n', idx + 1)) {
    lineOffsets.push(idx + 1);
  }

  // (in reverse so that the offsets of those still to do are unaffected)
  for (const { start } of [...orphans].reverse()) {
    const prefixAt = lineOffsets[start];

    if (prefixAt === undefined || !text.startsWith(ORPHAN_OBJECT_PREFIX, prefixAt)) {
      return undefined;
    }

    // The suffix starts with the paren matching the one ending the prefix
    const suffixAt = matchingBracket(masked, prefixAt + ORPHAN_OBJECT_PREFIX.length - 1);

    if (suffixAt === -1 || !text.startsWith(ORPHAN_OBJECT_SUFFIX, suffixAt)) {
      return undefined;
    }

    result =
      result.slice(0, prefixAt) +
      result.slice(prefixAt + ORPHAN_OBJECT_PREFIX.length, suffixAt) +
      result.slice(suffixAt + ORPHAN_OBJECT_SUFFIX.length);
  }

  return result;
}
