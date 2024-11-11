export const names = ['EMD004', 'no-newline-in-links'];
export const description = 'Newlines inside link text';
export const tags = ['newline', 'links'];
export const parser = 'markdownit';

function EMD004(params, onError) {
  const tokens = params.parsers.markdownit.tokens.filter((token) => token.type === 'inline');

  for (const token of tokens) {
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
          onError({ lineNumber });
          break;
        } else {
          lineNumber++;
        }
      }
    }
  }
}

export { EMD004 as function };
