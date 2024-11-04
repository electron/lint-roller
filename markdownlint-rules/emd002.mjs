import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';

export const names = ['EMD002', 'no-angle-brackets'];
export const description =
  'No unescaped opening angle brackets in text (does not play nice with MDX)';
export const tags = ['brackets'];

const UNESCAPED_REGEX = /(?<!\\)<(?!\s)/g;

function EMD002(params, onError) {
  const tokens = params.parsers.markdownit.tokens.filter((token) => token.type === 'inline');

  for (const token of tokens) {
    for (const childToken of token.children) {
      // childToken.line has the raw content, but may also contain
      // more content than just childToken.content. Since we need
      // the raw content to detect escaped angle brackets, parse
      // the raw content of any match a second time to avoid any
      // false positives.
      if (
        childToken.type === 'text' &&
        childToken.markup !== '&lt;' &&
        childToken.markup !== '&#60;' &&
        childToken.content.includes('<') &&
        childToken.line.match(UNESCAPED_REGEX) !== null
      ) {
        // The AST produced by mdast is easier to work with here
        // since it gives position data within the line
        const tree = fromMarkdown(childToken.line);

        visit(
          tree,
          (node) => node.type === 'text',
          (node) => {
            const rawContent = childToken.line.slice(
              node.position.start.offset,
              node.position.end.offset,
            );

            const matches = rawContent.matchAll(UNESCAPED_REGEX);

            for (const match of matches) {
              onError({
                lineNumber: childToken.lineNumber,
                detail: 'Unescaped opening angle bracket',
                range: [node.position.start.offset + 1 + match.index, 1],
              });
            }
          },
        );
      }
    }
  }
}

export { EMD002 as function };
