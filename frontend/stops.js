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
    var confirmTripParam = params.get("confirm_trip") === "1";
    var showWaypoints = false;

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
          var card = btn.closest(".stop-card");
          var stopId = card ? card.dataset.routeStopId : null;
          var stopObj = stops.find(function (s) { return String(s.route_stop_id) === String(stopId); });
          btn.textContent = getReportButtonLabel(stopObj);
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
            var card = btn.closest(".stop-card");
            var stopId = card ? card.dataset.routeStopId : null;
            var stopObj = stops.find(function (s) { return String(s.route_stop_id) === String(stopId); });
            btn.textContent = getReportButtonLabel(stopObj);
            btn.classList.remove("is-warning", "is-success", "is-cooldown");
          });
          return;
        }

        sightingCooldownActive = true;
        reportButtons.forEach(function (btn) {
          btn.disabled = true;
          btn.textContent = "Reported • wait " + left + "s";
          btn.classList.add("is-cooldown");
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

    function getHeadwaySchedule(isOrigin) {
      var now = new Date();
      var utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      var ist = new Date(utc + (3600000 * 5.5));
      var hour = ist.getHours() + ist.getMinutes() / 60.0;

      if (hour >= 6.0 && hour < 10.0) {
        return {
          headway: isOrigin ? 15 : 22,
          tier: "Peak morning",
          description: isOrigin ? "departures every ~15 min" : "corridor frequency ~22 min",
          isNight: false
        };
      } else if (hour >= 10.0 && hour < 12.0) {
        return {
          headway: 30,
          tier: "Midday",
          description: "departures every ~30 min",
          isNight: false
        };
      } else if (hour >= 12.0 && hour < 14.0) {
        return {
          headway: isOrigin ? 35 : 40,
          tier: "Afternoon slump",
          description: isOrigin ? "departures every 35-40 min" : "corridor frequency 35-40 min",
          isNight: false
        };
      } else if (hour >= 14.0 && hour < 18.0) {
        return {
          headway: isOrigin ? 25 : 30,
          tier: "Evening corridor",
          description: "departures every ~30 min",
          isNight: false
        };
      } else if (hour >= 18.0 && hour <= 20.0) {
        return {
          headway: isOrigin ? 35 : 40,
          tier: "Late evening",
          description: "final departures until 8:00 PM (last bus leaves 8:00 PM)",
          isNight: false
        };
      } else {
        return {
          headway: 0,
          tier: "Service Closed",
          description: "service ended for today (regular service runs 6:00 AM - 8:00 PM)",
          isNight: true
        };
      }
    }

    function getCorridorSlots() {
      var slots = [];
      for (var t = 6 * 60; t <= 10 * 60; t += 15) slots.push(t);
      for (var t = 10 * 60 + 30; t <= 12 * 60; t += 30) slots.push(t);
      for (var t = 12 * 60 + 35; t <= 14 * 60; t += 35) slots.push(t);
      for (var t = 14 * 60 + 30; t <= 18 * 60; t += 30) slots.push(t);
      for (var t = 18 * 60 + 40; t <= 20 * 60; t += 40) slots.push(t);
      return slots;
    }

    function formatClock12h(totalMinutes) {
      totalMinutes = totalMinutes % (24 * 60);
      var h = Math.floor(totalMinutes / 60);
      var m = totalMinutes % 60;
      var period = h < 12 ? "AM" : "PM";
      var h12 = h % 12 || 12;
      return h12 + ":" + (m < 10 ? "0" : "") + m + " " + period;
    }

    function getDepartureSlotsInfo() {
      var now = new Date();
      var utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      var ist = new Date(utc + (3600000 * 5.5));
      var totalMins = ist.getHours() * 60 + ist.getMinutes();
      var slots = getCorridorSlots();

      if (totalMins > 20 * 60 || totalMins < 6 * 60) {
        var isBeforeMorning = totalMins < 6 * 60;
        var minsToMorning = isBeforeMorning ? (6 * 60 - totalMins) : (24 * 60 - totalMins + 6 * 60);
        return {
          currentSlotTime: isBeforeMorning ? "6:00 AM" : "NO BUS",
          currentSlotMinutes: isBeforeMorning ? minsToMorning : 0,
          upcomingSlots: [],
          previousSlotTime: "8:00 PM",
          isClosed: true,
          message: isBeforeMorning
            ? "Service starts at 6:00 AM · First bus in ~" + minsToMorning + " min"
            : "Last bus from depot departs by 8:00 PM"
        };
      }

      var upcoming = slots.filter(function (s) { return s >= totalMins; });
      if (upcoming.length === 0) {
        return {
          currentSlotTime: "NO BUS",
          currentSlotMinutes: 0,
          upcomingSlots: [],
          previousSlotTime: "8:00 PM",
          isClosed: true,
          message: "Last bus from depot departs by 8:00 PM"
        };
      }

      var currentSlot = upcoming[0];
      var nextSlots = upcoming.slice(1, 3);
      if (nextSlots.length === 0) nextSlots = [slots[0]];
      var prevSlots = slots.filter(function (s) { return s < totalMins; });
      var prevSlot = prevSlots.length > 0 ? prevSlots[prevSlots.length - 1] : null;

      return {
        currentSlotTime: formatClock12h(currentSlot),
        currentSlotMinutes: Math.max(0, currentSlot - totalMins),
        upcomingSlots: nextSlots.map(formatClock12h),
        previousSlotTime: prevSlot !== null ? formatClock12h(prevSlot) : null,
        isClosed: false
      };
    }

    function getPrimaryStops() {
      var primary = stops.filter(function (s) { return !s.is_waypoint; });
      return primary.length > 0 ? primary : stops;
    }

    function getStopRole(stop) {
      if (!stop) return "intermediate";
      if (stop.is_waypoint) return "waypoint";
      var primary = getPrimaryStops();
      if (!primary || primary.length < 2 || !selectedDirection) return "intermediate";
      var firstStop = primary[0];
      var lastStop = primary[primary.length - 1];
      var stopId = String(stop.route_stop_id);
      var name = (stop.name || "").toLowerCase();

      if (selectedDirection === "return") {
        if (stopId === String(lastStop.route_stop_id) || name.indexOf("delhi") !== -1 || name.indexOf("anand vihar") !== -1 || name.indexOf("kaushambi") !== -1) {
          if (stopId !== String(firstStop.route_stop_id)) return "start_terminus";
        }
        if (stopId === String(firstStop.route_stop_id) || name.indexOf("hapur") !== -1) {
          if (stopId !== String(lastStop.route_stop_id)) return "final_terminus";
        }
      } else if (selectedDirection === "forward") {
        if (stopId === String(firstStop.route_stop_id) || name.indexOf("hapur") !== -1) {
          if (stopId !== String(lastStop.route_stop_id)) return "start_terminus";
        }
        if (stopId === String(lastStop.route_stop_id) || name.indexOf("delhi") !== -1 || name.indexOf("anand vihar") !== -1 || name.indexOf("kaushambi") !== -1) {
          if (stopId !== String(firstStop.route_stop_id)) return "final_terminus";
        }
      }
      return "intermediate";
    }

    function isOriginStop(stop) {
      if (!stop || stop.is_waypoint || !selectedDirection) return false;
      var primary = getPrimaryStops();
      if (!primary || primary.length === 0) return false;
      var firstStop = primary[0];
      var lastStop = primary[primary.length - 1];
      var stopId = String(stop.route_stop_id);
      var name = (stop.name || "").toLowerCase();

      if (selectedDirection === "forward") {
        if (stopId === String(firstStop.route_stop_id)) return true;
        if (name.indexOf("hapur") !== -1) return true;
      } else if (selectedDirection === "return") {
        if (stopId === String(lastStop.route_stop_id)) return true;
        if (name.indexOf("delhi") !== -1 || name.indexOf("anand vihar") !== -1 || name.indexOf("kaushambi") !== -1) return true;
      }
      return false;
    }

    function getReportButtonLabel(stop) {
      if (isOriginStop(stop)) {
        return "Bus Departed";
      }
      return "I see the bus";
    }

    function buildLiveMetaText(eta) {
      var parts = [];
      var speed = Number(eta.live_speed_kmh);
      if (eta.traffic_status === "heavy" && isFinite(speed) && speed > 0) {
        parts.push("Slow traffic (" + Math.round(speed) + " km/h)");
      } else if (eta.traffic_status === "moderate" && isFinite(speed) && speed > 0) {
        parts.push("Moderate traffic (" + Math.round(speed) + " km/h)");
      }

      if (eta["spotted at"]) {
        parts.push("Spotted at " + eta["spotted at"]);
      } else {
        var reports = eta.reports_count || 1;
        parts.push("Based on " + reports + (reports === 1 ? " report" : " reports"));
      }

      var ago = formatRelativeAgo(eta.seen_ago_minutes);
      if (ago) parts.push(ago);

      if (eta.traffic_status === "smooth" && isFinite(speed) && speed > 0) {
        parts.push(Math.round(speed) + " km/h");
      }

      return parts.join(" · ");
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

    function formatDistanceAway(km) {
      if (km === undefined || km === null || !isFinite(Number(km)) || Number(km) <= 0) return "";
      var val = Number(km);
      if (val < 0.2) return "< 0.2 km away";
      return val.toFixed(1) + " km away";
    }

    function startCountdown(stop, eta, etaValue, etaMeta) {
      var liveIndicator = etaValue.parentElement ? etaValue.parentElement.querySelector(".live-indicator") : null;
      var upcomingEl = etaValue.parentElement ? etaValue.parentElement.querySelector(".eta-upcoming") : null;
      var parsed = parseEta(eta);
      if (!parsed) {
        if (liveIndicator) liveIndicator.classList.add("is-hidden");
        return false;
      }

      var sameStop = countdownStopId === String(stop.route_stop_id) && countdownEndAt !== null;
      var left = sameStop ? (countdownEndAt - Date.now()) / 1000 : -1;
      var terminatesSuffix = getStopRole(stop) === "final_terminus" ? " · Bus terminates here" : "";
      var liveMeta = buildLiveMetaText(eta) + terminatesSuffix;
      var metaClass = eta.traffic_status === "heavy" ? "eta-meta eta-meta-warning" : "eta-meta";
      var initialDistKm = (eta.distance_km !== undefined && eta.distance_km !== null && isFinite(Number(eta.distance_km)) && Number(eta.distance_km) > 0)
        ? Number(eta.distance_km)
        : null;
      var initialSec = Math.max(1, parsed.sec);

      if (sameStop && !parsed.precise && left > 0 && Math.abs(left - parsed.sec) <= 60) {
        if (liveIndicator) liveIndicator.classList.remove("is-hidden");
        etaMeta.className = metaClass;
        etaMeta.textContent = liveMeta;
        return true;
      }

      stopCountdown();
      if (liveIndicator) liveIndicator.classList.remove("is-hidden");
      countdownEndAt = Date.now() + parsed.sec * 1000;
      countdownStopId = String(stop.route_stop_id);
      etaValue.classList.add("is-ticking");

      function updateDistanceAnchor(remSec) {
        if (!upcomingEl) return;
        if (initialDistKm === null) {
          upcomingEl.textContent = "";
          upcomingEl.classList.add("is-hidden");
          return;
        }
        var curKm = remSec <= 0 ? 0.1 : Math.max(0.1, initialDistKm * Math.min(1, remSec / initialSec));
        upcomingEl.textContent = formatDistanceAway(curKm);
        upcomingEl.classList.remove("is-hidden");
      }

      function tick() {
        var remaining = Math.round((countdownEndAt - Date.now()) / 1000);
        if (remaining <= 0) {
          var role = getStopRole(stop);
          etaValue.textContent = (role === "start_terminus" || eta.is_departure) ? "Departing" : "Arriving";
          etaValue.classList.remove("is-ticking");
          etaValue.classList.add("is-arriving");
          updateDistanceAnchor(0);
          window.clearInterval(tickTimer);
          tickTimer = null;
          return;
        }
        var m = Math.floor(remaining / 60);
        var sec = remaining % 60;
        etaValue.textContent = m + ":" + (sec < 10 ? "0" : "") + sec;
        updateDistanceAnchor(remaining);
      }

      tick();
      tickTimer = window.setInterval(tick, 1000);
      etaMeta.className = metaClass;
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

    
    function openAuthModal(message) {
      var modal = document.getElementById("auth-modal");
      if (!modal) {
        var returnUrl = window.location.pathname + window.location.search;
        window.location.href = "register.html?return=" + encodeURIComponent(returnUrl);
        return;
      }
      var copy = document.getElementById("auth-modal-copy");
      if (copy && message) copy.textContent = message;
      modal.classList.remove("is-hidden");
      window.requestAnimationFrame(function () { modal.classList.add("is-open"); });
    }

    function closeAuthModal() {
      var modal = document.getElementById("auth-modal");
      if (!modal) return;
      modal.classList.remove("is-open");
      window.setTimeout(function () { modal.classList.add("is-hidden"); }, 200);
    }

    var authContinue = document.getElementById("auth-modal-continue");
    if (authContinue) {
      authContinue.addEventListener("click", function () {
        var returnUrl = window.location.pathname + window.location.search;
        window.location.href = "register.html?return=" + encodeURIComponent(returnUrl);
      });
    }

    var authCancel = document.getElementById("auth-modal-cancel");
    if (authCancel) {
      authCancel.addEventListener("click", closeAuthModal);
    }
    var authModal = document.getElementById("auth-modal");
    if (authModal) {
      authModal.addEventListener("click", function (e) {
        if (e.target === authModal) closeAuthModal();
      });
    }

    var savedDir = null;
    try {
      savedDir = localStorage.getItem("tp_dir_" + routeId);
    } catch (e) {}
    var initialDirection = "forward";
    if (savedDir === "forward" || savedDir === "return") {
      initialDirection = savedDir;
    } else {
      var currentHour = new Date().getHours();
      initialDirection = (currentHour < 13) ? "forward" : "return";
    }
    setDirection(initialDirection);

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

    function renderCheckpointToggle(waypointCount) {
      var head = document.querySelector(".route-section-head");
      if (!head) return;
      var btn = document.getElementById("checkpoint-toggle-btn");
      if (waypointCount <= 0) {
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        return;
      }
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.id = "checkpoint-toggle-btn";
        btn.className = "checkpoint-toggle-btn";
        btn.addEventListener("click", function () {
          showWaypoints = !showWaypoints;
          renderStops();
        });
        head.appendChild(btn);
      }
      btn.setAttribute("aria-pressed", String(showWaypoints));
      btn.classList.toggle("is-active", showWaypoints);
      btn.textContent = showWaypoints
        ? "Hide checkpoints"
        : ("Show " + waypointCount + (waypointCount === 1 ? " checkpoint" : " checkpoints"));
    }

    function renderStops() {
      stopsList.innerHTML = "";

      if (stops.length === 0) {
        emptyCard.classList.remove("is-hidden");
        stopsSubtitle.textContent = "No stops available";
        renderCheckpointToggle(0);
        return;
      }

      emptyCard.classList.add("is-hidden");

      var primaryStops = getPrimaryStops();
      var waypointCount = stops.filter(function (s) { return Boolean(s.is_waypoint); }).length;

      if (preselectStopId) {
        var preStop = stops.find(function (s) { return String(s.route_stop_id) === String(preselectStopId); });
        if (preStop && preStop.is_waypoint) showWaypoints = true;
      }

      stopsSubtitle.textContent = primaryStops.length + (primaryStops.length === 1 ? " stop" : " stops");
      renderCheckpointToggle(waypointCount);

      var visibleStops = showWaypoints ? stops : primaryStops;
      visibleStops.forEach(function (stop) {
        stopsList.appendChild(createStopCard(stop));
      });

      checkCooldown();

      if (confirmTripParam && window.TransitPulseTrip) {
        confirmTripParam = false;
        window.TransitPulseTrip.confirmNow();
      }

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
      var isWp = Boolean(stop.is_waypoint);
      var card = document.createElement("article");
      card.className = "stop-card" + (isWp ? " is-waypoint-card" : "");
      card.dataset.routeStopId = String(stop.route_stop_id);

      var top = document.createElement("button");
      top.type = "button";
      top.className = "stop-select-button";
      top.setAttribute("aria-pressed", "false");

      var indicator = document.createElement("span");
      indicator.className = "stop-indicator" + (isWp ? " is-waypoint-indicator" : "");
      indicator.setAttribute("aria-hidden", "true");

      var text = document.createElement("span");
      text.className = "stop-text";

      var name = document.createElement("strong");
      name.textContent = getDisplayValue(stop.name, "Unnamed stop");

      if (isWp) {
        var wpTag = document.createElement("span");
        wpTag.className = "waypoint-tag";
        wpTag.textContent = "CHECKPOINT";
        text.appendChild(wpTag);
      }

      var landmark = document.createElement("small");
      landmark.textContent = getDisplayValue(stop.landmark, isWp ? "Highway timing checkpoint" : "No landmark provided");

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

      var etaUpcoming = document.createElement("span");
      etaUpcoming.className = "eta-upcoming is-hidden";

      etaValueWrap.appendChild(liveIndicator);
      etaValueWrap.appendChild(etaValue);
      etaValueWrap.appendChild(etaUpcoming);

      etaPanel.appendChild(etaLabel);
      etaPanel.appendChild(etaValueWrap);

      var etaMeta = document.createElement("p");
      etaMeta.className = "eta-meta";

      var initialRole = getStopRole(stop);
      var actions = document.createElement("div");
      actions.className = "stop-actions";

      var etaButton = document.createElement("button");
      etaButton.type = "button";
      etaButton.className = "wide-button wide-button-primary";

      if (initialRole === "final_terminus") {
        etaLabel.textContent = "DESTINATION";
        etaValue.textContent = "—";
        etaMeta.textContent = "Final Stop · Bus terminates here. Tap Check ETA.";
        etaButton.textContent = "Check ETA";
      } else if (initialRole === "start_terminus") {
        etaLabel.textContent = "DEPARTURE";
        etaValue.textContent = "—";
        etaValue.classList.remove("has-clock");
        etaUpcoming.textContent = "";
        etaUpcoming.classList.add("is-hidden");
        etaMeta.textContent = "Ready to check the latest departure for this stop.";
        etaButton.textContent = "Check Departure";
      } else {
        etaLabel.textContent = "ETA";
        etaValue.textContent = "—";
        etaValue.classList.remove("has-clock");
        etaUpcoming.textContent = "";
        etaUpcoming.classList.add("is-hidden");
        etaMeta.textContent = selectedDirection
          ? "Ready to check the latest ETA for this stop."
          : "Select direction above, then check ETA.";
        etaButton.textContent = "Check ETA";
      }
      etaButton.addEventListener("click", function () {
        loadEta(stop, etaButton, etaValue, etaMeta);
      });

      var reportButton = document.createElement("button");
      reportButton.type = "button";
      reportButton.className = "wide-button wide-button-secondary report-button";
      reportButton.textContent = getReportButtonLabel(stop);
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

      if (!isWp) {
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
          if (!TransitPulseStorage.getUserId()) {
            openAuthModal("Verify your number once to save your favourite stops across devices.");
            return;
          }
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
      }

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
      var selectedUpcoming = details.querySelector(".eta-upcoming");
      var selectedIndicator = details.querySelector(".live-indicator");
      if (selectedIndicator) selectedIndicator.classList.add("is-hidden");
      if (selectedUpcoming) {
        selectedUpcoming.textContent = "";
        selectedUpcoming.classList.add("is-hidden");
      }
      if (selectedEta) {
        selectedEta.textContent = "—";
        selectedEta.classList.remove("has-clock");
      }
      if (selectedMeta) {
        selectedMeta.className = "eta-meta";
        var selRole = getStopRole(stop);
        if (!selectedDirection) {
          selectedMeta.textContent = "Select direction above, then check ETA.";
        } else if (selRole === "start_terminus") {
          selectedMeta.textContent = "Ready to check the latest departure for this stop.";
        } else if (selRole === "final_terminus") {
          selectedMeta.textContent = "Final Stop · Bus terminates here. Tap Check ETA.";
        } else {
          selectedMeta.textContent = "Ready to check the latest ETA for this stop.";
        }
      }
    }

    function setDirection(direction) {
      stopCountdown();
      selectedDirection = direction;
      try {
        localStorage.setItem("tp_dir_" + routeId, direction);
      } catch (e) {}
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

        var btn = card.querySelector(".wide-button-primary");
        var reportBtn = card.querySelector(".report-button");
        var upcomingEl = card.querySelector(".eta-upcoming");

        if (reportBtn && !sightingCooldownActive) {
          reportBtn.textContent = getReportButtonLabel(stopObj);
        }

        if (role === "final_terminus") {
          if (upcomingEl) {
            upcomingEl.textContent = "";
            upcomingEl.classList.add("is-hidden");
          }
          if (val) {
            val.textContent = "—";
            val.classList.remove("has-clock");
          }
          if (label) label.textContent = "DESTINATION";
          if (meta) {
            meta.className = "eta-meta";
            meta.textContent = "Final Stop · Bus terminates here. Tap Check ETA.";
          }
          if (btn) btn.textContent = "Check ETA";
        } else if (role === "start_terminus") {
          if (upcomingEl) {
            upcomingEl.textContent = "";
            upcomingEl.classList.add("is-hidden");
          }
          if (val) {
            val.textContent = "—";
            val.classList.remove("has-clock");
          }
          if (label) label.textContent = "DEPARTURE";
          if (meta) {
            meta.className = "eta-meta";
            meta.textContent = "Ready to check the latest departure for this stop.";
          }
          if (btn) btn.textContent = "Check Departure";
        } else {
          if (upcomingEl) {
            upcomingEl.textContent = "";
            upcomingEl.classList.add("is-hidden");
          }
          if (val) {
            val.textContent = "—";
            val.classList.remove("has-clock");
          }
          if (label) label.textContent = "ETA";
          if (meta) {
            meta.className = "eta-meta";
            meta.textContent = "Ready to check the latest ETA for this stop.";
          }
          if (btn) btn.textContent = "Check ETA";
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

      var role = getStopRole(stop);
      var btnLabel = role === "start_terminus" ? "Check Departure" : "Check ETA";
      setButtonLoading(button, role === "start_terminus" ? "Checking Departure..." : "Checking ETA...");
      if (countdownStopId !== String(stop.route_stop_id)) {
        etaValue.textContent = "…";
        etaMeta.textContent = "Getting the latest result from TransitPulse.";
      }

      try {
        var eta = await TransitPulseAPI.getEta(stop.route_stop_id, selectedDirection);
        currentEtaStop = stop;
        renderEtaState(eta, etaValue, etaMeta, stop);
      } catch (error) {
        console.error("ETA error:", error);
        etaValue.textContent = "—";
        etaMeta.textContent = getEtaError(error);
        etaMeta.className = "eta-meta eta-meta-error";
      } finally {
        resetButton(button, btnLabel);
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
      var terminatesSuffix = role === "final_terminus" ? " · Bus terminates here" : "";
      var card = etaValue.closest(".stop-card");
      var upcomingEl = card ? card.querySelector(".eta-upcoming") : null;

      if (eta.status === "closed" || eta.clock_time === "NO BUS" || eta.is_closed) {
        stopCountdown();
        if (liveIndicator) liveIndicator.classList.add("is-hidden");
        if (upcomingEl) {
          upcomingEl.textContent = "";
          upcomingEl.classList.add("is-hidden");
        }
        etaValue.textContent = "NO BUS";
        etaValue.classList.add("has-clock");
        var originLabel = selectedDirection === "return" ? "Delhi" : "Hapur";
        var defMeta = role === "start_terminus"
          ? "Last bus from depot departs by 8:00 PM"
          : (role === "final_terminus" ? "Last bus terminates here by ~9:30 PM" : "Last bus from " + originLabel + " departs by 8:00 PM");
        etaMeta.textContent = eta.message || defMeta;
        return;
      }

      if (eta.status === "live") {
        if (role === "start_terminus" || eta.is_departure) {
          var labelEl = etaValue.closest(".eta-panel") ? etaValue.closest(".eta-panel").querySelector(".eta-label") : null;
          if (labelEl) labelEl.textContent = "NEXT DEPARTURE";
          if (eta.clock_time) {
            etaValue.textContent = eta.clock_time;
            etaValue.classList.add("has-clock");
          } else {
            etaValue.textContent = getDisplayValue(eta["eta minutes"], "—") + " min";
            etaValue.classList.remove("has-clock");
          }
          if (upcomingEl) {
            if (eta.upcoming_text && eta.upcoming_text.trim() !== "Upcoming:") {
              upcomingEl.textContent = eta.upcoming_text;
              upcomingEl.classList.remove("is-hidden");
            } else {
              upcomingEl.textContent = "";
              upcomingEl.classList.add("is-hidden");
            }
          }
          if (liveIndicator) liveIndicator.classList.remove("is-hidden");
          etaMeta.textContent = eta.message || (buildLiveMetaText(eta) + terminatesSuffix);
          return;
        }

        if (upcomingEl) {
          upcomingEl.textContent = "";
          upcomingEl.classList.add("is-hidden");
        }
        etaValue.classList.remove("has-clock");

        if (currentEtaStop && startCountdown(currentEtaStop, eta, etaValue, etaMeta)) return;
        stopCountdown();
        if (liveIndicator) liveIndicator.classList.remove("is-hidden");
        etaValue.textContent = getDisplayValue(eta["eta minutes"], "—") + " min";
        var distText = formatDistanceAway(eta.distance_km);
        if (upcomingEl && distText) {
          upcomingEl.textContent = distText;
          upcomingEl.classList.remove("is-hidden");
        }
        etaMeta.className = eta.traffic_status === "heavy" ? "eta-meta eta-meta-warning" : "eta-meta";
        etaMeta.textContent = eta.message || (buildLiveMetaText(eta) + terminatesSuffix);
        return;
      }

      if (liveIndicator) liveIndicator.classList.add("is-hidden");

      if (role === "start_terminus") {
        stopCountdown();
        var slots = getDepartureSlotsInfo();
        etaValue.textContent = eta.clock_time || slots.currentSlotTime;
        etaValue.classList.add("has-clock");
        if (upcomingEl) {
          var upText = eta.upcoming_text !== undefined ? eta.upcoming_text : (slots.upcomingSlots.length > 0 ? "Upcoming: " + slots.upcomingSlots.join(" · ") : "");
          if (upText && upText.trim() !== "Upcoming:") {
            upcomingEl.textContent = upText;
            upcomingEl.classList.remove("is-hidden");
          } else {
            upcomingEl.textContent = "";
            upcomingEl.classList.add("is-hidden");
          }
        }
        var mins = eta["eta minutes"] !== undefined ? eta["eta minutes"] : slots.currentSlotMinutes;
        etaMeta.textContent = eta.message || (slots.isClosed ? "Last bus from depot departs by 8:00 PM" : ("Scheduled slot · Departs in ~" + mins + " min"));
        return;
      }

      if (upcomingEl) {
        upcomingEl.textContent = "";
        upcomingEl.classList.add("is-hidden");
      }
      etaValue.classList.remove("has-clock");

      if (eta.status === "passed") {
        stopCountdown();
        var approxMins = eta["next bus approx mins"] || eta["eta minutes"] || 15;
        if (eta.seen_ago_minutes !== undefined && eta.seen_ago_minutes <= 2) {
          etaValue.textContent = "Just passed";
          etaMeta.textContent = "Bus just passed · Next bus in ~" + approxMins + " min" + terminatesSuffix;
        } else {
          etaValue.textContent = "~" + approxMins + " min";
          etaMeta.textContent = (eta.message || ("Bus passed " + formatRelativeAgo(eta.seen_ago_minutes) + " · Next in ~" + approxMins + " min")) + terminatesSuffix;
        }
        return;
      }

      if (eta.status === "scheduled" || eta.status === "stale" || eta.status === "no data") {
        stopCountdown();
        var mins = Number.isFinite(eta["eta minutes"]) && eta["eta minutes"] > 0 ? eta["eta minutes"] : 15;
        etaValue.textContent = "~" + mins + " min";
        etaMeta.textContent = eta.message || ("About " + mins + " min (usual timing)" + terminatesSuffix);
        return;
      }

      etaValue.textContent = "—";
      etaMeta.textContent = eta.message || "The ETA could not be determined.";
      etaMeta.classList.add("eta-meta-error");
    }

    async function reportSighting(stop, button, etaValue, etaMeta) {
      if (!TransitPulseStorage.getUserId()) {
        openAuthModal("Verify your number once to earn your Scout badge and prevent spam.");
        return;
      }
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

      var CROWD_LABELS = { empty: "Empty seats", moderate: "Standing only", packed: "Fully packed" };
      ["empty", "moderate", "packed"].forEach(function (level) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "direction-button";
        btn.textContent = CROWD_LABELS[level];
        btn.addEventListener("click", function () {
          crowdRow.querySelectorAll("button").forEach(function (b) {
            b.classList.remove("is-active");
          });
          btn.classList.add("is-active");
          selectedCrowdLevel = level;
        });
        crowdRow.appendChild(btn);
      });

      var isOrigin = isOriginStop(stop);
      var defaultSubmitText = isOrigin ? "Confirm Departure" : "Confirm & Submit";
      var submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "wide-button wide-button-secondary report-button";
      submitBtn.textContent = defaultSubmitText;
      submitBtn.addEventListener("click", async function () {
        if (!selectedDirection) {
          etaMeta.className = "eta-meta eta-meta-warning";
          etaMeta.textContent = "Please choose which direction the bus is heading.";
          dirRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }

        setButtonLoading(submitBtn, "Sending...");

        try {
          var sightingResult = await TransitPulseAPI.reportSighting({
            route_stop_id: stop.route_stop_id,
            direction: selectedDirection,
            operator_id: selectedOperatorId,
            crowd_level: selectedCrowdLevel
          });

          picker.remove();
          stopCountdown();
          startCooldown();
          if (sightingResult && sightingResult.active_trip && window.TransitPulseTrip) {
            window.TransitPulseTrip.start(sightingResult.active_trip);
          }
          showThankYou(sightingResult && sightingResult.new_badges);
          button.disabled = true;
          button.textContent = "Reported • wait 3 min";
          button.classList.add("is-cooldown");
          etaValue.textContent = "—";
          etaMeta.className = "eta-meta eta-meta-success";
          etaMeta.textContent = isOrigin
            ? "Departure reported. Tap Check Departure to get the latest."
            : "Sighting shared. Tap Check ETA to get the latest.";
        } catch (error) {
          console.error("Sighting error:", error);

          if (error && error.status === 429) {
            button.classList.add("is-cooldown");
            button.disabled = true;
            etaMeta.className = "eta-meta eta-meta-warning";
            etaMeta.textContent = "You've recently reported a sighting. Please wait.";
            startCooldown();
            picker.remove();
            return;
          }

          resetButton(submitBtn, defaultSubmitText);
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
    function showThankYou(newBadges) {
      var old = document.getElementById("thanks-toast");
      if (old) old.remove();
      window.clearTimeout(thanksTimer);

      var unlocked = Array.isArray(newBadges) ? newBadges : [];

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
          '<strong>Thank you</strong>' +
          '<p>Your sighting just made someone\u2019s wait a little shorter.</p>' +
          '<small>Tap to close</small>' +
        '</div>';

      if (unlocked.length) {
        var card = el.querySelector(".thanks-card");
        var box = document.createElement("div");
        box.className = "thanks-badges";
        var heading = document.createElement("p");
        heading.className = "thanks-badges-title";
        heading.textContent = unlocked.length === 1 ? "New badge unlocked" : "New badges unlocked";
        box.appendChild(heading);
        unlocked.forEach(function (b, i) {
          var row = document.createElement("div");
          row.className = "thanks-badge-row";
          if (window.TransitPulseBadgeArt) {
            row.appendChild(window.TransitPulseBadgeArt.stamp(b.id, true, window.TransitPulseBadgeArt.tilt(i * 3)));
          }
          var text = document.createElement("span");
          text.textContent = b.name;
          row.appendChild(text);
          box.appendChild(row);
        });
        var link = document.createElement("a");
        link.className = "thanks-badges-link";
        link.href = "profile.html";
        link.textContent = "See my badges";
        box.appendChild(link);
        card.insertBefore(box, card.querySelector("small"));
      }
      document.body.appendChild(el);

      function hide() {
        window.clearTimeout(thanksTimer);
        el.classList.remove("is-visible");
        window.setTimeout(function () { el.remove(); }, 260);
      }
      el.querySelector(".thanks-card").addEventListener("click", hide);
      window.requestAnimationFrame(function () { el.classList.add("is-visible"); });
      thanksTimer = window.setTimeout(hide, unlocked.length ? 6500 : 3600);
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

    var NETWORK_MESSAGE = "Can't reach TransitPulse right now. Check your internet and tap again. If the app was idle, the first try can take a minute.";

    function getDisplayValue(value, fallback) {
      if (value === undefined || value === null || String(value).trim() === "") return fallback;
      return String(value);
    }

    function getStopsError(error) {
      if (error && error.isNetworkError) return NETWORK_MESSAGE;
      return error && error.message ? error.message : "Could not load stops.";
    }

    function getEtaError(error) {
      if (error && error.isNetworkError) return NETWORK_MESSAGE;
      return error && error.message ? error.message : "Could not load the ETA.";
    }

    function getSightingError(error) {
      if (error && error.isNetworkError) return "Could not send the sighting because the server could not be reached.";
      return error && error.message ? error.message : "Could not send the sighting.";
    }
  });
})();