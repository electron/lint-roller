# Unparseable

The formatter reports blocks it cannot parse:

```js
const a = {
  b: 1,

console.log(a
```

including `json5` ones:

```json5
{ foo: }
```

even when marked `@nolint`, which only the linter honours:

```js @nolint
foo(: bar)
```

but not ones marked `@noformat`:

```ts @noformat
const x: = 1
```
