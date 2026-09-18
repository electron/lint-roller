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
