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

`lint-roller-markdown-oxlint` is a command to lint JS code blocks in Markdown
with `oxlint`, using the project's own `oxlint` installation and config
(`--config <path>` to use a different one). A handful of rules which don't
make sense for isolated code snippets (`no-undef`, `no-unused-vars`, etc.) are
always disabled. TypeScript code blocks are also linted if `--typescript` is
passed. With `--oxfmt` the code blocks are additionally checked for formatting
with `oxfmt`, using `.oxfmtrc.json(c)` from the working directory or the config
provided with `--oxfmt-config <path>`. `--fix` writes lint and formatting fixes
back to the Markdown files. Linting can be disabled for specific code blocks by
adding `@nolint` to the info string. Code blocks are linted from a temporary
directory, so path-based `overrides` in either config do not apply to them.
`oxlint` (and `oxfmt` if used) must be installed alongside this package.

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
