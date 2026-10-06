(function () {
  "use strict";

  var configuredBase = window.TRANSITPULSE_API_BASE_URL;
  var host = window.location.hostname || "127.0.0.1";
  var defaultBase = "http://" + host + ":5000";
  var API_BASE_URL = (configuredBase || defaultBase).replace(/\/$/, "");

  window.TransitPulseAPI = {
    getRoutes: function () {
      return request("/routes", { method: "GET" });
    },

    getStops: function (routeId) {
      return request("/routes/" + encodeURIComponent(String(routeId)) + "/stops", { method: "GET" });
    },

    register: function (payload) {
      return request("/register", { method: "POST", body: payload });
    },

    getEta: function (routeStopId, direction) {
      var query = new URLSearchParams({ direction: direction });
      return request("/eta/" + encodeURIComponent(String(routeStopId)) + "?" + query.toString(), { method: "GET" });
    },

    reportSighting: function (payload) {
      return request("/sighting", { method: "POST", body: payload });
    }
  };

  async function request(path, options) {
    var requestOptions = {
      method: options && options.method ? options.method : "GET",
      headers: {
        Accept: "application/json"
      }
    };

    if (options && options.body !== undefined) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }

    var response;

    try {
      response = await fetch(API_BASE_URL + path, requestOptions);
    } catch (error) {
      var networkError = new Error("Unable to connect to the TransitPulse server.");
      networkError.isNetworkError = true;
      networkError.originalError = error;
      throw networkError;
    }

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
    var contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        return await response.json();
      } catch (error) {
        var jsonError = new Error("The server returned invalid JSON.");
        jsonError.status = response.status;
        throw jsonError;
      }
    }

    var text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (error) {
      return { message: text };
    }
  }

  function getServerErrorMessage(data, status) {
    if (data && typeof data.message === "string") return data.message;
    if (data && typeof data.error === "string") return data.error;
    if (status >= 500) return "The TransitPulse server is temporarily unavailable.";
    return "The TransitPulse request could not be completed.";
  }
})();
