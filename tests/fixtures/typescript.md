# TypeScript Blocks

This JS block is fine:

```js
const foo = 1
console.log(foo)
```

This TS block has a lint error, but is only linted with `--typescript`:

```ts
const foo: number = 2
if (foo == 1) console.log('foo is one')
```

So does this one:

```typescript
const bar: string | undefined = process.env.BAR
if (bar == undefined) console.log('bar is not defined')
```
