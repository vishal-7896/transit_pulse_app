(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var routesList = document.getElementById("routes-list");
    var loadingCard = document.getElementById("routes-loading");
    var emptyCard = document.getElementById("routes-empty");
    var errorBox = document.getElementById("routes-error");
    var retryButton = document.getElementById("retry-routes-btn");
    var routeCount = document.getElementById("route-count");
    var greeting = document.getElementById("greeting");
    var changeUserButton = document.getElementById("change-user-btn");

    var userId = TransitPulseStorage.getUserId();
    if (!userId) {
      window.location.href = "register.html";
      return;
    }

    var userName = TransitPulseStorage.getUserName() || "there";
    greeting.textContent = "Hi, " + userName + " 👋";

    retryButton.addEventListener("click", loadRoutes);
    changeUserButton.addEventListener("click", function () {
      TransitPulseStorage.clearUser();
      window.location.href = "register.html";
    });

    loadRoutes();

    async function loadRoutes() {
      setLoadingState(true);
      TransitPulseUI.clearMessage(errorBox);

      try {
        var routes = await TransitPulseAPI.getRoutes();
        if (!Array.isArray(routes)) {
          throw new Error("The server returned an invalid routes response.");
        }

        renderRoutes(routes);
        setLoadingState(false);
      } catch (error) {
        console.error("Could not load routes:", error);
        setLoadingState(false);
        TransitPulseUI.showMessage(errorBox, getRouteError(error), "error");
        retryButton.classList.remove("is-hidden");
      }
    }

    function renderRoutes(routes) {
      routesList.innerHTML = "";
      emptyCard.classList.add("is-hidden");
      retryButton.classList.add("is-hidden");

      if (routes.length === 0) {
        emptyCard.classList.remove("is-hidden");
        routeCount.textContent = "No routes available";
        return;
      }

      var validRoutes = routes.filter(function (route) {
        return route && route.id !== undefined && route.id !== null;
      });

      if (validRoutes.length === 0) {
        emptyCard.classList.remove("is-hidden");
        routeCount.textContent = "No usable routes returned";
        return;
      }

      validRoutes.forEach(function (route) {
        routesList.appendChild(createRouteCard(route));
      });

      routeCount.textContent = validRoutes.length + (validRoutes.length === 1 ? " route" : " routes");
    }

    function createRouteCard(route) {
      var link = document.createElement("a");
      link.className = "route-card";

      var params = new URLSearchParams();
      params.set("route_id", String(route.id));
      if (route.name !== undefined && route.name !== null) {
        params.set("route_name", String(route.name));
      }
      link.href = "stops.html?" + params.toString();

      var routeIcon = document.createElement("div");
      routeIcon.className = "route-card-icon";
      routeIcon.setAttribute("aria-hidden", "true");
      routeIcon.textContent = "↗";

      var content = document.createElement("div");
      content.className = "route-card-content";

      var name = document.createElement("h3");
      name.textContent = getDisplayValue(route.name, "Unnamed route");

      var path = document.createElement("p");
      path.textContent = getDisplayValue(route.start_terminus, "Start") + " → " + getDisplayValue(route.stop_terminus, "Destination");

      content.appendChild(name);
      content.appendChild(path);

      var arrow = document.createElement("span");
      arrow.className = "route-card-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");

      link.appendChild(routeIcon);
      link.appendChild(content);
      link.appendChild(arrow);

      return link;
    }

    function setLoadingState(isLoading) {
      loadingCard.classList.toggle("is-hidden", !isLoading);
      routesList.setAttribute("aria-busy", String(isLoading));
      if (isLoading) {
        emptyCard.classList.add("is-hidden");
        retryButton.classList.add("is-hidden");
      }
    }

    function getDisplayValue(value, fallback) {
      if (value === undefined || value === null || String(value).trim() === "") return fallback;
      return String(value);
    }

    function getRouteError(error) {
      if (error && error.isNetworkError) {
        return "Could not connect to the TransitPulse server. Make sure Flask is running.";
      }
      return error && error.message ? error.message : "Could not load routes.";
    }
  });
})();
