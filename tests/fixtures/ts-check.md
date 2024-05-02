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

```js @ts-expect-error=[3]
console.log('test')

window.myAwesomeAPI()
```

```js title='main.js' @ts-expect-error=[3]
console.log('test')

window.myAwesomeAPI()
```

These blocks have conflicting options

```js @ts-nocheck @ts-expect-error=[3]
console.log('test')

window.myAwesomeAPI()
```

```js @ts-nocheck title='main.js' @ts-expect-error=[3]
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

```js @ts-type={a: number} @ts-type={anObject: { aProp: string }} @ts-type={debug: (url: string) => boolean} @ts-type={ anotherObject: { foo: { bar: string } } } @ts-type={b: number}
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

window.AwesomeAPI.bar('baz')
```

This block defines additional types on window

```js @ts-window-type={AwesomeAPI: { foo: (value: number) => void } }
window.AwesomeAPI.foo(42)
```

These TypeScript blocks have bad usage of Electron APIs

```ts
const { BrowserWindow } = require('electron')

BrowserWindow.wrongAPI('foo')
```

```TypeScript
import { BrowserWindow } from 'electron'

BrowserWindow.wrongAPI('foo')
```

The first block should be isolated from the third block but the second should not

```typescript
interface IAwesomeAPI {
  foo: (number) => void;
}

declare global {
  interface Window {
    AwesomeAPI: IAwesomeAPI;
  }
}

window.AwesomeAPI.foo(42)
```

```typescript @ts-noisolate
interface IOtherAwesomeAPI {
  bar: (string) => void;
}

declare global {
  interface Window {
    OtherAwesomeAPI: IOtherAwesomeAPI;
  }
}
```

```ts
window.AwesomeAPI.foo(42)
window.OtherAwesomeAPI.bar('baz')
```

```js @ts-expect-error=[1]
fs.wrongApi('hello')
```

```ts @ts-expect-error=[1]
fs.wrongApi('hello')
```
