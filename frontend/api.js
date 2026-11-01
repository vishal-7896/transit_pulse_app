(function () {
  "use strict";

  var configuredBase = window.TRANSITPULSE_API_BASE_URL;
  var isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  var defaultBase = isLocal ? "http://" + window.location.hostname + ":5000" : window.location.origin;
  var API_BASE_URL = (configuredBase || defaultBase).replace(/\/$/, "");

  window.TransitPulseAPI = {
    getRoutes: function () {
      return request("/routes");
    },
    getStops: function (routeId) {
      return request("/routes/" + encodeURIComponent(String(routeId)) + "/stops");
    },
    getEta: function (routeStopId, direction) {
      var query = direction ? "?direction=" + encodeURIComponent(direction) : "";
      return request("/eta/" + encodeURIComponent(String(routeStopId)) + query, { timeoutMs: 12000 });
    },
    getOperators: function () {
      return request("/operators");
    },
    reportSighting: function (payload) {
      return request("/sighting", {
        method: "POST",
        body: payload,
        timeoutMs: 15000
      });
    },
    register: function (payload) {
      return request("/register", {
        method: "POST",
        body: payload,
        timeoutMs: 15000
      });
    },
    getFavorites: function (userId) {
      return request("/favorites?user_id=" + encodeURIComponent(String(userId)));
    },
    toggleFavorite: function (userId, routeStopId) {
      return request("/favorites/toggle", {
        method: "POST",
        body: { user_id: userId, route_stop_id: routeStopId }
      });
    },
    getProfile: function () {
      return request("/profile", { timeoutMs: 15000 });
    }
  };

  async function request(path, options) {
    var requestOptions = {
      method: options && options.method ? options.method : "GET",
      headers: {
        Accept: "application/json"
      }
    };

    var timeoutMs = (options && options.timeoutMs) || 15000;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = null;

    if (controller) {
      requestOptions.signal = controller.signal;
      timeoutId = window.setTimeout(function () {
        controller.abort();
      }, timeoutMs);
    }

    if (window.firebase && firebase.auth().currentUser) {
      try {
        var idToken = await firebase.auth().currentUser.getIdToken();
        requestOptions.headers["Authorization"] = "Bearer " + idToken;
      } catch (err) {
        console.warn("Could not retrieve Firebase token:", err);
      }
    }

    if (options && options.body !== undefined) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }

    var response;

    try {
      response = await fetch(API_BASE_URL + path, requestOptions);
    } catch (error) {
      if (timeoutId) window.clearTimeout(timeoutId);
      var isTimeout = error && (error.name === "AbortError" || String(error).indexOf("aborted") !== -1);
      var msg = isTimeout
        ? "Network request timed out. Please check your connection and tap again."
        : "Unable to connect to the TransitPulse server.";
      var networkError = new Error(msg);
      networkError.isNetworkError = true;
      networkError.isTimeout = isTimeout;
      networkError.originalError = error;
      throw networkError;
    }

    if (timeoutId) window.clearTimeout(timeoutId);

    var data = await readResponseData(response);

    if (!response.ok) {
      var apiError = new Error(getServerErrorMessage(data, response.status));
      apiError.status = response.status;
      apiError.data = data;
      throw apiError;
    }

    return data;
  }

  async function readResponseData(response) {
    var text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (parseError) {
      return { raw: text };
    }
  }

  function getServerErrorMessage(data, status) {
    if (data && typeof data.message === "string" && !data.message.startsWith("<")) return data.message;
    if (data && typeof data.error === "string") return data.error;
    if (status >= 500) return "Server is waking up. Please tap Try again in a moment.";
    if (status === 404) return "Requested resource was not found.";
    return "Request failed with status " + status + ".";
  }
})();
