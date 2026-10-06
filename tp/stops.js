(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var routeTitle = document.getElementById("route-title");
    var stopsList = document.getElementById("stops-list");
    var stopsSubtitle = document.getElementById("stops-subtitle");
    var loadingCard = document.getElementById("stops-loading");
    var emptyCard = document.getElementById("stops-empty");
    var errorBox = document.getElementById("stops-error");
    var retryButton = document.getElementById("retry-stops-btn");
    var forwardButton = document.getElementById("forward-btn");
    var returnButton = document.getElementById("return-btn");

    var userId = TransitPulseStorage.getUserId();
    if (!userId) {
      window.location.href = "register.html";
      return;
    }

    var params = new URLSearchParams(window.location.search);
    var routeId = params.get("route_id");
    var routeName = params.get("route_name");

    if (!routeId || !/^\d+$/.test(routeId)) {
      window.location.href = "routes.html";
      return;
    }

    routeTitle.textContent = routeName || "Route";

    var selectedDirection = "forward";
    var selectedStop = null;
    var stops = [];
    var sightingCooldownActive = false;

    forwardButton.addEventListener("click", function () {
      setDirection("forward");
    });

    returnButton.addEventListener("click", function () {
      setDirection("return");
    });

    retryButton.addEventListener("click", loadStops);

    loadStops();

    async function loadStops() {
      setLoadingState(true);
      TransitPulseUI.clearMessage(errorBox);

      try {
        var response = await TransitPulseAPI.getStops(routeId);
        if (!Array.isArray(response)) {
          throw new Error("The server returned an invalid stops response.");
        }

        stops = response;
        selectedStop = null;
        renderStops();
        setLoadingState(false);
      } catch (error) {
        console.error("Could not load stops:", error);
        setLoadingState(false);
        TransitPulseUI.showMessage(errorBox, getStopsError(error), "error");
        retryButton.classList.remove("is-hidden");
      }
    }

    function renderStops() {
      stopsList.innerHTML = "";

      if (stops.length === 0) {
        emptyCard.classList.remove("is-hidden");
        stopsSubtitle.textContent = "No stops available";
        return;
      }

      emptyCard.classList.add("is-hidden");
      stopsSubtitle.textContent = stops.length + (stops.length === 1 ? " stop" : " stops");

      stops.forEach(function (stop) {
        stopsList.appendChild(createStopCard(stop));
      });
    }

    function createStopCard(stop) {
      var card = document.createElement("article");
      card.className = "stop-card";
      card.dataset.routeStopId = String(stop.route_stop_id);

      var top = document.createElement("button");
      top.type = "button";
      top.className = "stop-select-button";
      top.setAttribute("aria-pressed", "false");

      var indicator = document.createElement("span");
      indicator.className = "stop-indicator";
      indicator.setAttribute("aria-hidden", "true");

      var text = document.createElement("span");
      text.className = "stop-text";

      var name = document.createElement("strong");
      name.textContent = getDisplayValue(stop.name, "Unnamed stop");

      var landmark = document.createElement("small");
      landmark.textContent = getDisplayValue(stop.landmark, "No landmark provided");

      text.appendChild(name);
      text.appendChild(landmark);

      var chevron = document.createElement("span");
      chevron.className = "stop-chevron";
      chevron.textContent = "›";
      chevron.setAttribute("aria-hidden", "true");

      top.appendChild(indicator);
      top.appendChild(text);
      top.appendChild(chevron);

      var details = document.createElement("div");
      details.className = "stop-details is-hidden";

      var etaPanel = document.createElement("div");
      etaPanel.className = "eta-panel";

      var etaLabel = document.createElement("span");
      etaLabel.className = "eta-label";
      etaLabel.textContent = "ETA";

      var etaValue = document.createElement("strong");
      etaValue.className = "eta-value";
      etaValue.textContent = "—";
      etaPanel.appendChild(etaLabel);
      etaPanel.appendChild(etaValue);

      var etaMeta = document.createElement("p");
      etaMeta.className = "eta-meta";
      etaMeta.textContent = "Select the stop, then check the latest backend data.";

      var actions = document.createElement("div");
      actions.className = "stop-actions";

      var etaButton = document.createElement("button");
      etaButton.type = "button";
      etaButton.className = "wide-button wide-button-primary";
      etaButton.textContent = "Check ETA";
      etaButton.addEventListener("click", function () {
        loadEta(stop, etaButton, etaValue, etaMeta);
      });

      var reportButton = document.createElement("button");
      reportButton.type = "button";
      reportButton.className = "wide-button wide-button-secondary report-button";
      reportButton.textContent = "I see the bus";
      reportButton.addEventListener("click", function () {
        reportSighting(stop, reportButton, etaValue, etaMeta);
      });

      actions.appendChild(etaButton);
      actions.appendChild(reportButton);

      details.appendChild(etaPanel);
      details.appendChild(etaMeta);
      details.appendChild(actions);

      top.addEventListener("click", function () {
        selectStop(stop, card, top, details);
      });

      card.appendChild(top);
      card.appendChild(details);
      return card;
    }

    function selectStop(stop, card, top, details) {
      selectedStop = stop;

      document.querySelectorAll(".stop-card").forEach(function (item) {
        item.classList.remove("is-selected");
        var selectButton = item.querySelector(".stop-select-button");
        var itemDetails = item.querySelector(".stop-details");
        if (selectButton) selectButton.setAttribute("aria-pressed", "false");
        if (itemDetails) itemDetails.classList.add("is-hidden");
      });

      card.classList.add("is-selected");
      top.setAttribute("aria-pressed", "true");
      details.classList.remove("is-hidden");

      var selectedEta = details.querySelector(".eta-value");
      var selectedMeta = details.querySelector(".eta-meta");
      if (selectedEta) selectedEta.textContent = "—";
      if (selectedMeta) selectedMeta.textContent = "Ready to check the latest ETA for this stop.";
    }

    function setDirection(direction) {
      selectedDirection = direction;
      forwardButton.classList.toggle("is-active", direction === "forward");
      returnButton.classList.toggle("is-active", direction === "return");
      forwardButton.setAttribute("aria-pressed", String(direction === "forward"));
      returnButton.setAttribute("aria-pressed", String(direction === "return"));

      document.querySelectorAll(".eta-value").forEach(function (value) {
        value.textContent = "—";
      });
      document.querySelectorAll(".eta-meta").forEach(function (meta) {
        meta.textContent = "Direction changed. Check ETA again for the new direction.";
      });
    }

    async function loadEta(stop, button, etaValue, etaMeta) {
      if (!selectedStop || String(selectedStop.route_stop_id) !== String(stop.route_stop_id)) {
        showInlineInstruction("Please select this stop first.");
        return;
      }

      setButtonLoading(button, "Checking ETA...");
      etaValue.textContent = "…";
      etaMeta.textContent = "Getting the latest result from TransitPulse.";

      try {
        var eta = await TransitPulseAPI.getEta(stop.route_stop_id, selectedDirection);
        renderEtaState(eta, etaValue, etaMeta);
      } catch (error) {
        console.error("ETA error:", error);
        etaValue.textContent = "—";
        etaMeta.textContent = getEtaError(error);
        etaMeta.className = "eta-meta eta-meta-error";
      } finally {
        resetButton(button, "Check ETA");
      }
    }

    function renderEtaState(eta, etaValue, etaMeta) {
      etaMeta.className = "eta-meta";

      if (!eta || !eta.status) {
        etaValue.textContent = "—";
        etaMeta.textContent = "The server returned an unexpected ETA response.";
        etaMeta.classList.add("eta-meta-error");
        return;
      }

      if (eta.status === "live") {
        etaValue.textContent = getDisplayValue(eta["eta minutes"], "—") + " min";
        etaMeta.textContent = "Live ETA from the backend.";
        return;
      }

      if (eta.status === "stale") {
        etaValue.textContent = "Stale";
        etaMeta.textContent = eta["seen at"] ? "Last sighting: " + formatDateTime(eta["seen at"]) : "The available sighting data is old.";
        return;
      }

      if (eta.status === "passed") {
        etaValue.textContent = "Just passed";
        if (eta["next bus approx mins"] !== undefined && eta["next bus approx mins"] !== null) {
          etaMeta.textContent = (eta.message || "The bus may have passed.") + " Next bus approx " + eta["next bus approx mins"] + " min.";
        } else {
          etaMeta.textContent = eta.message || "The bus may have just passed.";
        }
        return;
      }

      if (eta.status === "no data") {
        etaValue.textContent = "No data";
        etaMeta.textContent = "No recent bus sighting is available for this direction.";
        return;
      }

      etaValue.textContent = "—";
      etaMeta.textContent = eta.message || "The ETA could not be determined.";
      etaMeta.classList.add("eta-meta-error");
    }

    async function reportSighting(stop, button, etaValue, etaMeta) {
      if (sightingCooldownActive) {
        etaMeta.className = "eta-meta eta-meta-warning";
        etaMeta.textContent = "A sighting was recently reported on this route. Please wait before reporting again.";
        return;
      }

      if (!selectedStop || String(selectedStop.route_stop_id) !== String(stop.route_stop_id)) {
        showInlineInstruction("Please select this stop first.");
        return;
      }

      setButtonLoading(button, "Sending...");

      try {
        await TransitPulseAPI.reportSighting({
          route_stop_id: stop.route_stop_id,
          user_id: userId,
          direction: selectedDirection
        });

        startCooldown();
        button.disabled = true;
        button.textContent = "Reported • wait 3 min";
        button.classList.remove("is-warning");
        button.classList.add("is-success");
        etaValue.textContent = "—";
        etaMeta.className = "eta-meta eta-meta-success";
        etaMeta.textContent = "Sighting shared successfully. Tap Check ETA when you want to request the ETA.";
      } catch (error) {
        console.error("Sighting error:", error);

        if (error && error.status === 429) {
          button.classList.add("is-warning");
          button.disabled = true;
          etaMeta.className = "eta-meta eta-meta-warning";
          etaMeta.textContent = "You've recently reported a sighting on this route. Please wait before reporting again.";
          startCooldown();
          return;
        }

        button.classList.remove("is-success");
        etaMeta.className = "eta-meta eta-meta-error";
        etaMeta.textContent = getSightingError(error);
        resetButton(button, "I see the bus");
      }
    }

    function startCooldown() {
      sightingCooldownActive = true;

      var reportButtons = document.querySelectorAll(".report-button");
      reportButtons.forEach(function (reportButton) {
        reportButton.disabled = true;
        reportButton.classList.add("is-warning");
      });

      var secondsLeft = 180;

      function updateLabels() {
        reportButtons = document.querySelectorAll(".report-button");

        if (secondsLeft <= 0) {
          window.clearInterval(timer);
          sightingCooldownActive = false;
          reportButtons.forEach(function (reportButton) {
            reportButton.disabled = false;
            reportButton.textContent = "I see the bus";
            reportButton.classList.remove("is-warning");
            reportButton.classList.remove("is-success");
          });
          return;
        }

        reportButtons.forEach(function (reportButton) {
          reportButton.disabled = true;
          reportButton.textContent = "Reported • wait " + secondsLeft + "s";
        });
        secondsLeft -= 1;
      }

      updateLabels();
      var timer = window.setInterval(updateLabels, 1000);
    }

    function showInlineInstruction(message) {
      var selectedCard = document.querySelector(".stop-card.is-selected");
      if (!selectedCard) {
        TransitPulseUI.showMessage(errorBox, message, "error");
        return;
      }
      var meta = selectedCard.querySelector(".eta-meta");
      if (meta) {
        meta.textContent = message;
        meta.className = "eta-meta eta-meta-warning";
      }
    }

    function setButtonLoading(button, label) {
      if (!button) return;
      button.disabled = true;
      button.textContent = label;
    }

    function resetButton(button, label) {
      if (!button) return;
      button.disabled = false;
      button.textContent = label;
    }

    function setLoadingState(isLoading) {
      loadingCard.classList.toggle("is-hidden", !isLoading);
      stopsList.setAttribute("aria-busy", String(isLoading));
      if (isLoading) {
        emptyCard.classList.add("is-hidden");
        retryButton.classList.add("is-hidden");
      }
    }

    function getDisplayValue(value, fallback) {
      if (value === undefined || value === null || String(value).trim() === "") return fallback;
      return String(value);
    }

    function formatDateTime(value) {
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    }

    function getStopsError(error) {
      if (error && error.isNetworkError) return "Could not connect to the TransitPulse server. Make sure Flask is running.";
      return error && error.message ? error.message : "Could not load stops.";
    }

    function getEtaError(error) {
      if (error && error.isNetworkError) return "Could not reach the server. Please check that Flask is running.";
      return error && error.message ? error.message : "Could not load the ETA.";
    }

    function getSightingError(error) {
      if (error && error.isNetworkError) return "Could not send the sighting because the server could not be reached.";
      return error && error.message ? error.message : "Could not send the sighting.";
    }
  });
})();
