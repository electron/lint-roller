import { addError, filterTokens } from 'markdownlint/helpers';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';

export const names = ['EMD003', 'no-curly-braces'];
export const description = 'No unescaped opening curly braces in text (does not play nice with MDX)';
export const tags = ['braces'];

const UNESCAPED_REGEX = /(?<!\\){/g;

function EMD003(params, onError) {
  filterTokens(params, 'inline', (token) => {
    for (const childToken of token.children) {
      // childToken.line has the raw content, but may also contain
      // more content than just childToken.content. Since we need
      // the raw content to detect escaped curly braces, parse
      // the raw content of any match a second time to avoid any
      // false positives.
      if (
        childToken.type === 'text' &&
        childToken.markup !== '&#123;' &&
        childToken.content.includes('{') &&
        childToken.line.match(UNESCAPED_REGEX) !== null
      ) {
        // The AST produced by mdast is easier to work with here
        // since it gives position data within the line
        const tree = fromMarkdown(childToken.line);

        visit(
          tree,
          (node) => node.type === 'text',
          (node) => {
            const rawContent = childToken.line.slice(node.position.start.offset, node.position.end.offset);

            if (rawContent.match(UNESCAPED_REGEX) !== null) {
              addError(onError, token.lineNumber, 'Unescaped opening curly brace');
            }
          },
        );
      }
    }
  });
};

export { EMD003 as function };
