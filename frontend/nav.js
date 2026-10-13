// nav.js — persistent bottom navigation (Home / Routes / Starred)
// Icons are Feather (MIT licensed), inlined so there is nothing extra to load.
(function () {
  "use strict";

  var ICONS = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    routes: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
  };

  var ITEMS = [
    { id: "home", label: "Home", href: "index.html", icon: ICONS.home },
    { id: "routes", label: "Routes", href: "routes.html", icon: ICONS.routes },
    { id: "starred", label: "Starred", href: "starred.html", icon: ICONS.star }
    // Add { id: "profile", ... } here once auth/profile exists.
  ];

  function currentId() {
    var file = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (file === "routes.html" || file === "stops.html") return "routes";
    if (file === "starred.html") return "starred";
    return "home";
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
  });
})();
