# @electron/lint-roller

[![Test](https://github.com/electron/lint-roller/actions/workflows/test.yml/badge.svg)](https://github.com/electron/lint-roller/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@electron/lint-roller.svg)](https://npmjs.org/package/@electron/lint-roller)

> Markdown linting helpers for Electron org repos

## Usage

```bash
yarn global add @electron/lint-roller

lint-roller-markdown-links --root docs/ "docs/**/*.md"
```

## What It Provides

A base config for `markdownlint` is provided for consistent linting rules
across repos. To use the base config, extend it in `.markdownlint.json`:

```json
{
  "extends": "@electron/lint-roller/configs/markdownlint.json"
}
```

`lint-roller-markdown-links` is a command to further lint links to find
broken relative links, including URL fragments, and can also be used to
check external links with the `--fetch-external-links` option.

`lint-roller-markdown-standard` is a command to lint JS code blocks in
Markdown with `standard`, like `standard-markdown` does, but with better
detection of code blocks. Linting can be disabled for specific code blocks
by adding `@nolint` to the info string.

`lint-roller-markdown-ts-check` is a command to type check JS/TS code blocks
in Markdown with `tsc`. Type checking can be disabled for specific code blocks
by adding `@ts-nocheck` to the info string, specific lines can be ignored by
adding `@ts-expect-error=[<line1>,<line2>]` to the info string, and additional
globals can be defined with `@ts-type={name:type}`. The `Window` object can
be extended with more types using `@ts-window-type={name:type}`. When type
checking TypeScript blocks in the same Markdown file, global augmentation
(via `declare global`) can be shared between code blocks by putting
`@ts-noisolate` on the code block doing the global augmentation.

## License

MIT
