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

   console.log(listed == 'yes')
   ```

- ```js
  var sameLine = "as the list marker"
  ```

A `json5` code block, which only the formatter looks at:

```json5
{
  // comments are fine
  "quoted": "yes", unquoted: 'yes',
  list: [1,2,3]
}
```

> One inside a blockquote, with a stray blank line:
>
> ```json5
> { padded: "yes" }
>
> ```

Empty and single-line ones:

```json5
{}
```

```json5
[]
```
