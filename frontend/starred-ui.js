// starred-ui.js — renders starred stops as tappable cards. Used by routes.html and starred.html.
// Requires favorites.js to be loaded first.
(function () {
  "use strict";

  function buildCard(fav, onChange) {
    var wrap = document.createElement("div");
    wrap.className = "fav-card";

    var link = document.createElement("a");
    link.className = "fav-card-link";
    var params = new URLSearchParams();
    params.set("route_id", String(fav.route_id));
    if (fav.route_name) params.set("route_name", fav.route_name);
    params.set("stop", String(fav.route_stop_id));
    link.href = "stops.html?" + params.toString();

    var title = document.createElement("strong");
    title.textContent = fav.name;

    var sub = document.createElement("small");
    sub.textContent = (fav.route_name ? fav.route_name + " · " : "") + (fav.landmark || "Tap to check ETA");

    link.appendChild(title);
    link.appendChild(sub);

    var unstar = document.createElement("button");
    unstar.type = "button";
    unstar.className = "star-button is-starred";
    unstar.setAttribute("aria-label", "Remove " + fav.name + " from starred");
    unstar.textContent = "★";
    unstar.addEventListener("click", function () {
      window.TransitPulseFavorites.remove(fav.route_stop_id);
      if (onChange) onChange();
    });

    wrap.appendChild(link);
    wrap.appendChild(unstar);
    return wrap;
  }

  // container: element to fill. section (optional): wrapper hidden when there are no favorites.
  function render(container, section) {
    var favs = window.TransitPulseFavorites.getAll();
    container.innerHTML = "";
    if (section) section.classList.toggle("is-hidden", favs.length === 0);
    favs.forEach(function (fav) {
      container.appendChild(buildCard(fav, function () { render(container, section); }));
    });
    return favs.length;
  }

  window.TransitPulseStarredUI = { render: render };
})();
