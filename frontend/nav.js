(function () {
  "use strict";

  var deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  var ICONS = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    routes: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };

  var ITEMS = [
    { id: "home", label: "Home", href: "index.html", icon: ICONS.home },
    { id: "routes", label: "Routes", href: "routes.html", icon: ICONS.routes },
    { id: "starred", label: "Starred", href: "starred.html", icon: ICONS.star },
    { id: "profile", label: "Profile", href: "profile.html", icon: ICONS.profile }
  ];

  function currentId() {
    var file = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (file === "routes.html" || file === "stops.html") return "routes";
    if (file === "starred.html") return "starred";
    if (file === "profile.html") return "profile";
    return "home";
  }

  function initPosterInstallPrompt() {
    var urlParams = new URLSearchParams(window.location.search);
    var src = urlParams.get("src");
    if (src === "poster") {
      try {
        sessionStorage.setItem("tp_scan_src", "poster");
      } catch (e) {}
    }
    var isPosterScan = (src === "poster") || (sessionStorage.getItem("tp_scan_src") === "poster");
    if (!isPosterScan) return;

    var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (isStandalone) return;

    if (sessionStorage.getItem("tp_install_banner_dismissed") === "1") return;

    setTimeout(function () {
      if (document.getElementById("poster-install-banner")) return;

      var banner = document.createElement("div");
      banner.className = "poster-install-banner";
      banner.id = "poster-install-banner";
      banner.setAttribute("role", "dialog");
      banner.setAttribute("aria-labelledby", "pib-title");
      banner.innerHTML = '<button class="pib-close" id="pib-close-btn" aria-label="Dismiss">✕</button>' +
        '<div class="pib-content">' +
          '<div class="pib-icon-wrap" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" class="pib-icon"><path d="M12 2v13m0 0l-4-4m4 4l4-4M3 17v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' +
          '</div>' +
          '<div class="pib-text">' +
            '<span class="pib-tag">STOP POSTER SCAN</span>' +
            '<h3 class="pib-title" id="pib-title">Add to your Home Screen</h3>' +
            '<p class="pib-desc" id="pib-desc">1-tap live arrival countdowns every time you\'re waiting at this bus stop.</p>' +
          '</div>' +
        '</div>' +
        '<div class="pib-action-row">' +
          '<button type="button" class="pib-install-btn" id="pib-install-btn">' +
            '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M10 2a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L9 11.586V3a1 1 0 0 1 1-1zM3 15a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1z"/></svg>' +
            '<span>Install App</span>' +
          '</button>' +
          '<button type="button" class="pib-dismiss-btn" id="pib-dismiss-btn">Keep in browser</button>' +
        '</div>' +
        '<div class="pib-ios-hint is-hidden" id="pib-ios-hint">' +
          '<span>Tap <strong>Share</strong> <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-2px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> below, then <strong>Add to Home Screen</strong></span>' +
        '</div>';

      document.body.appendChild(banner);

      function dismissBanner() {
        banner.style.transition = "transform 250ms ease, opacity 250ms ease";
        banner.style.transform = "translateY(120%)";
        banner.style.opacity = "0";
        setTimeout(function () {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 300);
        try {
          sessionStorage.setItem("tp_install_banner_dismissed", "1");
        } catch (e) {}
      }

      var closeBtn = document.getElementById("pib-close-btn");
      var dismissBtn = document.getElementById("pib-dismiss-btn");
      var installBtn = document.getElementById("pib-install-btn");
      var iosHint = document.getElementById("pib-ios-hint");

      if (closeBtn) closeBtn.addEventListener("click", dismissBanner);
      if (dismissBtn) dismissBtn.addEventListener("click", dismissBanner);

      if (installBtn) {
        installBtn.addEventListener("click", function () {
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then(function (result) {
              deferredInstallPrompt = null;
              if (result && result.outcome === "accepted") {
                dismissBanner();
              }
            });
          } else {
            var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
            if (isIos && iosHint) {
              iosHint.classList.remove("is-hidden");
            } else {
              alert("To install TransitPulse: tap your browser menu (⋮) and select 'Install app' or 'Add to Home screen'.");
              dismissBanner();
            }
          }
        });
      }
    }, 1400);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var active = currentId();
    var nav = document.createElement("nav");
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Main navigation");

    ITEMS.forEach(function (item) {
      var a = document.createElement("a");
      a.href = item.href;
      a.className = "bottom-nav-item" + (item.id === active ? " is-active" : "");
      if (item.id === active) a.setAttribute("aria-current", "page");
      a.innerHTML = item.icon + "<span>" + item.label + "</span>";
      nav.appendChild(a);
    });

    document.body.classList.add("has-bottom-nav");
    document.body.appendChild(nav);

    initPosterInstallPrompt();
  });
})();
