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
    } catch (e) {}
  }

  function isStarred(routeStopId) {
    return read().some(function (f) {
      return String(f.route_stop_id) === String(routeStopId);
    });
  }

  function remove(routeStopId) {
    var userId = window.TransitPulseStorage ? window.TransitPulseStorage.getUserId() : null;
    write(read().filter(function (f) {
      return String(f.route_stop_id) !== String(routeStopId);
    }));
    if (userId && window.TransitPulseAPI && window.TransitPulseAPI.toggleFavorite) {
      window.TransitPulseAPI.toggleFavorite(userId, routeStopId).catch(function () {});
    }
  }

  function toggle(item) {
    var userId = window.TransitPulseStorage ? window.TransitPulseStorage.getUserId() : null;
    var currentlyStarred = isStarred(item.route_stop_id);
    var list = read();

    if (currentlyStarred) {
      list = list.filter(function (f) {
        return String(f.route_stop_id) !== String(item.route_stop_id);
      });
      write(list);
      if (userId && window.TransitPulseAPI && window.TransitPulseAPI.toggleFavorite) {
        window.TransitPulseAPI.toggleFavorite(userId, item.route_stop_id).catch(function () {});
      }
      return false;
    }

    list.push({
      route_stop_id: item.route_stop_id,
      route_id: item.route_id,
      route_name: item.route_name || "",
      name: item.name || "Unnamed stop",
      landmark: item.landmark || ""
    });
    write(list);

    if (userId && window.TransitPulseAPI && window.TransitPulseAPI.toggleFavorite) {
      window.TransitPulseAPI.toggleFavorite(userId, item.route_stop_id).catch(function () {});
    }
    return true;
  }

  async function sync(userId) {
    if (!userId || !window.TransitPulseAPI || !window.TransitPulseAPI.getFavorites) return read();
    try {
      var serverFavs = await window.TransitPulseAPI.getFavorites(userId);
      if (Array.isArray(serverFavs)) {
        write(serverFavs);
        return serverFavs;
      }
    } catch (e) {
      console.warn("Could not sync favorites from cloud:", e);
    }
    return read();
  }

  window.TransitPulseFavorites = {
    getAll: read,
    isStarred: isStarred,
    toggle: toggle,
    remove: remove,
    sync: sync
  };
})();
