Some escaped angle brackets

Like Function\<[foo](bar)>

And Function&lt;[foo](bar)>

And Function&#60;[foo](bar)>

#### `ses.setUSBProtectedClassesHandler(handler)`

* `handler` Function\<string[]>  | null
  * `details` Object
    * `protectedClasses` string[] - The current list of protected USB classes. Possible class values include:
      * `audio`
      * `audio-video`
      * `hid`
      * `mass-storage`
      * `smart-card`
      * `video`
      * `wireless`

* `params` Record\<string, string\> - The other `<webview>` parameters such as the `src` URL.
