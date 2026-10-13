// hero-extras.js — adds a top bar and a faint animated route map to the home page.
// Needs storage.js to be loaded first (to know if someone is signed in).
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var reduceMotion = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function svgEl(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  /* ---------------- Top bar ---------------- */
  function buildTopBar() {
    if (document.querySelector(".topbar")) return;

    var hasUser = Boolean(window.TransitPulseStorage && window.TransitPulseStorage.hasUser());

    var bar = document.createElement("header");
    bar.className = "topbar";
    bar.innerHTML =
      '<a class="topbar-brand" href="index.html" aria-label="TransitPulse home">' +
        '<img src="favicon.svg" alt="" width="30" height="30">' +
        '<span class="topbar-name"><span class="tn-t">Transit</span><span class="tn-p">Pulse</span></span>' +
      '</a>' +
      '<a class="topbar-link"></a>';

    var link = bar.querySelector(".topbar-link");
    link.textContent = hasUser ? "Open routes" : "Sign up";
    link.setAttribute("href", hasUser ? "routes.html" : "register.html");

    // Use the same font as the big wordmark, whatever you changed it to.
    var title = document.querySelector(".brand-title");
    if (title) bar.querySelector(".topbar-name").style.fontFamily = window.getComputedStyle(title).fontFamily;

    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* ---------------- Route-map background ---------------- */
  var mapBox = null;

  function routePaths(W, H) {
    function p(x, y) { return (x * W).toFixed(1) + " " + (y * H).toFixed(1); }
    return [
      "M " + p(-0.05, 0.27) + " C " + p(0.18, 0.08) + ", " + p(0.34, 0.40) + ", " + p(0.52, 0.22) +
        " S " + p(0.86, 0.02) + ", " + p(1.05, 0.14),
      "M " + p(-0.05, 0.72) + " C " + p(0.16, 0.56) + ", " + p(0.30, 0.84) + ", " + p(0.50, 0.71) +
        " S " + p(0.84, 0.56) + ", " + p(1.05, 0.74),
      "M " + p(0.09, -0.02) + " C " + p(0.01, 0.20) + ", " + p(0.15, 0.40) + ", " + p(0.04, 0.64)
    ].slice(0, W < 700 ? 2 : 3);   // phones get the two long routes only, to stay calm
  }

  // Rectangles of things that must not have a map stop drawn on top of them.
  function blockedRects() {
    var sel = ".topbar-brand, .topbar-link, .route-node, .bus-illustration, .brand-title, .brand-copy, .eyebrow, .scroll-hint, .landing-actions .action-button";
    var out = [];
    document.querySelectorAll(sel).forEach(function (node) {
      var r = node.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      out.push({ l: r.left - 14, t: r.top + window.scrollY - 14, r: r.right + 14, b: r.bottom + window.scrollY + 14 });
    });
    return out;
  }

  function stopAllowed(x, y, blocked, placed) {
    for (var i = 0; i < blocked.length; i++) {
      var b = blocked[i];
      if (x >= b.l && x <= b.r && y >= b.t && y <= b.b) return false;
    }
    for (var j = 0; j < placed.length; j++) {
      var dx = placed[j].x - x, dy = placed[j].y - y;
      if (dx * dx + dy * dy < 30 * 30) return false;
    }
    return true;
  }

  function buildMap() {
    var W = document.documentElement.clientWidth;
    var H = Math.round(Math.min(Math.max(window.innerHeight * 1.05, 640), 1000));

    if (!mapBox) {
      mapBox = document.createElement("div");
      mapBox.className = "route-bg";
      mapBox.setAttribute("aria-hidden", "true");
      document.body.insertBefore(mapBox, document.body.firstChild);
    }
    mapBox.style.height = H + "px";
    mapBox.innerHTML = "";

    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, preserveAspectRatio: "none", focusable: "false" });
    mapBox.appendChild(svg);

    var stopFractions = [0.1, 0.3, 0.52, 0.74, 0.92];
    var blocked = blockedRects();
    var placed = [];

    routePaths(W, H).forEach(function (d, index) {
      var path = svgEl("path", { d: d, "class": "rb-line" });
      svg.appendChild(path);

      // Stops: placed at fixed fractions of each line's length.
      var len = path.getTotalLength();
      stopFractions.forEach(function (f) {
        var pt = path.getPointAtLength(len * f);
        if (!stopAllowed(pt.x, pt.y, blocked, placed)) return;
        placed.push({ x: pt.x, y: pt.y });
        svg.appendChild(svgEl("circle", { cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: 4, "class": "rb-stop" }));
      });

      // A small "bus" glides along the two longer routes.
      if (!reduceMotion && index < 2) {
        var g = svgEl("g", {});
        g.appendChild(svgEl("circle", { r: 10, "class": "rb-glow" }));
        g.appendChild(svgEl("circle", { r: 3.6, "class": "rb-bus" }));
        var motion = svgEl("animateMotion", {
          path: d,
          dur: (index === 0 ? 18 : 24) + "s",
          begin: (index === 0 ? "0s" : "-9s"),
          repeatCount: "indefinite",
          keyPoints: index === 0 ? "0;1" : "1;0",
          keyTimes: "0;1",
          calcMode: "linear"
        });
        g.appendChild(motion);
        svg.appendChild(g);
      }
    });
  }

  var resizeTimer = null;
  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(buildMap, 200);
  }

  function init() {
    buildTopBar();
    buildMap();
    window.addEventListener("resize", onResize);
    window.addEventListener("load", buildMap);   // layout can shift once fonts arrive
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
