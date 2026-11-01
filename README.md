# mvmz-apple-mobile

Runs a released RPG Maker MV or MZ game on iOS and macOS. An MV or MZ game is a web page that carries its own engine as JavaScript. The core shows the game's `index.html` in a `WKWebView`, and makes the page look like NW.js, the desktop runtime that the game shipped for. The game keeps its saves as files in its own folder, as it does on a desktop.

## Use a release

Each release has `mvmz-ios.tar.gz`:

```
MANIFEST
licenses.json
include/mvmz_core.h
iphoneos/libmvmz.a
iphonesimulator/libmvmz.a
macosx/libmvmz.a
```

`src/mvmz_core.h` is the whole interface. Link the frameworks WebKit, UIKit (AppKit on macOS), Metal and UniformTypeIdentifiers next to the library.

`licenses.json` holds the license notice of the core, as `name`, `license` and `text`. Show it in the app.

`mvmz_start` returns the web view of the game. Put it in a visible window and set its frame. WebKit holds the page of a web view that is in no visible window.

## Build

You need Xcode with the iOS 26 and macOS 26 SDKs.

```sh
make SDK=iphonesimulator
make SDK=iphoneos
make SDK=macosx
```

The results go to `out/`.

`scripts/check-no-host-code.sh` fails when the core names a launcher or asks the host for a function. A host sets each value through `mvmz_core.h`.

## License

Copyright (C) 2026 Mateo M.

The code that Mateo M. wrote is under the [GPLv3](LICENSE), with [additional terms](ADDITIONAL-TERMS.md) that GPLv3 section 7 permits. Each of these files says so in its header. Code from other projects keeps its own license.

If you ship this core in an app, keep the text "mvmz-apple-mobile, Copyright (C) 2026 Mateo M., https://github.com/mateo-m/mvmz-apple-mobile" on the licenses or credits screen of the app, and do not say that you wrote this code. Versions before this change are under GPL-2.0.
