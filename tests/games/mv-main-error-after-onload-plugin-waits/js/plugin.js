const previousOnload = window.onload;
window.onload = async function () {
    await new Promise((resolve) => setTimeout(resolve, 100));
    previousOnload.call(this);
};
