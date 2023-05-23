These blocks are checked by default

```js
console.foo('whoops')
```

```js title='main.js'
console.foo('whoops')
```

These blocks are not checked

```js @ts-nocheck
console.bar('whoops')
```

```js title='main.js' @ts-nocheck
console.bar('whoops')
```

These blocks suppress specific lines (1-based)

```js @ts-ignore=[3]
console.log('test')

window.myAwesomeAPI()
```

```js title='main.js' @ts-ignore=[3]
console.log('test')

window.myAwesomeAPI()
```

```js @ts-expect-error=[3]
console.log('test')

window.myAwesomeAPI()
```

```js title='main.js' @ts-expect-error=[3]
console.log('test')

window.myAwesomeAPI()
```

These blocks have conflicting options

```js @ts-nocheck @ts-ignore=[3]
console.log('test')

window.myAwesomeAPI()
```

```js @ts-nocheck title='main.js' @ts-ignore=[3]
console.log('test')

window.myAwesomeAPI()
```

These blocks have bad usage of Electron APIs

```js
const { BrowserWindow } = require('electron')

BrowserWindow.wrongAPI('foo')
```

```js title='main.js'
const { BrowserWindow } = require('electron')

BrowserWindow.wrongAPI('foo')
```

These blocks have multiple @ts-ignore lines

```js @ts-ignore=[3,5]
console.log('test')

window.myAwesomeAPI()

window.myOtherAwesomeAPI()
```

```js @ts-ignore=[1,4]
window.myAwesomeAPI()

console.log('test')
window.myOtherAwesomeAPI()
```

This confirms @ts-ignore output is stripped

```js @ts-ignore=[2]
window.myAwesomeAPI()
window.myOtherAwesomeAPI()
```

This confirms @ts-ignore works if the previous line is a comment

```js @ts-ignore=[4]
console.log('test')

// This is a comment
window.myAwesomeAPI()
```

These blocks have multiple @ts-expect-error lines

```js @ts-expect-error=[3,5]
console.log('test')

window.myAwesomeAPI()

window.myOtherAwesomeAPI()
```

```js @ts-expect-error=[1,4]
window.myAwesomeAPI()

console.log('test')
window.myOtherAwesomeAPI()
```

This confirms @ts-expect-error output is stripped

```js @ts-expect-error=[2]
window.myAwesomeAPI()
window.myOtherAwesomeAPI()
```

This confirms @ts-expect-error works if the previous line is a comment

```js @ts-expect-error=[4]
console.log('test')

// This is a comment
window.myAwesomeAPI()
```

This block defines additional types

```js @ts-type={a: number} @ts-type={debug: (url: string) => boolean} @ts-type={b: number}
if (a > b) {
  debug('true')
} else {
  debug(`not true: ${a} < ${b}`)
}
```

This block has undefined variables

```js
if (a > b) {
  console.log('true')
} else {
  console.log(`not true: ${a} < ${b}`)
}
```
