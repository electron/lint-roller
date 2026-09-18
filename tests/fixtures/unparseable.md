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

but not ones marked `@nolint`:

```ts @nolint
const x: = 1
```
