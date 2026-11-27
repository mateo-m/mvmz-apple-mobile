const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const check = (name, run) => {
    try {
        console.log(`${name} ${run()}`);
    } catch (error) {
        console.log(`${name} threw ${error.code}`);
    }
};
check("platform", () => process.platform);
// A save plugin of a desktop release builds its folder like this on macOS.
check("save folder", () => path.join(require("os").homedir(), "Library", "Application Support", "Game", "saves"));
check("folder url", () => new URL("picture.png", pathToFileURL("/img/")).pathname);
check("read url", () => fs.readFileSync(pathToFileURL("/index.html"), "utf8").includes("js/main.js"));
check("other url", () => fs.existsSync(new URL("https://example.com/index.html")));
check("relative", () => path.relative("/content/mods", "/content/art/a.png"));
check("real path", () => fs.realpathSync("/JS/Main.js"));
check("copy to save folder", () => {
    const folder = path.join(require("os").homedir(), "copies");
    fs.mkdirSync(folder);
    fs.copyFileSync("/index.html", path.join(folder, "index.html"));
    const copied = fs.readFileSync("/save/copies/index.html", "utf8").includes("js/main.js");
    fs.unlinkSync("/save/copies/index.html");
    fs.rmdirSync("/save/copies");
    fs.rmdirSync("/save");
    return copied;
});
check("copy with a mode", () => fs.copyFileSync("/index.html", "/save/copies/index.html", 1));
check("write stream", () => {
    const stream = fs.createWriteStream("save/language.txt");
    stream.write("e", "utf-8");
    stream.write("n", "utf-8");
    stream.end("");
    const written = fs.readFileSync("/save/language.txt", "utf8");
    fs.unlinkSync("/save/language.txt");
    fs.rmdirSync("/save");
    return written;
});
check("write stream bytes", () => {
    const stream = fs.createWriteStream("save/bytes.bin");
    stream.write(new Uint8Array([0, 255]));
    stream.end(new Uint8Array([1, 2]));
    const written = fs.readFileSync("/save/bytes.bin");
    fs.unlinkSync("/save/bytes.bin");
    fs.rmdirSync("/save");
    return written.join(",");
});
check("read a folder", () => fs.readFileSync("/js"));
const describeEntries = (entries) =>
    entries
        .filter((entry) => ["index.html", "js", "js-link"].includes(entry.name))
        .map(
            (entry) =>
                `${entry.name} file=${entry.isFile()} folder=${entry.isDirectory()} link=${entry.isSymbolicLink()}`,
        )
        .sort()
        .join(", ");
check("read folder names", () => fs.readdirSync("/").includes("index.html"));
check("read folder entries", () => describeEntries(fs.readdirSync("/", { withFileTypes: true })));
fs.readdir("/", { withFileTypes: true }, (error, entries) =>
    check("read folder entries later", () => {
        if (error) throw error;
        return describeEntries(entries);
    }),
);
const checkLater = async (name, run) => {
    try {
        console.log(`${name} ${await run()}`);
    } catch (error) {
        console.log(`${name} threw ${error.code}`);
    }
};
(async () => {
    const folder = "/save/notes/old";
    const note = `${folder}/note.md`;
    try {
        await checkLater("promise make folders", async () => {
            await fs.promises.mkdir(folder, { recursive: true });
            return fs.statSync(folder).isDirectory();
        });
        await checkLater("promise read written file", async () => {
            await fs.promises.writeFile(note, "hello");
            return fs.promises.readFile(note, { encoding: "utf8" });
        });
        await checkLater("promise read folder entries", async () => {
            const entries = await fs.promises.readdir(folder, { withFileTypes: true });
            return entries.map((entry) => `${entry.name} file=${entry.isFile()}`).join(", ");
        });
        await checkLater("promise stat", async () => (await fs.promises.stat(note)).size);
        await checkLater("promise access missing", () => fs.promises.access(`${folder}/missing.md`));
        await checkLater("promise remove", async () => {
            await fs.promises.unlink(note);
            await fs.promises.rmdir(folder);
            await fs.promises.rmdir("/save/notes");
            await fs.promises.rmdir("/save");
            return fs.existsSync("/save");
        });
        check("promise module", () => require("fs/promises") === fs.promises);
    } finally {
        if (fs.existsSync("/save")) fs.rmdirSync("/save");
    }
})();
window.onload = () => requestAnimationFrame(() => {});
