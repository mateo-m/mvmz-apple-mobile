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
check("read a folder", () => fs.readFileSync("/js"));
window.onload = () => requestAnimationFrame(() => {});
