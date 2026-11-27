window.dispatchEvent(new PageTransitionEvent("pageshow"));
window.onload = () => setTimeout(() => requestAnimationFrame(() => {}), 100);
