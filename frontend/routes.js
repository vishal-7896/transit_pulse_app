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
    var topAvatarDot = document.getElementById("top-avatar-dot");

    var userId = TransitPulseStorage.getUserId();
    if (!userId) {
      window.location.href = "register.html";
      return;
    }

    var userName = TransitPulseStorage.getUserName() || "there";
    greeting.textContent = "Hi, " + userName;
    if (topAvatarDot && userName) {
      topAvatarDot.textContent = userName.charAt(0).toUpperCase();
    }

    if (window.TransitPulseAPI && window.TransitPulseAPI.getProfile) {
      window.TransitPulseAPI.getProfile().then(function (data) {
        var name = data && data.user && data.user.name;
        if (name && name !== "Commuter") {
          greeting.textContent = "Hi, " + name;
          TransitPulseStorage.saveUser(userId, name);
          if (topAvatarDot) topAvatarDot.textContent = name.charAt(0).toUpperCase();
        }
      }).catch(function () {});
    }

    retryButton.addEventListener("click", loadRoutes);
    if (changeUserButton) {
      changeUserButton.addEventListener("click", function () {
        TransitPulseStorage.clearUser();
        if (window.firebase) {
          firebase.auth().signOut();
        }
        window.location.href = "register.html";
      });
    }

    var starredList = document.getElementById("starred-list");
    var starredSection = document.getElementById("starred-section");
    if (starredList && window.TransitPulseStarredUI) {
      window.TransitPulseStarredUI.render(starredList, starredSection);
      if (userId && window.TransitPulseFavorites && window.TransitPulseFavorites.sync) {
        window.TransitPulseFavorites.sync(userId).then(function () {
          window.TransitPulseStarredUI.render(starredList, starredSection);
        });
      }
    }

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
        routesList.appendChild(createRouteCard(route, routesList.children.length + 1));
      });

      routeCount.textContent = validRoutes.length + (validRoutes.length === 1 ? " route" : " routes");
    }

    function createRouteCard(route, number) {
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
      routeIcon.textContent = String(number);

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
      arrow.textContent = "›";
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

    var feedbackForm = document.getElementById("feedback-form");
    if (feedbackForm) {
      feedbackForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var categoryEl = document.getElementById("feedback-category");
        var messageEl = document.getElementById("feedback-message");
        var submitBtn = document.getElementById("feedback-submit-btn");
        var feedbackMsg = document.getElementById("feedback-msg-box");
        var category = categoryEl ? categoryEl.value : "General";
        var message = messageEl ? messageEl.value.trim() : "";
        if (!message) return;
        submitBtn.disabled = true;
        TransitPulseUI.clearMessage(feedbackMsg);
        try {
          await TransitPulseAPI.sendFeedback({
            category: category,
            message: message,
            user_id: TransitPulseStorage.getUserId()
          });
          messageEl.value = "";
          TransitPulseUI.showMessage(feedbackMsg, "Thank you! Your feedback has been received.", "success");
        } catch (err) {
          TransitPulseUI.showMessage(feedbackMsg, err && err.message ? err.message : "Failed to send feedback.", "error");
        } finally {
          submitBtn.disabled = false;
        }
      });
    }

  });
})();