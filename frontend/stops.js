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

    var forwardLabel = "Forward";
    var returnLabel = "Return";
    if (routeName && routeName.indexOf("-") !== -1) {
      var parts = routeName.split("-");
      forwardLabel = "To " + parts[1].trim() + " →";
      returnLabel = "← To " + parts[0].trim();
    }
    forwardButton.textContent = forwardLabel;
    returnButton.textContent = returnLabel;

    forwardButton.classList.remove("is-active");
    returnButton.classList.remove("is-active");
    forwardButton.setAttribute("aria-pressed", "false");
    returnButton.setAttribute("aria-pressed", "false");

    var selectedDirection = null;
    var selectedStop = null;
    var stops = [];
    var sightingCooldownActive = false;
    var operators = [];
    var selectedOperatorId = null;
    var selectedCrowdLevel = null;
    var currentEtaStop = null;
    var preselectStopId = params.get("stop");
    if (preselectStopId && !/^\d+$/.test(preselectStopId)) preselectStopId = null;

    var tickTimer = null;
    var refetchTimer = null;
    var countdownStopId = null;
    var countdownEndAt = null;
    var REFETCH_MS = 45000;

    var COOLDOWN_KEY = "tp_sighting_cooldown_until";
    var cooldownTimer = null;

    function getCooldownSecondsLeft() {
      var until = parseInt(localStorage.getItem(COOLDOWN_KEY), 10);
      if (!until || isNaN(until)) return 0;
      var diff = Math.ceil((until - Date.now()) / 1000);
      return diff > 0 ? diff : 0;
    }

    function checkCooldown() {
      var left = getCooldownSecondsLeft();
      if (left > 0) {
        startCooldown(left);
      } else {
        localStorage.removeItem(COOLDOWN_KEY);
        sightingCooldownActive = false;
        var reportButtons = document.querySelectorAll(".report-button");
        reportButtons.forEach(function (btn) {
          btn.disabled = false;
          btn.textContent = "I see the bus";
          btn.classList.remove("is-warning", "is-success");
        });
      }
    }

    function startCooldown(customSeconds) {
      if (customSeconds === undefined) {
        var until = Date.now() + (180 * 1000);
        localStorage.setItem(COOLDOWN_KEY, String(until));
      }
      sightingCooldownActive = true;

      window.clearInterval(cooldownTimer);

      function updateLabels() {
        var left = getCooldownSecondsLeft();
        var reportButtons = document.querySelectorAll(".report-button");

        if (left <= 0) {
          window.clearInterval(cooldownTimer);
          cooldownTimer = null;
          sightingCooldownActive = false;
          localStorage.removeItem(COOLDOWN_KEY);

          reportButtons.forEach(function (btn) {
            btn.disabled = false;
            btn.textContent = "I see the bus";
            btn.classList.remove("is-warning", "is-success");
          });
          return;
        }

        sightingCooldownActive = true;
        reportButtons.forEach(function (btn) {
          btn.disabled = true;
          btn.textContent = "Reported • wait " + left + "s";
          btn.classList.add("is-warning");
        });
      }

      updateLabels();
      cooldownTimer = window.setInterval(updateLabels, 1000);
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        checkCooldown();
      }
    });
    window.addEventListener("pageshow", checkCooldown);

    function stopCountdown() {
      window.clearInterval(tickTimer);
      window.clearInterval(refetchTimer);
      tickTimer = null;
      refetchTimer = null;
      countdownStopId = null;
      countdownEndAt = null;
      document.querySelectorAll(".eta-value").forEach(function (v) {
        v.classList.remove("is-ticking", "is-arriving");
      });
    }

    function parseEta(eta) {
      var secs = Number(eta["eta seconds"] !== undefined ? eta["eta seconds"] : eta.eta_seconds);
      if (isFinite(secs) && secs >= 0) return { sec: secs, precise: true };
      var mins = Number(eta["eta minutes"]);
      if (isFinite(mins) && mins >= 0) return { sec: mins * 60, precise: false };
      return null;
    }

    function formatRelativeAgo(mins) {
      if (mins === undefined || mins === null) return "";
      if (mins <= 0) return "just now";
      if (mins < 60) return mins + " min ago";
      var hrs = Math.floor(mins / 60);
      return hrs + (hrs === 1 ? " hr ago" : " hrs ago");
    }

    function getStopRole(stop) {
      if (!stops || stops.length < 2 || !stop) return "intermediate";
      var firstStop = stops[0];
      var lastStop = stops[stops.length - 1];
      var stopId = String(stop.route_stop_id);

      if (selectedDirection === "return") {
        if (stopId === String(lastStop.route_stop_id)) return "start_terminus";
        if (stopId === String(firstStop.route_stop_id)) return "final_terminus";
      } else {
        if (stopId === String(firstStop.route_stop_id)) return "start_terminus";
        if (stopId === String(lastStop.route_stop_id)) return "final_terminus";
      }
      return "intermediate";
    }

    function buildLiveMetaText(eta) {
      var reports = eta.reports_count || 1;
      var countText = "Based on " + reports + (reports === 1 ? " report" : " reports");
      var ago = formatRelativeAgo(eta.seen_ago_minutes);
      var agoText = ago ? " · " + ago : "";
      return countText + agoText;
    }

    function buildConfidenceText(eta) {
      var parts = [];

      var reports = eta.reports_count || 0;
      if (reports > 0) {
        var reportText = reports + (reports === 1 ? " report" : " reports");
        var ago = formatRelativeAgo(eta.seen_ago_minutes);
        parts.push(ago ? reportText + ", " + ago : reportText);
      }

      var riders = eta.riders_helped_today || 0;
      if (riders > 0) {
        parts.push(riders + (riders === 1 ? " rider helped today" : " riders helped today"));
      }

      return parts.length > 0 ? " · " + parts.join(" · ") : "";
    }

    function startCountdown(stop, eta, etaValue, etaMeta) {
      var liveIndicator = etaValue.parentElement ? etaValue.parentElement.querySelector(".live-indicator") : null;
      var parsed = parseEta(eta);
      if (!parsed) {
        if (liveIndicator) liveIndicator.classList.add("is-hidden");
        return false;
      }

      var sameStop = countdownStopId === String(stop.route_stop_id) && countdownEndAt !== null;
      var left = sameStop ? (countdownEndAt - Date.now()) / 1000 : -1;
      var liveMeta = buildLiveMetaText(eta);

      if (sameStop && !parsed.precise && left > 0 && Math.abs(left - parsed.sec) <= 60) {
        if (liveIndicator) liveIndicator.classList.remove("is-hidden");
        etaMeta.className = "eta-meta";
        etaMeta.textContent = liveMeta;
        return true;
      }

      stopCountdown();
      if (liveIndicator) liveIndicator.classList.remove("is-hidden");
      countdownEndAt = Date.now() + parsed.sec * 1000;
      countdownStopId = String(stop.route_stop_id);
      etaValue.classList.add("is-ticking");

      function tick() {
        var remaining = Math.round((countdownEndAt - Date.now()) / 1000);
        if (remaining <= 0) {
          etaValue.textContent = "Arriving";
          etaValue.classList.remove("is-ticking");
          etaValue.classList.add("is-arriving");
          window.clearInterval(tickTimer);
          tickTimer = null;
          return;
        }
        var m = Math.floor(remaining / 60);
        var sec = remaining % 60;
        etaValue.textContent = m + ":" + (sec < 10 ? "0" : "") + sec;
      }

      tick();
      tickTimer = window.setInterval(tick, 1000);
      etaMeta.className = "eta-meta";
      etaMeta.textContent = liveMeta;

      refetchTimer = window.setInterval(async function () {
        if (document.hidden) return;
        try {
          var fresh = await TransitPulseAPI.getEta(stop.route_stop_id, selectedDirection);
          if (countdownStopId !== String(stop.route_stop_id)) return;
          if (fresh && fresh.status === "live") {
            startCountdown(stop, fresh, etaValue, etaMeta);
          } else {
            stopCountdown();
            renderEtaState(fresh, etaValue, etaMeta, stop);
          }
        } catch (e) {}
      }, REFETCH_MS);
      return true;
    }

    forwardButton.addEventListener("click", function () {
      setDirection("forward");
    });

    returnButton.addEventListener("click", function () {
      setDirection("return");
    });

    retryButton.addEventListener("click", loadStops);

    loadStops();
    loadOperators();

    async function loadOperators() {
      try {
        operators = await TransitPulseAPI.getOperators();
      } catch (e) {
        console.warn("Could not load operators", e);
      }
    }

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

      checkCooldown();

      if (preselectStopId) {
        var target = stopsList.querySelector('[data-route-stop-id="' + preselectStopId + '"]');
        preselectStopId = null;
        if (target) {
          target.querySelector(".stop-select-button").click();
          target.scrollIntoView({ block: "center" });
          var etaBtn = target.querySelector(".wide-button-primary");
          if (etaBtn) etaBtn.click();
        }
      }
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

      var etaValueWrap = document.createElement("div");
      etaValueWrap.className = "eta-value-wrap";

      var liveIndicator = document.createElement("div");
      liveIndicator.className = "live-indicator is-hidden";

      var liveDot = document.createElement("span");
      liveDot.className = "live-dot";
      liveDot.setAttribute("aria-hidden", "true");

      var liveText = document.createElement("span");
      liveText.className = "live-text";
      liveText.textContent = "LIVE";

      liveIndicator.appendChild(liveDot);
      liveIndicator.appendChild(liveText);

      var etaValue = document.createElement("strong");
      etaValue.className = "eta-value";
      etaValue.textContent = "—";

      etaValueWrap.appendChild(liveIndicator);
      etaValueWrap.appendChild(etaValue);

      etaPanel.appendChild(etaLabel);
      etaPanel.appendChild(etaValueWrap);

      var etaMeta = document.createElement("p");
      etaMeta.className = "eta-meta";

      var initialRole = getStopRole(stop);
      if (initialRole === "final_terminus") {
        etaLabel.textContent = "DESTINATION";
        etaValue.textContent = "Final Stop";
        etaMeta.textContent = "Bus terminates here";
      } else if (initialRole === "start_terminus") {
        etaLabel.textContent = "DEPARTURE";
        etaValue.textContent = "Leaves ~15 m";
        etaMeta.textContent = "Scheduled departures every 15 min";
      } else {
        etaLabel.textContent = "ETA";
        etaValue.textContent = "—";
        etaMeta.textContent = selectedDirection
          ? "Tap Check ETA to get arrival time."
          : "Select direction above, then check ETA.";
      }

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

      var star = document.createElement("button");
      star.type = "button";
      star.className = "star-button";
      function paintStar() {
        var on = window.TransitPulseFavorites.isStarred(stop.route_stop_id);
        star.classList.toggle("is-starred", on);
        star.textContent = on ? "\u2605" : "\u2606";
        star.setAttribute("aria-pressed", String(on));
        star.setAttribute("aria-label", (on ? "Remove " : "Add ") + getDisplayValue(stop.name, "stop") + (on ? " from" : " to") + " starred");
      }
      star.addEventListener("click", function (event) {
        event.stopPropagation();
        window.TransitPulseFavorites.toggle({
          route_stop_id: stop.route_stop_id,
          route_id: routeId,
          route_name: routeName || "",
          name: stop.name,
          landmark: stop.landmark
        });
        paintStar();
      });
      paintStar();
      card.appendChild(star);

      return card;
    }

    function selectStop(stop, card, top, details) {
      stopCountdown();
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
      if (selectedMeta) {
        selectedMeta.className = "eta-meta";
        selectedMeta.textContent = selectedDirection ? "Ready to check the latest ETA for this stop." : "Select direction above, then check ETA.";
      }
    }

    function setDirection(direction) {
      stopCountdown();
      selectedDirection = direction;
      forwardButton.classList.toggle("is-active", direction === "forward");
      returnButton.classList.toggle("is-active", direction === "return");
      forwardButton.setAttribute("aria-pressed", String(direction === "forward"));
      returnButton.setAttribute("aria-pressed", String(direction === "return"));

      var picker = document.getElementById("sighting-picker");
      if (picker) {
        var fBtn = picker.querySelector(".picker-dir-forward");
        var rBtn = picker.querySelector(".picker-dir-return");
        if (fBtn) fBtn.classList.toggle("is-active", direction === "forward");
        if (rBtn) rBtn.classList.toggle("is-active", direction === "return");
      }

      document.querySelectorAll(".eta-value").forEach(function (value) {
        value.textContent = "—";
      });
      updateStopRoles();
    }

    function updateStopRoles() {
      if (!stopsList) return;
      stopsList.querySelectorAll(".stop-card").forEach(function (card) {
        var id = card.dataset.routeStopId;
        var stopObj = stops.find(function (s) { return String(s.route_stop_id) === String(id); });
        if (!stopObj) return;
        var role = getStopRole(stopObj);
        var label = card.querySelector(".eta-label");
        var val = card.querySelector(".eta-value");
        var meta = card.querySelector(".eta-meta");
        var indicator = card.querySelector(".live-indicator");
        if (indicator) indicator.classList.add("is-hidden");

        if (role === "final_terminus") {
          if (label) label.textContent = "DESTINATION";
          if (val) val.textContent = "Final Stop";
          if (meta) {
            meta.className = "eta-meta";
            meta.textContent = "Bus terminates here";
          }
        } else if (role === "start_terminus") {
          if (label) label.textContent = "DEPARTURE";
          if (val) val.textContent = "Leaves ~15 m";
          if (meta) {
            meta.className = "eta-meta";
            meta.textContent = "Scheduled departures every 15 min";
          }
        } else {
          if (label) label.textContent = "ETA";
          if (val) val.textContent = "—";
          if (meta) {
            meta.className = "eta-meta";
            meta.textContent = "Direction set to " + (selectedDirection === "forward" ? forwardLabel : returnLabel) + ". Tap Check ETA.";
          }
        }
      });
    }

    async function loadEta(stop, button, etaValue, etaMeta) {
      if (!selectedStop || String(selectedStop.route_stop_id) !== String(stop.route_stop_id)) {
        showInlineInstruction("Please select this stop first.");
        return;
      }

      if (!selectedDirection) {
        etaMeta.className = "eta-meta eta-meta-warning";
        etaMeta.textContent = "Please select a direction (To Delhi / To Hapur) first.";
        var dirCard = document.querySelector(".direction-card");
        if (dirCard) dirCard.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      setButtonLoading(button, "Checking ETA...");
      if (countdownStopId !== String(stop.route_stop_id)) {
        etaValue.textContent = "…";
        etaMeta.textContent = "Getting the latest result from TransitPulse.";
      }

      try {
        var role = getStopRole(stop);
        if (role === "final_terminus") {
          renderEtaState({ status: "terminus" }, etaValue, etaMeta, stop);
          return;
        }
        var eta = await TransitPulseAPI.getEta(stop.route_stop_id, selectedDirection);
        currentEtaStop = stop;
        renderEtaState(eta, etaValue, etaMeta, stop);
      } catch (error) {
        console.error("ETA error:", error);
        etaValue.textContent = "—";
        etaMeta.textContent = getEtaError(error);
        etaMeta.className = "eta-meta eta-meta-error";
      } finally {
        resetButton(button, "Check ETA");
      }
    }

    function renderEtaState(eta, etaValue, etaMeta, stop) {
      etaMeta.className = "eta-meta";
      var liveIndicator = etaValue.parentElement ? etaValue.parentElement.querySelector(".live-indicator") : null;

      if (!eta || !eta.status) {
        if (liveIndicator) liveIndicator.classList.add("is-hidden");
        etaValue.textContent = "—";
        etaMeta.textContent = "The server returned an unexpected ETA response.";
        etaMeta.classList.add("eta-meta-error");
        return;
      }

      var role = stop ? getStopRole(stop) : (currentEtaStop ? getStopRole(currentEtaStop) : "intermediate");

      if (role === "final_terminus") {
        if (liveIndicator) liveIndicator.classList.add("is-hidden");
        etaValue.textContent = "Final Stop";
        etaMeta.textContent = "Bus terminates here";
        return;
      }

      if (eta.status === "live") {
        if (currentEtaStop && startCountdown(currentEtaStop, eta, etaValue, etaMeta)) return;
        stopCountdown();
        if (liveIndicator) liveIndicator.classList.remove("is-hidden");
        etaValue.textContent = getDisplayValue(eta["eta minutes"], "—") + " min";
        etaMeta.textContent = buildLiveMetaText(eta);
        return;
      }

      if (liveIndicator) liveIndicator.classList.add("is-hidden");

      if (role === "start_terminus") {
        stopCountdown();
        var mins = eta["eta minutes"] || 15;
        etaValue.textContent = "Leaves ~" + mins + " m";
        etaMeta.textContent = "Scheduled departures every " + mins + " min";
        return;
      }

      if (eta.status === "scheduled" || eta.status === "stale" || eta.status === "no data") {
        stopCountdown();
        var mins = eta["eta minutes"] || 15;
        etaValue.textContent = "~" + mins + " min";
        etaMeta.textContent = "About " + mins + " min (usual timing) · No live reports right now";
        return;
      }

      if (eta.status === "passed") {
        etaValue.textContent = "Just passed";
        var approxMins = eta["next bus approx mins"] || 15;
        etaMeta.textContent = "Bus may just have passed. Next bus approx " + approxMins + " min";
        return;
      }

      etaValue.textContent = "—";
      etaMeta.textContent = eta.message || "The ETA could not be determined.";
      etaMeta.classList.add("eta-meta-error");
    }

    async function reportSighting(stop, button, etaValue, etaMeta) {
      if (sightingCooldownActive) {
        etaMeta.className = "eta-meta eta-meta-warning";
        etaMeta.textContent = "A sighting was recently reported. Please wait before reporting again.";
        return;
      }

      if (!selectedStop || String(selectedStop.route_stop_id) !== String(stop.route_stop_id)) {
        showInlineInstruction("Please select this stop first.");
        return;
      }

      showSightingPicker(stop, button, etaValue, etaMeta);
    }

    function showSightingPicker(stop, button, etaValue, etaMeta) {
      var existingPicker = document.getElementById("sighting-picker");
      if (existingPicker) existingPicker.remove();

      var picker = document.createElement("div");
      picker.id = "sighting-picker";
      picker.style.cssText = "margin-top:12px;display:flex;flex-direction:column;gap:10px;";

      var dirLabel = document.createElement("div");
      dirLabel.className = "section-label";
      dirLabel.textContent = "Which direction is the bus heading?";

      var dirRow = document.createElement("div");
      dirRow.style.cssText = "display:flex;gap:8px;";

      var forwardDirBtn = document.createElement("button");
      forwardDirBtn.type = "button";
      forwardDirBtn.className = "direction-button picker-dir-forward" + (selectedDirection === "forward" ? " is-active" : "");
      forwardDirBtn.textContent = forwardLabel;
      forwardDirBtn.addEventListener("click", function () {
        forwardDirBtn.classList.add("is-active");
        returnDirBtn.classList.remove("is-active");
        setDirection("forward");
      });

      var returnDirBtn = document.createElement("button");
      returnDirBtn.type = "button";
      returnDirBtn.className = "direction-button picker-dir-return" + (selectedDirection === "return" ? " is-active" : "");
      returnDirBtn.textContent = returnLabel;
      returnDirBtn.addEventListener("click", function () {
        returnDirBtn.classList.add("is-active");
        forwardDirBtn.classList.remove("is-active");
        setDirection("return");
      });

      dirRow.appendChild(forwardDirBtn);
      dirRow.appendChild(returnDirBtn);

      var opLabel = document.createElement("div");
      opLabel.className = "section-label";
      opLabel.textContent = "Which operator?";

      var opRow = document.createElement("div");
      opRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";

      operators.forEach(function (op) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "direction-button";
        btn.textContent = op.short_code || op.name;
        btn.dataset.operatorId = op.id;
        btn.addEventListener("click", function () {
          opRow.querySelectorAll("button").forEach(function (b) {
            b.classList.remove("is-active");
          });
          btn.classList.add("is-active");
          selectedOperatorId = op.id;
        });
        opRow.appendChild(btn);
      });

      var privateBtn = document.createElement("button");
      privateBtn.type = "button";
      privateBtn.className = "direction-button";
      privateBtn.textContent = "Private";
      privateBtn.addEventListener("click", function () {
        opRow.querySelectorAll("button").forEach(function (b) {
          b.classList.remove("is-active");
        });
        privateBtn.classList.add("is-active");
        selectedOperatorId = null;
      });
      opRow.appendChild(privateBtn);

      var crowdLabel = document.createElement("div");
      crowdLabel.className = "section-label";
      crowdLabel.textContent = "How crowded?";

      var crowdRow = document.createElement("div");
      crowdRow.style.cssText = "display:flex;gap:8px;";

      ["empty", "moderate", "packed"].forEach(function (level) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "direction-button";
        btn.textContent = level.charAt(0).toUpperCase() + level.slice(1);
        btn.addEventListener("click", function () {
          crowdRow.querySelectorAll("button").forEach(function (b) {
            b.classList.remove("is-active");
          });
          btn.classList.add("is-active");
          selectedCrowdLevel = level;
        });
        crowdRow.appendChild(btn);
      });

      var submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "wide-button wide-button-secondary report-button";
      submitBtn.textContent = "Confirm & Submit";
      submitBtn.addEventListener("click", async function () {
        if (!selectedDirection) {
          etaMeta.className = "eta-meta eta-meta-warning";
          etaMeta.textContent = "Please choose which direction the bus is heading.";
          dirRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }

        setButtonLoading(submitBtn, "Sending...");

        try {
          await TransitPulseAPI.reportSighting({
            route_stop_id: stop.route_stop_id,
            direction: selectedDirection,
            operator_id: selectedOperatorId,
            crowd_level: selectedCrowdLevel
          });

          picker.remove();
          stopCountdown();
          startCooldown();
          showThankYou();
          button.disabled = true;
          button.textContent = "Reported • wait 3 min";
          button.classList.add("is-success");
          etaValue.textContent = "—";
          etaMeta.className = "eta-meta eta-meta-success";
          etaMeta.textContent = "Sighting shared. Tap Check ETA to get the latest.";
        } catch (error) {
          console.error("Sighting error:", error);

          if (error && error.status === 429) {
            button.classList.add("is-warning");
            button.disabled = true;
            etaMeta.className = "eta-meta eta-meta-warning";
            etaMeta.textContent = "You've recently reported a sighting. Please wait.";
            startCooldown();
            picker.remove();
            return;
          }

          resetButton(submitBtn, "Confirm & Submit");
          etaMeta.className = "eta-meta eta-meta-error";
          etaMeta.textContent = getSightingError(error);
        }
      });

      picker.appendChild(dirLabel);
      picker.appendChild(dirRow);
      picker.appendChild(opLabel);
      picker.appendChild(opRow);
      picker.appendChild(crowdLabel);
      picker.appendChild(crowdRow);
      picker.appendChild(submitBtn);

      button.parentNode.insertBefore(picker, button.nextSibling);
    }

    var thanksTimer = null;
    function showThankYou() {
      var old = document.getElementById("thanks-toast");
      if (old) old.remove();
      window.clearTimeout(thanksTimer);

      var el = document.createElement("div");
      el.id = "thanks-toast";
      el.className = "thanks-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML =
        '<div class="thanks-card">' +
          '<span class="thanks-spark"></span><span class="thanks-spark"></span><span class="thanks-spark"></span>' +
          '<span class="thanks-spark"></span><span class="thanks-spark"></span>' +
          '<div class="thanks-check"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17 L13.5 23 L25 10"/></svg></div>' +
          '<strong>Thank you!</strong>' +
          '<p>Your sighting just made someone\u2019s wait a little shorter.</p>' +
          '<small>Tap to close</small>' +
        '</div>';
      document.body.appendChild(el);

      function hide() {
        window.clearTimeout(thanksTimer);
        el.classList.remove("is-visible");
        window.setTimeout(function () { el.remove(); }, 260);
      }
      el.querySelector(".thanks-card").addEventListener("click", hide);
      window.requestAnimationFrame(function () { el.classList.add("is-visible"); });
      thanksTimer = window.setTimeout(hide, 3600);
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
