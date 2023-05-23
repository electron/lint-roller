# @electron/lint-roller

[![CircleCI](https://dl.circleci.com/status-badge/img/gh/electron/lint-roller/tree/main.svg?style=shield)](https://dl.circleci.com/status-badge/redirect/gh/electron/lint-roller/tree/main)
[![npm version](http://img.shields.io/npm/v/@electron/lint-roller.svg)](https://npmjs.org/package/@electron/lint-roller)

> Markdown linting helpers for Electron org repos

## Usage

```bash
yarn global add @electron/lint-roller

electron-markdownlint "**/*.md"
electron-lint-markdown-links --root docs/ "docs/**/*.md"
```

## What It Provides

A base config for `markdownlint` is provided for consistent linting rules
across repos. To use the base config, extend it in `.markdownlint.json`:

```json
{
  "extends": "@electron/lint-roller/configs/markdownlint.json"
}
```

`electron-markdownlint` is provided as a wrapper command which adds extra
rules found in this package automatically.

`electron-lint-markdown-links` is a command to further lint links to find
broken relative links, including URL fragments, and can also be used to
check external links with the `--fetch-external-links` option.

`electron-lint-markdown-standard` is a command to lint JS code blocks in
Markdown with `standard`, like `standard-markdown` does, but with better
detection of code blocks.

`electron-lint-markdown-ts-check` is a command to type check JS code blocks in
Markdown with `tsc`. Type checking can be disabled for specific code blocks
by adding `@ts-nocheck` to the info string, specific lines can be ignored
by adding `@ts-ignore=[<line1>,<line2>]` to the info string, and additional
globals can be defined with `@ts-type={name:type}`.

## License

MIT
