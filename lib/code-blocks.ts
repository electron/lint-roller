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
