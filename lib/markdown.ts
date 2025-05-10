import * as fs from 'node:fs';
import * as path from 'node:path';

import * as glob from 'glob';
import MarkdownIt from 'markdown-it';
import {
  githubSlugifier,
  resolveInternalDocumentLink,
  ExternalHref,
  FileStat,
  HrefKind,
  InternalHref,
  IMdLinkComputer,
  IMdParser,
  ITextDocument,
  IWorkspace,
  MdLink,
  MdLinkKind,
} from '@dsanders11/vscode-markdown-languageservice';
import { visit } from 'unist-util-visit';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { Emitter, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import type { Code, Definition, ImageReference, Link, LinkReference } from 'mdast';
import type { Node, Position } from 'unist';

export type { Code };

// Helper function from `vscode-markdown-languageservice` codebase
function tryDecodeUri(str: string): string {
  try {
    return decodeURI(str);
  } catch {
    return str;
  }
}

// Helper function from `vscode-markdown-languageservice` codebase
function createHref(
  sourceDocUri: URI,
  link: string,
  workspace: IWorkspace,
): ExternalHref | InternalHref | undefined {
  if (/^[a-z-][a-z-]+:/i.test(link)) {
    // Looks like a uri
    return { kind: HrefKind.External, uri: URI.parse(tryDecodeUri(link)) };
  }

  const resolved = resolveInternalDocumentLink(sourceDocUri, link, workspace);
  if (!resolved) {
    return undefined;
  }

  return {
    kind: HrefKind.Internal,
    path: resolved.resource,
    fragment: resolved.linkFragment,
  };
}

function positionToRange(position: Position): Range {
  return {
    start: {
      character: position.start.column - 1,
      line: position.start.line - 1,
    },
    end: { character: position.end.column - 1, line: position.end.line - 1 },
  };
}

const mdIt = MarkdownIt({ html: true });

export class MarkdownParser implements IMdParser {
  slugifier = githubSlugifier;

  async tokenize(document: TextDocument) {
    return mdIt.parse(document.getText(), {});
  }
}

export class DocsWorkspace implements IWorkspace {
  private readonly documentCache: Map<string, TextDocument>;
  readonly root: string;
  readonly globs: string[];
  readonly ignoreGlobs: string[];

  constructor(root: string, globs: string[], ignoreGlobs: string[] = []) {
    this.documentCache = new Map();
    this.root = root;
    this.globs = globs;
    this.ignoreGlobs = ignoreGlobs;
  }

  get workspaceFolders() {
    return [URI.file(this.root)];
  }

  async getAllMarkdownDocuments(): Promise<Iterable<TextDocument>> {
    const files = this.globs.flatMap((pattern) =>
      glob.sync(pattern, { ignore: this.ignoreGlobs, absolute: true, cwd: this.root }),
    );

    for (const file of files) {
      const document = TextDocument.create(
        URI.file(file).toString(),
        'markdown',
        1,
        fs.readFileSync(file, 'utf8'),
      );

      this.documentCache.set(file, document);
    }

    return this.documentCache.values();
  }

  hasMarkdownDocument(resource: URI) {
    const relativePath = this.getWorkspaceRelativePath(resource);
    return (
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath) &&
      fs.existsSync(resource.fsPath)
    );
  }

  getWorkspaceRelativePath(resource: URI) {
    return path.relative(path.resolve(this.root), resource.fsPath);
  }

  async openMarkdownDocument(resource: URI) {
    if (!this.documentCache.has(resource.fsPath)) {
      try {
        const document = TextDocument.create(
          resource.toString(),
          'markdown',
          1,
          fs.readFileSync(resource.fsPath, 'utf8'),
        );

        this.documentCache.set(resource.fsPath, document);
      } catch {
        return undefined;
      }
    }

    return this.documentCache.get(resource.fsPath);
  }

  async stat(resource: URI): Promise<FileStat | undefined> {
    if (this.hasMarkdownDocument(resource)) {
      const stats = fs.statSync(resource.fsPath);
      return { isDirectory: stats.isDirectory() };
    }

    return undefined;
  }

  async readDirectory(): Promise<Iterable<readonly [string, FileStat]>> {
    throw new Error('Not implemented');
  }

  //
  // These events are defined to fulfill the interface, but are never emitted
  // by this implementation since it's not meant for watching a workspace
  //

  #onDidChangeMarkdownDocument = new Emitter<ITextDocument>();
  onDidChangeMarkdownDocument = this.#onDidChangeMarkdownDocument.event;

  #onDidCreateMarkdownDocument = new Emitter<ITextDocument>();
  onDidCreateMarkdownDocument = this.#onDidCreateMarkdownDocument.event;

  #onDidDeleteMarkdownDocument = new Emitter<URI>();
  onDidDeleteMarkdownDocument = this.#onDidDeleteMarkdownDocument.event;
}

export class MarkdownLinkComputer implements IMdLinkComputer {
  private readonly workspace: IWorkspace;

  constructor(workspace: IWorkspace) {
    this.workspace = workspace;
  }

  async getAllLinks(document: ITextDocument): Promise<MdLink[]> {
    const tree = fromMarkdown(document.getText());

    const links = [
      ...(await this.#getInlineLinks(document, tree)),
      ...(await this.#getReferenceLinks(document, tree)),
      ...(await this.#getLinkDefinitions(document, tree)),
    ];

    return links;
  }

  async #getInlineLinks(document: ITextDocument, tree: Node): Promise<MdLink[]> {
    const documentUri = URI.parse(document.uri);
    const links: MdLink[] = [];

    visit(tree, 'link', (node: Node) => {
      const link = node as Link;
      const href = createHref(documentUri, link.url, this.workspace);

      if (href) {
        const range = positionToRange(link.position!);

        // NOTE - These haven't been implemented properly, but their
        //        values aren't used for the link linting use-case
        const targetRange = range;
        const hrefRange = range;
        const fragmentRange = undefined;

        links.push({
          kind: MdLinkKind.Link,
          href,
          source: {
            hrefText: link.url,
            resource: documentUri,
            range,
            targetRange,
            hrefRange,
            fragmentRange,
            pathText: link.url.split('#')[0],
          },
        });
      }
    });

    return links;
  }

  async #getReferenceLinks(document: ITextDocument, tree: Node): Promise<MdLink[]> {
    const links: MdLink[] = [];

    visit(tree, ['imageReference', 'linkReference'], (node: Node) => {
      const link = node as ImageReference | LinkReference;
      const range = positionToRange(link.position!);

      // NOTE - These haven't been implemented properly, but their
      //        values aren't used for the link linting use-case
      const targetRange = range;
      const hrefRange = range;

      links.push({
        kind: MdLinkKind.Link,
        href: {
          kind: HrefKind.Reference,
          ref: link.label!,
        },
        source: {
          hrefText: link.label!,
          resource: URI.parse(document.uri),
          range,
          targetRange,
          hrefRange,
          fragmentRange: undefined,
          pathText: link.label!,
        },
      });
    });

    return links;
  }

  async #getLinkDefinitions(document: ITextDocument, tree: Node): Promise<MdLink[]> {
    const documentUri = URI.parse(document.uri);
    const links: MdLink[] = [];

    visit(tree, 'definition', (node: Node) => {
      const definition = node as Definition;
      const href = createHref(documentUri, definition.url, this.workspace);

      if (href) {
        const range = positionToRange(definition.position!);

        // NOTE - These haven't been implemented properly, but their
        //        values aren't used for the link linting use-case
        const targetRange = range;
        const hrefRange = range;
        const fragmentRange = undefined;

        links.push({
          kind: MdLinkKind.Definition,
          href,
          ref: {
            range,
            text: definition.label!,
          },
          source: {
            hrefText: definition.url,
            resource: documentUri,
            range,
            targetRange,
            hrefRange,
            fragmentRange,
            pathText: definition.url.split('#')[0],
          },
        });
      }
    });

    return links;
  }
}

export async function getCodeBlocks(content: string): Promise<Code[]> {
  const tree = fromMarkdown(content);

  const codeBlocks: Code[] = [];

  visit(tree, 'code', (node: Node) => {
    codeBlocks.push(node as Code);
  });

  return codeBlocks;
}
