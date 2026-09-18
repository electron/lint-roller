# Unparseable

The formatter reports blocks it cannot parse:

```js
const a = {
  b: 1,

console.log(a
```

including orphan object literals:

```js
{ foo: }
```

at the right place when indented:

```js

    foo(: bar)
```

even when marked `@nolint`, which only the linter honours:

```js @nolint
{ bar: }
```

but not ones marked `@noformat`:

```ts @noformat
const x: = 1
```
