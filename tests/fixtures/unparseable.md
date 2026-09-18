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

but not ones marked `@nolint`:

```ts @nolint
const x: = 1
```
