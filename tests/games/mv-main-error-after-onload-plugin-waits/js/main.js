window.onload = () => requestAnimationFrame(() => {});
const plugin = document.createElement("script");
plugin.src = "js/plugin.js";
document.body.appendChild(plugin);
missingFunction();
