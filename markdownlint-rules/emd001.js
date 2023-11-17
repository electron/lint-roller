const { addError, getLineMetadata, getReferenceLinkImageData } = require('markdownlint/helpers');

// These are used by GitHub's "alert" extension to Markdown
// https://github.com/orgs/community/discussions/16925
const ALERT_KEYWORDS = ['!note', '!tip', '!important', '!warning', '!caution'];

module.exports = {
  names: ['EMD001', 'no-shortcut-reference-links'],
  description: 'Disallow shortcut reference links (those with no link label)',
  tags: ['images', 'links'],
  function: function EMD001(params, onError) {
    const lineMetadata = getLineMetadata(params);
    const { shortcuts } = getReferenceLinkImageData(lineMetadata);
    for (const [shortcut, occurrences] of shortcuts) {
      for (const [lineNumber] of occurrences) {
        if (!ALERT_KEYWORDS.includes(shortcut)) {
          addError(
            onError,
            lineNumber + 1, // human-friendly line numbers (1-based)
            `Disallowed shortcut reference link: "${shortcut}"`,
          );
        }
      }
    }
  },
};
