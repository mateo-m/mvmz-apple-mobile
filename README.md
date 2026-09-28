# mvmz-apple-mobile

Runs a released RPG Maker MV or MZ game on iOS. An MV or MZ game is a web page that carries its own engine as JavaScript. The core shows the game's `index.html` in a `WKWebView`, and makes the page look like NW.js, the desktop runtime that the game shipped for. The game keeps its saves as files in its own folder, as it does on a desktop.

## Use a release

Each release has `mvmz-ios.tar.gz`:

```
MANIFEST
include/mvmz_core.h
iphoneos/libmvmz.a
iphonesimulator/libmvmz.a
```

`src/mvmz_core.h` is the whole interface. Link the frameworks WebKit, UIKit, Metal and UniformTypeIdentifiers next to the library.

`mvmz_start` returns the web view of the game. Put it in a visible window and set its frame. WebKit holds the page of a web view that is in no visible window.

## Build

You need Xcode with the iOS 26 SDK.

```sh
make SDK=iphonesimulator
make SDK=iphoneos
```

The results go to `out/`.

`scripts/check-no-host-code.sh` fails when the core names a launcher or asks the host for a function. A host sets each value through `mvmz_core.h`.

## License

GPL-2.0. See `LICENSE`.
