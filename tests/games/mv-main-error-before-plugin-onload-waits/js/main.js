// MV's PluginManager.setup adds the plugin scripts. They run after main.js.
const plugin = document.createElement("script");
plugin.src = "js/plugin.js";
document.body.appendChild(plugin);
missingFunction();
window.onload = () => requestAnimationFrame(() => {});
