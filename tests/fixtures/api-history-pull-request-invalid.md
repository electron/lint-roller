#### `win.setTrafficLightPosition(position)` _macOS_ _Deprecated_

<!--
```YAML history
added:
  - pr-url: https://github.com/electron/electron/pull/225332672
changes:
  - pr-url: https://github.com/electron/electron/pull/26789
    description: Made `trafficLightPosition` option work for `customButtonOnHover`.
deprecated:
  - pr-url: https://github.com/electron/electron/pull/37094
    breaking-changes-header: deprecated-browserwindowsettrafficlightpositionposition
```
-->

Set a custom position for the traffic light buttons in frameless window.
Passing `{ x: 0, y: 0 }` will reset the position to default.
