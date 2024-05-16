const { addError, filterTokens } = require('markdownlint/helpers');

module.exports = {
  names: ['EMD004', 'no-newline-in-links'],
  description: 'Newlines inside link text',
  tags: ['newline', 'links'],
  parser: 'markdownit',
  function: function EMD004(params, onError) {
    filterTokens(params, 'inline', (token) => {
      const { children } = token;
      let { lineNumber } = token;
      let inLink = false;
      for (const child of children) {
        const { type } = child;
        if (type === 'link_open') {
          inLink = true;
        } else if (type === 'link_close') {
          inLink = false;
        } else if (type === 'softbreak') {
          if (inLink) {
            addError(onError, lineNumber);
            break;
          } else {
            lineNumber++;
          }
        }
      }
    });
  },
};
