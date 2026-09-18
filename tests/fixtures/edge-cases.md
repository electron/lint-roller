# Edge Cases

An IIFE, which the formatter wants to guard with a leading semicolon:

```js
(async () => {
  await app.whenReady()
})()
```

> [!NOTE]
> A code block inside a callout:
>
> ```js
> var quoted = 'yes'
>
> console.log(quoted)
> ```

1. A code block inside a list item, with a blank line:

   ```js
   var listed = "yes"

   console.log(listed)
   ```

An object literal after a statement:

```js
var options = {}
console.log(options)
{
  foo: "bar"
}
```

- ```js
  var sameLine = "as the list marker"
  ```

An object literal with a stray blank line:

```js
{ padded: "yes" }

```

Empty and single-line literals:

```js
{}
```

```js
[]
```

```js
{ compare: left == right }
```

Two object literals in one block:

```js
{ label: "first" }
{ label: "second", used: first == second }
```

Literals with a little more going on around them:

```js
{
  pattern: /[{]$/,
  brace: "}"
} // the options
const re = /abc/
{
  detail: "not chained"
}
/xyz/.test(detail)
const explicit = true
{ terminated: explicit == true };
let step = 1
{ rate: step++ / explicit, next: step == 2 }
step++
{ after: "an increment" }
const inTemplate = `${
{ toString: () => "not a statement" }
}`
```
