import { describe, expect, it } from 'vitest';

import { findCurlyBracedDirectives, parseJSONC } from '../lib/helpers.js';

describe('findCurlyBracedDirectives', () => {
  it('should return an empty array if no matches', () => {
    const matches = findCurlyBracedDirectives('foo', 'this is gibberish');
    expect(Array.isArray(matches)).toEqual(true);
    expect(matches.length).toEqual(0);
  });

  it('should return a match when there is one match', () => {
    const matches = findCurlyBracedDirectives('@ts-type', '@ts-type={foo: string}');
    expect(Array.isArray(matches)).toEqual(true);
    expect(matches.length).toEqual(1);
    expect(matches[0]).toEqual('foo: string');
  });

  it('should return a match when there are multiple matches', () => {
    const matches = findCurlyBracedDirectives(
      '@ts-type',
      '@ts-type={a: number} @ts-type={ anObject: { aProp: string } } @ts-type={debug: (url: string) => boolean} @ts-type={anObject: { foo: { bar: string } }} @ts-type={b: number}',
    );
    expect(Array.isArray(matches)).toEqual(true);
    expect(matches.length).toEqual(5);
    expect(matches).toEqual([
      'a: number',
      'anObject: { aProp: string }',
      'debug: (url: string) => boolean',
      'anObject: { foo: { bar: string } }',
      'b: number',
    ]);
  });
});

describe('parseJSONC', () => {
  it('should parse plain JSON', () => {
    expect(parseJSONC('{"a": 1, "b": [true, null, "c"]}')).toEqual({ a: 1, b: [true, null, 'c'] });
  });

  it('should strip line and block comments', () => {
    const text = `{
      // line comment
      "a": 1, /* block
      comment */ "b": "// not a comment", "c": "/* also not */"
    }`;
    expect(parseJSONC(text)).toEqual({ a: 1, b: '// not a comment', c: '/* also not */' });
  });

  it('should allow trailing commas', () => {
    const text = String.raw`{"a": [1, 2, ], "b": "quoted \" bracket, ]", /* comment */ }`;
    expect(parseJSONC(text)).toEqual({ a: [1, 2], b: 'quoted " bracket, ]' });
  });

  it('should throw on invalid input', () => {
    expect(() => parseJSONC('{"a": /* unterminated')).toThrow(SyntaxError);
    expect(() => parseJSONC('{"a": }')).toThrow(SyntaxError);
  });
});
