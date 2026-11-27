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
check("hex input", () => crypto.createHash("sha256").update("616263", "hex").digest("hex"));
check("base64 digest", () => crypto.createHash("sha256").update("abc").digest("base64"));
check("same copy", () => require("./js/libs/counter.js") === require("/JS/Libs/Counter.js"));
check("loads", () => window.counterLoads);
check("this", () => require("./js/libs/counter").thisIsExports);
check("main", () => require("./js/libs/counter").isMain);
check("json", () => require("./data/info.json").name);
window.onload = () => requestAnimationFrame(() => {});
