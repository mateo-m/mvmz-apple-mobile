// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Mateo M. Additional terms apply: see ADDITIONAL-TERMS.md.

// Runs in the game page before the game's own scripts.
//
// RPG Maker MV and MZ games ship for NW.js, a desktop browser with
// Node.js inside. The engine checks for `require` and `process` to know
// it runs there, and then keeps its saves as files next to the game.
// This script gives the page those names, so the saves go to the game
// folder here too. The fs calls become synchronous requests to the
// core's file server (MvmzFileServer.m), because the engine reads and
// writes saves without waiting.
//
// It also answers the calls that mvmz_core.m makes through
// window.__mvmz.
(() => {
    "use strict";

    const settings = window.__mvmzSettings;
    const post = (message) => window.webkit.messageHandlers.mvmz.postMessage(message);
    const origin = location.protocol + "//" + location.host;

    // MARK: path

    const normalize = (p) => {
        const parts = [];
        for (const part of p.split("/")) {
            if (part === "..") parts.pop();
            else if (part && part !== ".") parts.push(part);
        }
        const tail = p.endsWith("/") && parts.length ? "/" : "";
        return (p.startsWith("/") ? "/" : "") + parts.join("/") + tail || ".";
    };
    const path = {
        sep: "/",
        delimiter: ":",
        normalize,
        join: (...parts) => normalize(parts.filter(Boolean).join("/")),
        resolve: (...parts) => {
            let out = process.cwd();
            for (const part of parts) out = part.startsWith("/") ? part : out + "/" + part;
            return normalize(out).replace(/(.)\/$/, "$1");
        },
        isAbsolute: (p) => p.startsWith("/"),
        dirname: (p) => {
            const trimmed = p.replace(/\/+$/, "");
            const i = trimmed.lastIndexOf("/");
            return i < 0 ? "." : i === 0 ? "/" : trimmed.slice(0, i);
        },
        basename: (p, ext) => {
            const base = p.replace(/\/+$/, "").split("/").pop();
            return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
        },
        extname: (p) => {
            const base = path.basename(p);
            const i = base.lastIndexOf(".");
            return i > 0 ? base.slice(i) : "";
        },
    };
    path.posix = path;

    // MARK: fs

    // "/" is the game folder.
    const urlFor = (p) =>
        origin + path.resolve(String(p)).split("/").map(encodeURIComponent).join("/");

    const send = (method, p, body, binary, headers = {}) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, urlFor(p), false);
        if (binary) xhr.overrideMimeType("text/plain; charset=x-user-defined");
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        xhr.send(body);
        return xhr;
    };

    const fail = (xhr, op, p) => {
        const code = xhr.status === 404 ? "ENOENT" : "EIO";
        const error = new Error(`${code}: ${op} '${p}' (${xhr.status} ${xhr.responseText})`);
        error.code = code;
        throw error;
    };

    const ok = (xhr, op, p) => {
        if (xhr.status >= 300) fail(xhr, op, p);
        return xhr;
    };

    const stat = (p) => {
        const xhr = ok(send("HEAD", p), "stat", p);
        const directory = xhr.getResponseHeader("X-Mvmz-Kind") === "directory";
        const mtime = new Date(Number(xhr.getResponseHeader("X-Mvmz-Mtime")) || 0);
        return {
            size: Number(xhr.getResponseHeader("Content-Length")) || 0,
            mtime,
            mtimeMs: mtime.getTime(),
            isFile: () => !directory,
            isDirectory: () => directory,
            isSymbolicLink: () => false,
        };
    };

    const fs = {
        existsSync: (p) => send("HEAD", p).status === 200,
        statSync: stat,
        lstatSync: stat,
        realpathSync: (p) => {
            const xhr = ok(send("HEAD", p, null, false, { "X-Mvmz-Real-Path": "1" }), "realpath", p);
            return decodeURIComponent(xhr.getResponseHeader("X-Mvmz-Real-Path"));
        },
        readFileSync: (p, options) => {
            const encoding = typeof options === "string" ? options : options && options.encoding;
            const xhr = ok(send("GET", p, null, !encoding), "open", p);
            if (encoding) return xhr.responseText;
            const text = xhr.responseText;
            const bytes = new Uint8Array(text.length);
            for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
            return bytes;
        },
        writeFileSync: (p, data) => void ok(send("PUT", p, data), "open", p),
        unlinkSync: (p) => void ok(send("DELETE", p), "unlink", p),
        rmdirSync: (p) => void ok(send("DELETE", p), "rmdir", p),
        mkdirSync: (p) => void ok(send("MKCOL", p), "mkdir", p),
        readdirSync: (p) => JSON.parse(ok(send("GET", p), "scandir", p).responseText),
        renameSync: (from, to) => {
            const xhr = new XMLHttpRequest();
            xhr.open("MOVE", urlFor(from), false);
            xhr.setRequestHeader("Destination", urlFor(to));
            xhr.send();
            ok(xhr, "rename", from);
        },
    };
    // Some plugins use the callback forms. They run the same requests
    // one turn later.
    for (const name of ["readFile", "writeFile", "unlink", "mkdir", "readdir", "stat", "rename", "rmdir"]) {
        fs[name] = (...args) => {
            const callback = typeof args[args.length - 1] === "function" ? args.pop() : () => {};
            setTimeout(() => {
                let result;
                try {
                    result = fs[name + "Sync"](...args);
                } catch (error) {
                    return callback(error);
                }
                callback(null, result);
            });
        };
    }
    fs.exists = (p, callback) => setTimeout(() => callback(fs.existsSync(p)));

    // MARK: crypto

    // Plugins hash files while they load, and WebCrypto can only hash
    // asynchronously.
    const K = new Int32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);

    const createSha256 = () => {
        const state = new Int32Array([
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
        ]);
        const w = new Int32Array(64);
        const tail = new Uint8Array(64);
        let filled = 0;
        let length = 0;

        const compress = (bytes, offset) => {
            for (let i = 0; i < 16; i++, offset += 4) {
                w[i] = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
            }
            for (let i = 16; i < 64; i++) {
                const x = w[i - 15];
                const y = w[i - 2];
                const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
                const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            let a = state[0];
            let b = state[1];
            let c = state[2];
            let d = state[3];
            let e = state[4];
            let f = state[5];
            let g = state[6];
            let h = state[7];
            for (let i = 0; i < 64; i++) {
                const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
                const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g;
                g = f;
                f = e;
                e = (d + t1) | 0;
                d = c;
                c = b;
                b = a;
                a = (t1 + t2) | 0;
            }
            state[0] += a;
            state[1] += b;
            state[2] += c;
            state[3] += d;
            state[4] += e;
            state[5] += f;
            state[6] += g;
            state[7] += h;
        };

        const update = (bytes) => {
            length += bytes.length;
            let i = 0;
            if (filled) {
                i = Math.min(64 - filled, bytes.length);
                tail.set(bytes.subarray(0, i), filled);
                filled += i;
                if (filled < 64) return;
                compress(tail, 0);
            }
            for (; i + 64 <= bytes.length; i += 64) compress(bytes, i);
            tail.set(bytes.subarray(i));
            filled = bytes.length - i;
        };

        const digest = () => {
            const padding = new Uint8Array((filled < 56 ? 64 : 128) - filled);
            padding[0] = 0x80;
            const view = new DataView(padding.buffer);
            view.setUint32(padding.length - 8, Math.floor(length / 2 ** 29));
            view.setUint32(padding.length - 4, (length * 8) >>> 0);
            update(padding);
            const result = new Uint8Array(32);
            state.forEach((x, i) => new DataView(result.buffer).setInt32(i * 4, x));
            return result;
        };

        return { update, digest };
    };

    const bytesOf = (data, encoding) => {
        if (typeof data === "string") {
            if (encoding === undefined || /^utf-?8$/i.test(encoding)) return new TextEncoder().encode(data);
            throw new Error(`Hash input encoding not supported: ${encoding}`);
        }
        if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const error = new TypeError("The data argument must be a string, a Buffer, a TypedArray, or a DataView");
        error.code = "ERR_INVALID_ARG_TYPE";
        throw error;
    };

    const crypto = {
        createHash: (algorithm) => {
            if (String(algorithm).toLowerCase() !== "sha256") {
                throw new Error(`Digest method not supported: ${algorithm}`);
            }
            const sha256 = createSha256();
            let finished = false;
            const checkOpen = () => {
                if (!finished) return;
                const error = new Error("Digest already called");
                error.code = "ERR_CRYPTO_HASH_FINALIZED";
                throw error;
            };
            const hash = {
                update: (data, encoding) => {
                    checkOpen();
                    sha256.update(bytesOf(data, encoding));
                    return hash;
                },
                digest: (encoding) => {
                    checkOpen();
                    if (encoding !== "hex") throw new Error(`Digest encoding not supported: ${encoding}`);
                    finished = true;
                    return Array.from(sha256.digest(), (x) => x.toString(16).padStart(2, "0")).join("");
                },
            };
            return hash;
        },
    };

    // MARK: NW.js

    const exit = () => post({ type: "exit" });
    const noop = () => {};
    // A plugin can call any window method (maximize, setResizable, ...).
    // None of them mean anything in a phone app.
    const nwWindow = new Proxy({}, { get: (target, key) => (key in target ? target[key] : noop) });
    const nwApp = { argv: [], manifest: {}, quit: exit, closeAllWindows: exit };
    const nwGui = { App: nwApp, Window: { get: () => nwWindow }, Menu: class { createMacBuiltin() {} } };
    const os = { platform: () => "linux", homedir: () => "/", tmpdir: () => "/", EOL: "\n" };
    const modules = { fs, path, os, crypto, "nw.gui": nwGui };

    // Plugins also load CommonJS files of the game folder.
    const loaded = new Map();
    const requireFrom = (folder) => (name) => {
        const found = modules[name.replace(/^node:/, "")];
        if (found) return found;
        const file = /^\.{0,2}\//.test(name)
            ? [name, `${name}.js`]
                  .map((p) => path.resolve(folder, p))
                  .find((p) => fs.existsSync(p) && !fs.statSync(p).isDirectory())
            : null;
        if (!file) {
            const error = new Error(`Cannot find module '${name}'`);
            error.code = "MODULE_NOT_FOUND";
            throw error;
        }
        // The file server finds a file whose name has other capitals, so
        // only the real path names one file.
        const real = fs.realpathSync(file);
        if (!loaded.has(real)) {
            const source = fs.readFileSync(real, "utf8");
            const module = { exports: {} };
            loaded.set(real, module);
            const dirname = path.dirname(real);
            try {
                if (real.endsWith(".json")) {
                    module.exports = JSON.parse(source);
                } else {
                    new Function("module", "exports", "require", "__filename", "__dirname", source).call(
                        module.exports,
                        module,
                        module.exports,
                        requireFrom(dirname),
                        real,
                        dirname,
                    );
                }
            } catch (error) {
                // As in Node, the next require of a file that failed runs it again.
                loaded.delete(real);
                throw error;
            }
        }
        return loaded.get(real).exports;
    };

    window.nw = nwGui;
    window.require = requireFrom("/");
    // MZ's main.js stops with an error when this path starts with
    // /private/var, so it must stay relative to the game folder.
    window.process = {
        platform: "linux",
        env: {},
        argv: [],
        versions: {},
        cwd: () => "/",
        exit,
        on: noop,
        mainModule: { filename: "/index.html" },
    };
    window.chrome = Object.assign(window.chrome || {}, { runtime: { reload: () => location.reload() } });
    window.close = exit;

    // The host reads the controllers itself and sends them as keys. The
    // engine would read them a second time through this API.
    navigator.getGamepads = () => [];

    // MZ updates the game only while the page has focus. The app window
    // keeps the focus, and the app pauses the game when it goes away.
    Document.prototype.hasFocus = () => true;

    // MARK: frames, pause, and speed

    const nativeRequestFrame = window.requestAnimationFrame.bind(window);
    const waiting = new Map();
    let nextId = 1;
    let scheduled = false;
    let paused = false;
    let reportFrame = true;
    let frameShown = false;
    let frames = 0;
    let speed = settings.speed;
    let speedApplied = false;
    let size = "";

    const applySpeed = () => {
        if (typeof SceneManager === "undefined") return;
        if (SceneManager.determineRepeatNumber) {
            // MZ runs as many updates as this says for each frame.
            if (!speedApplied) {
                const repeat = SceneManager.determineRepeatNumber;
                SceneManager.determineRepeatNumber = function (deltaTime) {
                    return repeat.call(this, deltaTime) * speed;
                };
            }
        } else {
            // MV runs one update for each _deltaTime seconds of real time.
            SceneManager._deltaTime = 1 / 60 / speed;
        }
        speedApplied = true;
    };

    const runFrame = (time) => {
        scheduled = false;
        if (paused) return;
        const callbacks = [...waiting.values()];
        waiting.clear();
        if (!speedApplied) {
            // The simulator says that it plays Ogg, then fails to decode
            // it. Without Ogg, MV loads the .m4a copy of each sound, and
            // MZ uses its own decoder.
            if (settings.simulator) {
                if (typeof WebAudio !== "undefined") WebAudio.canPlayOgg = () => false;
                if (typeof Utils !== "undefined") Utils.canPlayOgg = () => false;
            }
            applySpeed();
        }
        for (const callback of callbacks) callback(time);
        frames++;
        if (reportFrame && !bootReported && callbacks.length) {
            reportFrame = false;
            frameShown = true;
            post({ type: "frame" });
        }
        // A game or a plugin can change the resolution from any script,
        // and no event reports it.
        if (typeof Graphics !== "undefined" && Graphics.width) {
            const next = Graphics.width + "x" + Graphics.height;
            if (next !== size) {
                size = next;
                post({ type: "size", width: Graphics.width, height: Graphics.height });
            }
        }
    };

    const schedule = () => {
        if (!scheduled && !paused && waiting.size) {
            scheduled = true;
            nativeRequestFrame(runFrame);
        }
    };

    window.requestAnimationFrame = (callback) => {
        const id = nextId++;
        waiting.set(id, callback);
        schedule();
        return id;
    };
    window.cancelAnimationFrame = (id) => waiting.delete(id);

    // MV keeps its PIXI renderer in Graphics._renderer, MZ in
    // Graphics._app. Neither exists until the game boots.
    const engineDetails = () => {
        if (typeof Utils === "undefined" || typeof Graphics === "undefined") return null;
        const renderer = Graphics._renderer || (Graphics._app && Graphics._app.renderer);
        if (!renderer) return null;
        const gl = renderer.gl;
        const mode = !gl ? "Canvas" : gl instanceof WebGL2RenderingContext ? "WebGL 2" : "WebGL 1";
        return [`RPG Maker ${Utils.RPGMAKER_NAME} ${Utils.RPGMAKER_VERSION}`, `PixiJS ${PIXI.VERSION} (${mode})`];
    };

    let detailsSent = false;
    let frameMark = performance.now();
    setInterval(() => {
        const now = performance.now();
        if (!detailsSent) {
            const lines = engineDetails();
            if (lines) {
                post({ type: "details", lines });
                detailsSent = true;
            }
        }
        post({ type: "fps", fps: (frames * 1000) / (now - frameMark) });
        frameMark = now;
        frames = 0;
    }, 1000);

    // MARK: resume point

    // The game saves only on the map or in a menu over it, with no event
    // running. Elsewhere, state that a save file does not hold, such as a
    // battle that loads or a common event that waits, would get lost.
    let resumePoint = settings.resumePoint;
    const makeResumePoint = () => {
        if (typeof Scene_Map === "undefined" || !SceneManager._scene) return null;
        const scene = SceneManager._scene;
        const onMap =
            scene instanceof Scene_Map || (scene instanceof Scene_MenuBase && SceneManager._stack.includes(Scene_Map));
        if (!onMap || SceneManager.isSceneChanging() || $gameParty.inBattle() || $gameMessage.isBusy() ||
            $gameMap.isEventRunning() || $gameTemp.isCommonEventReserved()) return null;
        const system = $gameSystem;
        const kept = [system._framesOnSave, system._bgmOnSave, system._bgsOnSave];
        try {
            // onAfterLoad reads these. A save sets them in onBeforeSave, which
            // also counts the save, so the resume point sets them itself.
            system._framesOnSave = Graphics.frameCount;
            system._bgmOnSave = AudioManager.saveBgm();
            system._bgsOnSave = AudioManager.saveBgs();
            // MV keeps the slot that the save screen selects outside the
            // save contents. MZ keeps it in $gameSystem.
            return JsonEx.stringify({ ...DataManager.makeSaveContents(), savefileId: DataManager._lastAccessedId });
        } finally {
            [system._framesOnSave, system._bgmOnSave, system._bgsOnSave] = kept;
        }
    };

    // The boot scene, and the plugins that change it, choose the next
    // scene in start(), so the map must replace that choice after it. The
    // plugins are in the page when the load event comes.
    if (resumePoint) {
        window.addEventListener("load", () => {
            if (typeof Scene_Boot === "undefined") {
                resumePoint = null;
                return;
            }
            const start = Scene_Boot.prototype.start;
            Scene_Boot.prototype.start = function () {
                Scene_Boot.prototype.start = start;
                start.call(this);
                try {
                    DataManager.createGameObjects();
                    const contents = JsonEx.parse(resumePoint);
                    DataManager.extractSaveContents(contents);
                    if (contents.savefileId) DataManager._lastAccessedId = contents.savefileId;
                    DataManager.correctDataErrors?.();
                    // A balloon or an animation that a parallel event waits
                    // for had a sprite on the old page. MZ ends the wait only
                    // when that sprite goes away.
                    const characters = [$gamePlayer, ...$gamePlayer.followers()._data, ...$gameMap.vehicles(),
                        ...$gameMap.events()];
                    for (const character of characters) {
                        character.endBalloon();
                        character.endAnimation();
                    }
                    $gameSystem.onAfterLoad();
                    SceneManager.goto(Scene_Map);
                    post({ type: "log", text: "the game is back at its resume point" });
                } catch (error) {
                    post({ type: "log", text: `the resume point did not load: ${error}`.toWellFormed() });
                    DataManager.setupNewGame();
                }
            };
        });
    }

    let playingMedia = [];
    const audioContext = () => (typeof WebAudio !== "undefined" ? WebAudio._context : null);

    const keyNames = {
        13: "Enter", 27: "Escape", 8: "Backspace", 9: "Tab", 32: " ", 16: "Shift", 17: "Control", 18: "Alt",
        33: "PageUp", 34: "PageDown", 35: "End", 36: "Home", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight",
        40: "ArrowDown", 45: "Insert", 46: "Delete",
    };
    // SDL scancode to the DOM keyCode that Input.keyMapper reads.
    const keyCodes = { 40: 13, 41: 27, 42: 8, 43: 9, 44: 32, 73: 45, 74: 36, 75: 33, 76: 46, 77: 35, 78: 34,
        79: 39, 80: 37, 81: 40, 82: 38, 98: 96, 224: 17, 225: 16, 226: 18, 228: 17, 229: 16, 230: 18 };
    for (let i = 0; i < 26; i++) keyCodes[4 + i] = 65 + i;
    for (let i = 0; i < 9; i++) keyCodes[30 + i] = 49 + i;
    keyCodes[39] = 48;
    for (let i = 0; i < 12; i++) keyCodes[58 + i] = 112 + i;
    for (let i = 0; i < 9; i++) keyCodes[89 + i] = 97 + i;

    window.__mvmz = {
        key(scancode, pressed) {
            const keyCode = keyCodes[scancode];
            if (!keyCode) return;
            const key = keyNames[keyCode] || String.fromCharCode(keyCode).toLowerCase();
            const event = new KeyboardEvent(pressed ? "keydown" : "keyup", { key, bubbles: true, cancelable: true });
            Object.defineProperty(event, "keyCode", { get: () => keyCode });
            Object.defineProperty(event, "which", { get: () => keyCode });
            (document.activeElement || document).dispatchEvent(event);
        },
        pause() {
            // A second pause finds the media that the first one paused, and
            // the resume would then play none of it.
            if (!paused) {
                paused = true;
                const context = audioContext();
                // RPG Maker MZ stops the game on any unhandled rejection. WebKit
                // rejects a pending suspend() or play() with AbortError when a
                // resume() or pause() comes before it ends.
                if (context && context.state === "running") context.suspend().catch(() => {});
                playingMedia = [...document.querySelectorAll("video, audio")].filter((m) => !m.paused);
                playingMedia.forEach((m) => m.pause());
            }
            try {
                // Until the boot scene ends, the resume point that the page
                // loads is still the newest game state.
                const scene = typeof SceneManager !== "undefined" && SceneManager._scene;
                if (scene && !(scene instanceof Scene_Boot)) resumePoint = null;
                return resumePoint || makeResumePoint();
            } catch (error) {
                post({ type: "log", text: `no resume point: ${error}`.toWellFormed() });
                return null;
            }
        },
        resume() {
            paused = false;
            const context = audioContext();
            if (context && context.state === "suspended") context.resume().catch(() => {});
            playingMedia.forEach((m) => m.play().catch(() => {}));
            playingMedia = [];
            // MV counts the time since its last update, and would run
            // up to 15 updates at once to catch up with the pause.
            if (typeof SceneManager !== "undefined" && "_currentTime" in SceneManager) {
                SceneManager._currentTime = performance.now();
            }
            reportFrame = true;
            schedule();
        },
        setSpeed(multiplier) {
            speed = multiplier;
            applySpeed();
        },
    };

    // MARK: log

    for (const level of ["log", "info", "warn", "error"]) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args);
            post({ type: "log", text: `console.${level}: ${args.map(String).join(" ")}`.toWellFormed() });
        };
    }
    // An error in the top level of main.js stops the start of the game when
    // it comes before main.js sets window.onload, as MV does at its end. A
    // plugin can then set window.onload that calls the missing onload of
    // main.js and throws, and another plugin can start the game itself, also
    // after a wait. So a window.onload that a plugin set stops the start
    // only when it throws or its promise rejects. MZ asks for its first
    // frame after the load event, and its own error listener stops the start
    // before that. The filename of the error is the script that threw, which
    // can be a script that main.js called.
    let mainError = null;
    window.addEventListener("error", (e) => {
        const script = document.currentScript?.src;
        if (script && new URL(script).pathname.endsWith("/js/main.js") && window.onload === null) {
            mainError = e.message;
        }
        post({ type: "log", text: `error: ${e.message} at ${e.filename}:${e.lineno}`.toWellFormed() });
    });
    // MV and MZ print their other boot errors into an error printer.
    let bootReported = false;
    const reportBootError = (message) => {
        if (bootReported || frameShown || !message) return;
        bootReported = true;
        post({ type: "bootError", message: message.replace(/\s*\n\s*/g, ": ").toWellFormed() });
    };
    new MutationObserver((records, observer) => {
        if (frameShown) return observer.disconnect();
        reportBootError(document.querySelector("#errorPrinter, #ErrorPrinter")?.innerText.trim());
    }).observe(document, { childList: true, subtree: true, characterData: true });
    // The load listener of this script runs before the ones of the game.
    // WebKit fires pageshow after the last load listener and its promise
    // callbacks, and before any timer.
    let startPromise = null;
    let onloadThrew = false;
    window.addEventListener("load", () => {
        const onload = window.onload;
        if (!mainError || !onload) return;
        // An async onload, such as one that waits and then calls the
        // missing onload of main.js, fails with a rejection, not an error.
        window.onload = function (event) {
            try {
                startPromise = onload.call(this, event);
            } catch (error) {
                onloadThrew = true;
                throw error;
            }
            return startPromise;
        };
    });
    window.addEventListener("pageshow", (e) => {
        // A script can send its own pageshow event before the load event.
        if (!e.isTrusted) return;
        if (!waiting.size && (window.onload === null || onloadThrew)) reportBootError(mainError);
    });
    window.addEventListener("unhandledrejection", (e) => {
        post({ type: "log", text: `unhandled rejection: ${e.reason}`.toWellFormed() });
        if (e.promise === startPromise && !waiting.size) reportBootError(mainError);
    });

    if (!settings.smooth) {
        document.addEventListener("DOMContentLoaded", () => {
            const style = document.createElement("style");
            style.textContent = "canvas, video { image-rendering: pixelated; }";
            document.head.appendChild(style);
        });
    }
})();
