// analytics.js - Plausible setup and click tracking.
// Loaded before the Plausible script so events queue until it arrives.
// Kept out of the HTML so the security policy can block inline scripts.
window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
window.plausible.init = window.plausible.init || function (options) { window.plausible.o = options || {}; };
window.plausible.init();

// Any element with data-track="event_name" reports that event when clicked.
document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target.closest('[data-track]') : null;
    if (target) window.plausible(target.getAttribute('data-track'));
});
