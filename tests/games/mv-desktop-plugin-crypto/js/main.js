const crypto = require("crypto");
const check = (name, run) => {
    try {
        console.log(`${name} ${run()}`);
    } catch (error) {
        console.log(`${name} threw ${error.code || error.message}`);
    }
};
check("upper case name", () => crypto.createHash("SHA256").update("abc").digest("hex"));
check("parts", () => crypto.createHash("sha256").update("a").update(new Uint8Array([98, 99])).digest("hex"));
// The lengths around the padding edges of a 64-byte block.
for (const length of [55, 56, 64, 65, 119, 120]) {
    check(`length ${length}`, () => crypto.createHash("sha256").update("a".repeat(length)).digest("hex"));
}
check("split across blocks", () =>
    crypto.createHash("sha256").update("a".repeat(63)).update("a".repeat(2)).update("a".repeat(65)).digest("hex"),
);
check("hex input", () => crypto.createHash("sha256").update("616263", "hex").digest("hex"));
check("base64 digest", () => crypto.createHash("sha256").update("abc").digest("base64"));
check("same copy", () => require("./js/libs/counter.js") === require("/JS/Libs/Counter.js"));
check("loads", () => window.counterLoads);
check("this", () => require("./js/libs/counter").thisIsExports);
check("json", () => require("./data/info.json").name);
check("json without ending", () => require("./data/info").name);
check("json with capitals", () => require("./data/capitals.json").name);
check("package name", () => require("index.html"));
check("hashbang", () => require("./js/libs/tool").name);
window.onload = () => requestAnimationFrame(() => {});
