const { addError, filterTokens } = require('markdownlint/helpers');

module.exports = {
  names: ['EMD002', 'no-angle-brackets'],
  description: 'No unescaped opening angle brackets in text (does not play nice with MDX)',
  tags: ['brackets'],
  function: function EMD002(params, onError) {
    filterTokens(params, 'inline', (token) => {
      for (const childToken of token.children) {
        // childToken.line has the raw content, but may also contain
        // more content than just childToken.content. This may cause
        // the same line to produce multiple errors, unfortunately.
        if (
          childToken.type === 'text' &&
          childToken.markup !== '&lt;' &&
          childToken.markup !== '&#60;' &&
          childToken.content.includes('<') &&
          childToken.line.match(/(?<!\\)</g) !== null
        ) {
          addError(onError, token.lineNumber, 'Unescaped opening angle bracket');
        }
      }
    });
  },
};
