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

These blocks ignore specific lines (1-based)

```js @ts-ignore=[3]
console.log('test')

window.myAwesomeAPI()
```

```js title='main.js' @ts-ignore=[3]
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
