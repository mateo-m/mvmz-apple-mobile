// DKTools keeps the window.onload of main.js and calls it from its own.
const previousOnload = window.onload;
window.onload = function () {
    previousOnload.call(this);
};
