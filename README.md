# @dsanders11/markdown-linting

[![Continuous Integration](https://github.com/dsanders11/markdown-linting/actions/workflows/test.yml/badge.svg)](https://github.com/dsanders11/markdown-linting/actions/workflows/test.yml)
[![npm version](http://img.shields.io/npm/v/@dsanders11/markdown-linting.svg)](https://npmjs.org/package/@dsanders11/markdown-linting)

> Markdown linting helpers for Electron org repos

## Usage

```bash
yarn global add @dsanders11/markdown-linting

electron-markdownlint "**/*.md"
electron-lint-markdown-links --root docs/
```

## What It Provides

A base config for `markdownlint` is provided for consistent linting rules
across repos. To use the base config, extend it in `.markdownlint.json`:

```json
{
  "extends": "@dsanders11/markdown-linting/configs/markdownlint.json"
}
```

`electron-markdownlint` is provided as a wrapper command which adds extra
rules found in this package automatically.

`electron-lint-markdown-links` is a command to further link links to find
broken relative links, including URL fragments, and can also be used to
check external links with the `--fetch-external-links` option.

## License

MIT
