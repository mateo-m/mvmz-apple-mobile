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
window.onload = () => requestAnimationFrame(() => {});
