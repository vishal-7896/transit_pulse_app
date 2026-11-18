(function () {
  "use strict";

  var deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  var ICONS = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    routes: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };

  var ITEMS = [
    { id: "home", label: "Home", href: "index.html", icon: ICONS.home },
    { id: "routes", label: "Routes", href: "routes.html", icon: ICONS.routes },
    { id: "starred", label: "Starred", href: "starred.html", icon: ICONS.star },
    { id: "profile", label: "Profile", href: "profile.html", icon: ICONS.profile }
  ];

  function currentId() {
    var file = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (file === "routes.html" || file === "stops.html") return "routes";
    if (file === "starred.html") return "starred";
    if (file === "profile.html") return "profile";
    return "home";
  }

  function initPosterInstallPrompt() {
    var urlParams = new URLSearchParams(window.location.search);
    var src = urlParams.get("src");
    if (src === "poster") {
      try {
        sessionStorage.setItem("tp_scan_src", "poster");
      } catch (e) {}
    }
    var isPosterScan = (src === "poster") || (sessionStorage.getItem("tp_scan_src") === "poster");
    if (!isPosterScan) return;

    var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (isStandalone) return;

    if (sessionStorage.getItem("tp_install_banner_dismissed") === "1") return;

    setTimeout(function () {
      if (document.getElementById("poster-install-banner")) return;

      var banner = document.createElement("div");
      banner.className = "poster-install-banner";
      banner.id = "poster-install-banner";
      banner.setAttribute("role", "dialog");
      banner.setAttribute("aria-labelledby", "pib-title");
      banner.innerHTML = '<button class="pib-close" id="pib-close-btn" aria-label="Dismiss">✕</button>' +
        '<div class="pib-content">' +
          '<div class="pib-icon-wrap" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" class="pib-icon"><path d="M12 2v13m0 0l-4-4m4 4l4-4M3 17v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' +
          '</div>' +
          '<div class="pib-text">' +
            '<span class="pib-tag">STOP POSTER SCAN</span>' +
            '<h3 class="pib-title" id="pib-title">Add to your Home Screen</h3>' +
            '<p class="pib-desc" id="pib-desc">1-tap live arrival countdowns every time you\'re waiting at this bus stop.</p>' +
          '</div>' +
        '</div>' +
        '<div class="pib-action-row">' +
          '<button type="button" class="pib-install-btn" id="pib-install-btn">' +
            '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M10 2a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L9 11.586V3a1 1 0 0 1 1-1zM3 15a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1z"/></svg>' +
            '<span>Install App</span>' +
          '</button>' +
          '<button type="button" class="pib-dismiss-btn" id="pib-dismiss-btn">Keep in browser</button>' +
        '</div>' +
        '<div class="pib-ios-hint is-hidden" id="pib-ios-hint">' +
          '<span>Tap <strong>Share</strong> <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-2px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> below, then <strong>Add to Home Screen</strong></span>' +
        '</div>';

      document.body.appendChild(banner);

      function dismissBanner() {
        banner.style.transition = "transform 250ms ease, opacity 250ms ease";
        banner.style.transform = "translateY(120%)";
        banner.style.opacity = "0";
        setTimeout(function () {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 300);
        try {
          sessionStorage.setItem("tp_install_banner_dismissed", "1");
        } catch (e) {}
      }

      var closeBtn = document.getElementById("pib-close-btn");
      var dismissBtn = document.getElementById("pib-dismiss-btn");
      var installBtn = document.getElementById("pib-install-btn");
      var iosHint = document.getElementById("pib-ios-hint");

      if (closeBtn) closeBtn.addEventListener("click", dismissBanner);
      if (dismissBtn) dismissBtn.addEventListener("click", dismissBanner);

      if (installBtn) {
        installBtn.addEventListener("click", function () {
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then(function (result) {
              deferredInstallPrompt = null;
              if (result && result.outcome === "accepted") {
                dismissBanner();
              }
            });
          } else {
            var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
            if (isIos && iosHint) {
              iosHint.classList.remove("is-hidden");
            } else {
              alert("To install TransitPulse: tap your browser menu (⋮) and select 'Install app' or 'Add to Home screen'.");
              dismissBanner();
            }
          }
        });
      }
    }, 1400);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var active = currentId();
    var nav = document.createElement("nav");
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Main navigation");

    ITEMS.forEach(function (item) {
      var a = document.createElement("a");
      a.href = item.href;
      a.className = "bottom-nav-item" + (item.id === active ? " is-active" : "");
      if (item.id === active) a.setAttribute("aria-current", "page");
      a.innerHTML = item.icon + "<span>" + item.label + "</span>";
      nav.appendChild(a);
    });

    document.body.classList.add("has-bottom-nav");
    document.body.appendChild(nav);

    initPosterInstallPrompt();
    initTripWatcher();
  });

  var TRIP_KEY = "tp_active_trip";
  var tripTickTimer = null;

  function readTrip() {
    try {
      var raw = window.localStorage.getItem(TRIP_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.target_stop_id || !obj.expires_at_ms) return null;
      if (Date.now() > obj.expires_at_ms) {
        window.localStorage.removeItem(TRIP_KEY);
        return null;
      }
      return obj;
    } catch (e) {
      return null;
    }
  }

  function writeTrip(trip) {
    try {
      window.localStorage.setItem(TRIP_KEY, JSON.stringify(trip));
    } catch (e) {}
  }

  function clearTrip() {
    try {
      window.localStorage.removeItem(TRIP_KEY);
    } catch (e) {}
    var existing = document.getElementById("trip-confirm-banner");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function startTrip(serverTrip) {
    if (!serverTrip || !serverTrip.target_stop_id) return;
    var now = Date.now();
    var estSec = Number(serverTrip.estimated_travel_seconds) || 600;
    var promptSec = Number(serverTrip.prompt_after_seconds) || Math.max(90, Math.floor(estSec * 0.8));
    var expireSec = Math.max(Math.round(estSec * 2.5), 5400);
    var trip = {
      route_id: serverTrip.route_id,
      route_name: serverTrip.route_name || "",
      direction: serverTrip.direction || "forward",
      operator_id: serverTrip.operator_id || null,
      boarded_stop_id: serverTrip.boarded_stop_id,
      boarded_stop_name: serverTrip.boarded_stop_name || "",
      target_stop_id: serverTrip.target_stop_id,
      target_stop_name: serverTrip.target_stop_name || "your stop",
      distance_km: serverTrip.distance_km || null,
      estimated_travel_seconds: estSec,
      boarded_at_ms: now,
      prompt_at_ms: now + promptSec * 1000,
      expires_at_ms: now + expireSec * 1000
    };
    writeTrip(trip);
    renderTripBanner();
  }

  function showTripToast(stopName, newBadges) {
    var old = document.getElementById("thanks-toast");
    if (old) old.remove();
    var unlocked = Array.isArray(newBadges) ? newBadges : [];
    var el = document.createElement("div");
    el.id = "thanks-toast";
    el.className = "thanks-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    var card = document.createElement("div");
    card.className = "thanks-card";

    var check = document.createElement("div");
    check.className = "thanks-check";
    check.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17 L13.5 23 L25 10"/></svg>';

    var title = document.createElement("strong");
    title.textContent = "Arrival confirmed";

    var desc = document.createElement("p");
    desc.textContent = "Thanks for logging " + stopName + ". Live ETAs ahead just got sharper.";

    var small = document.createElement("small");
    small.textContent = "Tap to close";

    card.appendChild(check);
    card.appendChild(title);
    card.appendChild(desc);

    if (unlocked.length) {
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
        var label = document.createElement("span");
        label.textContent = b.name;
        row.appendChild(label);
        box.appendChild(row);
      });
      var link = document.createElement("a");
      link.className = "thanks-badges-link";
      link.href = "profile.html";
      link.textContent = "See my badges";
      box.appendChild(link);
      card.appendChild(box);
    }

    card.appendChild(small);
    el.appendChild(card);
    document.body.appendChild(el);

    var closeTimer = null;
    function hide() {
      window.clearTimeout(closeTimer);
      el.classList.remove("is-visible");
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 260);
    }
    card.addEventListener("click", hide);
    window.requestAnimationFrame(function () { el.classList.add("is-visible"); });
    closeTimer = window.setTimeout(hide, unlocked.length ? 6500 : 3800);
  }

  async function submitTripConfirmation(trip, btnEl, errEl) {
    if (!window.TransitPulseAPI || !window.firebase || !firebase.auth().currentUser) {
      var targetUrl = "stops.html?route_id=" + encodeURIComponent(String(trip.route_id)) +
        "&route_name=" + encodeURIComponent(trip.route_name || "") + "&confirm_trip=1";
      window.location.href = targetUrl;
      return;
    }

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "Confirming...";
    }
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("is-hidden");
    }

    try {
      var res = await window.TransitPulseAPI.reportSighting({
        route_stop_id: trip.target_stop_id,
        direction: trip.direction,
        operator_id: trip.operator_id || null,
        is_trip_confirmation: true
      });
      var stopName = trip.target_stop_name || "your stop";
      if (res && res.active_trip && String(res.active_trip.target_stop_id) !== String(trip.target_stop_id)) {
        startTrip(res.active_trip);
      } else {
        clearTrip();
      }
      showTripToast(stopName, res && res.new_badges);
    } catch (error) {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = "Confirm Arrival";
      }
      if (errEl) {
        errEl.textContent = (error && error.message) ? error.message : "Could not confirm arrival yet. Try again shortly.";
        errEl.classList.remove("is-hidden");
      }
    }
  }

  function renderTripBanner() {
    var trip = readTrip();
    var existing = document.getElementById("trip-confirm-banner");

    if (!trip) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    var posterBanner = document.getElementById("poster-install-banner");
    if (posterBanner && posterBanner.parentNode) {
      posterBanner.parentNode.removeChild(posterBanner);
    }

    var now = Date.now();
    var isPromptDue = now >= trip.prompt_at_ms;
    var minsLeft = Math.max(1, Math.ceil(((trip.boarded_at_ms + trip.estimated_travel_seconds * 1000) - now) / 60000));

    var mode = isPromptDue ? "prompt" : "compact";
    if (existing && existing.dataset.mode === mode && existing.dataset.stopId === String(trip.target_stop_id)) {
      var compactSub = existing.querySelector(".trip-compact-sub");
      if (compactSub) {
        compactSub.textContent = "~" + minsLeft + " min left" + (trip.distance_km ? " · " + trip.distance_km + " km" : "");
      }
      return;
    }

    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var banner = document.createElement("div");
    banner.id = "trip-confirm-banner";
    banner.className = "trip-banner " + (isPromptDue ? "is-prompt" : "is-compact");
    banner.dataset.mode = mode;
    banner.dataset.stopId = String(trip.target_stop_id);
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Active trip confirmation");

    if (!isPromptDue) {
      var row = document.createElement("div");
      row.className = "trip-compact-row";

      var info = document.createElement("div");
      info.className = "trip-compact-info";

      var label = document.createElement("strong");
      label.className = "trip-compact-title";
      label.textContent = "Riding to " + trip.target_stop_name;

      var sub = document.createElement("span");
      sub.className = "trip-compact-sub";
      sub.textContent = "~" + minsLeft + " min left" + (trip.distance_km ? " · " + trip.distance_km + " km" : "");

      info.appendChild(label);
      info.appendChild(sub);

      var actions = document.createElement("div");
      actions.className = "trip-compact-actions";

      var earlyBtn = document.createElement("button");
      earlyBtn.type = "button";
      earlyBtn.className = "trip-early-btn";
      earlyBtn.textContent = "Arrived";

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "trip-close-btn";
      closeBtn.setAttribute("aria-label", "Dismiss trip tracker");
      closeBtn.textContent = "✕";

      var errEl = document.createElement("p");
      errEl.className = "trip-banner-error is-hidden";

      earlyBtn.addEventListener("click", function () {
        submitTripConfirmation(trip, earlyBtn, errEl);
      });
      closeBtn.addEventListener("click", clearTrip);

      actions.appendChild(earlyBtn);
      actions.appendChild(closeBtn);
      row.appendChild(info);
      row.appendChild(actions);
      banner.appendChild(row);
      banner.appendChild(errEl);
    } else {
      var dismissTop = document.createElement("button");
      dismissTop.type = "button";
      dismissTop.className = "pib-close";
      dismissTop.setAttribute("aria-label", "Dismiss");
      dismissTop.textContent = "✕";
      dismissTop.addEventListener("click", clearTrip);

      var tag = document.createElement("span");
      tag.className = "pib-tag";
      tag.textContent = "RIDER CHECK-IN";

      var titleEl = document.createElement("h3");
      titleEl.className = "pib-title";
      titleEl.textContent = "Approaching " + trip.target_stop_name + "?";

      var copyEl = document.createElement("p");
      copyEl.className = "pib-desc";
      copyEl.textContent = "Tap once to confirm arrival, sharpen live ETAs ahead, and earn your Trip Finisher stamp.";

      var errPrompt = document.createElement("p");
      errPrompt.className = "trip-banner-error is-hidden";

      var actionRow = document.createElement("div");
      actionRow.className = "pib-action-row";

      var confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "pib-install-btn";
      confirmBtn.textContent = "Confirm Arrival";
      confirmBtn.addEventListener("click", function () {
        submitTripConfirmation(trip, confirmBtn, errPrompt);
      });

      var snoozeBtn = document.createElement("button");
      snoozeBtn.type = "button";
      snoozeBtn.className = "pib-dismiss-btn";
      snoozeBtn.textContent = "Not yet (+3m)";
      snoozeBtn.addEventListener("click", function () {
        trip.prompt_at_ms = Date.now() + 180000;
        writeTrip(trip);
        renderTripBanner();
      });

      actionRow.appendChild(confirmBtn);
      actionRow.appendChild(snoozeBtn);

      banner.appendChild(dismissTop);
      banner.appendChild(tag);
      banner.appendChild(titleEl);
      banner.appendChild(copyEl);
      banner.appendChild(errPrompt);
      banner.appendChild(actionRow);
    }

    document.body.appendChild(banner);
  }

  function initTripWatcher() {
    renderTripBanner();
    window.clearInterval(tripTickTimer);
    tripTickTimer = window.setInterval(renderTripBanner, 15000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) renderTripBanner();
    });
  }

  window.TransitPulseTrip = {
    start: startTrip,
    clear: clearTrip,
    refresh: renderTripBanner,
    getActive: readTrip,
    confirmNow: function () {
      var trip = readTrip();
      if (!trip) return;
      trip.prompt_at_ms = Date.now() - 1000;
      writeTrip(trip);
      renderTripBanner();
    }
  };
})();
