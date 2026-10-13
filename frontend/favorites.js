// favorites.js — starred stops, stored in localStorage (server sync can come later with real auth)
(function () {
  "use strict";

  var KEY = "tp_favorites";

  function read() {
    try {
      var list = JSON.parse(window.localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) { /* storage full or blocked: fail quietly */ }
  }

  function isStarred(routeStopId) {
    return read().some(function (f) {
      return String(f.route_stop_id) === String(routeStopId);
    });
  }

  function remove(routeStopId) {
    write(read().filter(function (f) {
      return String(f.route_stop_id) !== String(routeStopId);
    }));
  }

  // item: { route_stop_id, route_id, route_name, name, landmark }
  // Returns true if the stop is starred after the call.
  function toggle(item) {
    if (isStarred(item.route_stop_id)) {
      remove(item.route_stop_id);
      return false;
    }
    var list = read();
    list.push({
      route_stop_id: item.route_stop_id,
      route_id: item.route_id,
      route_name: item.route_name || "",
      name: item.name || "Unnamed stop",
      landmark: item.landmark || ""
    });
    write(list);
    return true;
  }

  window.TransitPulseFavorites = {
    getAll: read,
    isStarred: isStarred,
    toggle: toggle,
    remove: remove
  };
})();
