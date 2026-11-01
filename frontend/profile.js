(function () {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function $(id) { return document.getElementById(id); }

  // Everything user-supplied goes in via textContent, never innerHTML.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function formatWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return diffMin + " min ago";
    var hours = Math.round(diffMin / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hours / 24);
    if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
    return formatDate(iso);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var loading = $("profile-loading");
    var content = $("profile-content");
    var errorBox = $("profile-error");
    var retryBtn = $("retry-profile-btn");
    var signOutBtn = $("signout-btn");

    if (!TransitPulseStorage.getUserId()) {
      window.location.href = "register.html";
      return;
    }

    signOutBtn.addEventListener("click", function () {
      TransitPulseStorage.clearUser();
      var done = function () { window.location.href = "register.html"; };
      if (window.firebase && firebase.auth) {
        firebase.auth().signOut().then(done, done);
      } else {
        done();
      }
    });

    retryBtn.addEventListener("click", function () {
      // If the sign-in library never loaded, only a page reload can recover.
      if (window.firebase && firebase.auth) load(); else window.location.reload();
    });

    // Firebase restores the session asynchronously after a page load, and its script
    // can arrive late on a slow network. Wait for it (up to ~10s) before calling the API,
    // otherwise the request would go out without a login token.
    function whenFirebaseReady(callback) {
      var waited = 0;
      (function check() {
        if (window.firebase && firebase.auth) { callback(true); return; }
        waited += 250;
        if (waited >= 10000) { callback(false); return; }
        window.setTimeout(check, 250);
      })();
    }

    whenFirebaseReady(function (ok) {
      if (!ok) {
        loading.classList.add("is-hidden");
        TransitPulseUI.showMessage(errorBox, "Slow network: the sign-in service didn't load. Check your connection and try again.", "error");
        retryBtn.classList.remove("is-hidden");
        return;
      }
      var authSettled = false;
      firebase.auth().onAuthStateChanged(function (user) {
        if (authSettled) return;
        authSettled = true;
        if (!user) {
          TransitPulseStorage.clearUser();
          window.location.href = "register.html";
          return;
        }
        load();
      });
    });

    async function load() {
      TransitPulseUI.clearMessage(errorBox);
      retryBtn.classList.add("is-hidden");
      loading.classList.remove("is-hidden");
      try {
        var data = await TransitPulseAPI.getProfile();
        if (!data || !data.user || !data.stats || !Array.isArray(data.badges)) {
          throw new Error("The server returned an invalid profile.");
        }
        render(data);
        loading.classList.add("is-hidden");
        content.classList.remove("is-hidden");
      } catch (error) {
        console.error("Could not load profile:", error);
        loading.classList.add("is-hidden");
        if (error && error.status === 401) {
          TransitPulseStorage.clearUser();
          window.location.href = "register.html";
          return;
        }
        TransitPulseUI.showMessage(errorBox, error && error.message ? error.message : "Could not load your profile.", "error");
        retryBtn.classList.remove("is-hidden");
      }
    }

    function render(data) {
      renderHero(data);
      renderStats(data);
      renderNextBadge(data);
      renderBadges(data);
      renderRecent(data.recent || []);
    }

    function pad(n) { var s = String(n); while (s.length < 6) s = "0" + s; return s; }

    function renderHero(data) {
      var name = data.user.name || "Commuter";
      $("profile-name").textContent = name;
      $("profile-avatar").textContent = name.trim().charAt(0).toUpperCase() || "C";

      var level = $("profile-level");
      level.textContent = data.stats.level || "";
      level.classList.toggle("is-new", !data.stats.total_sightings);

      var since = [];
      since.push("Commuter no. " + pad(data.user.id));
      if (data.user.member_since) since.push("Riding since " + formatMonth(data.user.member_since));
      $("profile-since").textContent = since.join("\n");

      renderLastSighting((data.recent || [])[0]);

      TransitPulseStorage.saveUser(data.user.id, name);
      wireNameEditor(name);
    }

    function formatMonth(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return MONTHS[d.getMonth()] + " " + d.getFullYear();
    }

    function formatShort(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.getDate() + " " + MONTHS[d.getMonth()];
    }

    function busIcon() {
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = '<rect x="3" y="3" width="18" height="15" rx="3"/><line x1="3" y1="11" x2="21" y2="11"/><circle cx="7.5" cy="15" r="1"/><circle cx="16.5" cy="15" r="1"/><line x1="6" y1="18" x2="6" y2="21"/><line x1="18" y1="18" x2="18" y2="21"/>';
      return svg;
    }

    function renderLastSighting(last) {
      var box = $("hero-last");
      box.innerHTML = "";
      box.classList.toggle("is-empty", !last);
      if (!last) {
        var wrap = el("div");
        wrap.appendChild(el("strong", null, "No reports yet"));
        wrap.appendChild(el("small", null, "Spot a bus at your stop and tap \u201cI see the bus\u201d."));
        var cta = el("a", "hero-last-cta", "Share your first sighting");
        cta.href = "routes.html";
        wrap.appendChild(cta);
        box.appendChild(wrap);
        return;
      }
      var text = el("div");
      text.appendChild(el("strong", null, "Last report: " + (last.stop_name || "Stop")));
      var parts = [];
      if (last.route_name) parts.push(last.route_name);
      parts.push(formatWhen(last.seen_at));
      text.appendChild(el("small", null, parts.join(", ")));
      box.appendChild(busIcon());
      box.appendChild(text);
    }

    var nameEditorWired = false;
    function wireNameEditor(currentName) {
      var row = $("profile-name-row");
      var form = $("name-form");
      var input = $("name-input");
      var status = { name: currentName };
      input.value = currentName;
      if (nameEditorWired) return;
      nameEditorWired = true;

      function openEditor() {
        row.classList.add("is-hidden");
        form.classList.remove("is-hidden");
        input.value = $("profile-name").textContent;
        input.focus();
        input.select();
      }
      function closeEditor() {
        form.classList.add("is-hidden");
        row.classList.remove("is-hidden");
      }

      $("edit-name-btn").addEventListener("click", openEditor);
      $("cancel-name-btn").addEventListener("click", closeEditor);

      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var newName = input.value.trim();
        if (!newName || newName === status.name) { closeEditor(); return; }

        var saveBtn = form.querySelector(".profile-save-btn");
        saveBtn.disabled = true;
        try {
          var res = await TransitPulseAPI.register({ name: newName });
          var saved = (res && res.user && res.user.name) || newName;
          status.name = saved;
          $("profile-name").textContent = saved;
          $("profile-avatar").textContent = saved.trim().charAt(0).toUpperCase() || "C";
          TransitPulseStorage.saveUser(TransitPulseStorage.getUserId(), saved);
          closeEditor();
        } catch (error) {
          TransitPulseUI.showMessage(errorBox, error && error.message ? error.message : "Could not save your name.", "error");
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    function renderStats(data) {
      $("stat-total").textContent = data.stats.total_sightings;
      $("stat-streak").textContent = data.stats.current_streak;
      var b = $("stat-badges");
      b.textContent = data.badges_earned;
      b.appendChild(el("small", null, "/" + data.badges.length));
    }

    // One punched hole per step towards the next badge (capped at 25 holes).
    function buildHoles(progress, target, mini) {
      var n = Math.min(target, 25);
      var on = Math.round((progress / target) * n);
      var cols = n <= 5 ? n : 5;
      var grid = el("div", "holes");
      grid.setAttribute("aria-hidden", "true");
      var size = mini ? 15 : (n <= 3 ? 52 : 23);
      grid.style.gridTemplateColumns = "repeat(" + cols + ", " + size + "px)";
      for (var i = 0; i < n; i++) {
        var h = el("span", "hole " + (i < on ? "on" : "off"));
        h.style.width = size + "px";
        h.style.height = size + "px";
        grid.appendChild(h);
      }
      return grid;
    }

    function renderNextBadge(data) {
      var box = $("next-badge");
      box.innerHTML = "";
      var next = null;
      data.badges.forEach(function (b) { if (b.id === data.next_badge_id) next = b; });
      if (!next) {
        box.classList.add("is-hidden");
        return;
      }
      box.classList.remove("is-hidden");

      var head = el("div", "route-heading-row");
      head.appendChild(el("h2", null, "Next: " + next.name));
      box.appendChild(head);

      var card = el("div", "punch");
      card.appendChild(buildHoles(next.progress, next.target, false));
      var text = el("div", "punch-text");
      var big = el("b", null, String(next.progress));
      big.appendChild(el("i", null, " / " + next.target));
      text.appendChild(big);
      var left = next.target - next.progress;
      text.appendChild(el("p", "punch-left", left + " more to go"));
      text.appendChild(el("p", "punch-desc", next.description));
      card.appendChild(text);
      box.appendChild(card);
    }

    function renderBadges(data) {
      var grid = $("badge-grid");
      grid.innerHTML = "";
      $("badge-count").textContent = data.badges_earned + " of " + data.badges.length + " collected";

      // Earned first (newest first), then locked in their natural order.
      var earned = data.badges.filter(function (b) { return b.earned; }).sort(function (a, b) {
        return (b.earned_at || "").localeCompare(a.earned_at || "");
      });
      var locked = data.badges.filter(function (b) { return !b.earned; });

      earned.concat(locked).forEach(function (b, i) {
        var tile = el("button", "badge-tile" + (b.earned ? " is-earned" : " is-locked"));
        tile.type = "button";
        tile.setAttribute("aria-label", b.name + (b.earned ? ", earned. Show details" : ", locked, " + b.progress + " of " + b.target + ". Show details"));

        tile.appendChild(TransitPulseBadgeArt.stamp(b.id, b.earned, TransitPulseBadgeArt.tilt(i)));
        tile.appendChild(el("strong", null, b.name));
        tile.appendChild(el("small", null, b.earned ? (b.earned_at ? formatShort(b.earned_at) : "Earned") : b.progress + " of " + b.target));

        tile.addEventListener("click", function () { openBadgeSheet(b); });
        grid.appendChild(tile);
      });
    }

    // ---- badge detail slip ----
    var sheetOpener = null;
    function openBadgeSheet(b) {
      var sheet = $("badge-sheet");
      var card = $("badge-sheet-card");
      card.innerHTML = "";

      card.appendChild(el("div", "pass-slot"));
      card.appendChild(TransitPulseBadgeArt.stamp(b.id, b.earned, b.earned ? -4 : 0));
      var title = el("h3", null, b.name);
      title.id = "badge-sheet-title";
      card.appendChild(title);
      card.appendChild(el("p", "sheet-desc", b.description));

      if (b.earned) {
        card.appendChild(el("p", "sheet-status", b.earned_at ? "Earned on " + formatDate(b.earned_at) : "Earned"));
      } else {
        if (b.target <= 12) {
          var minis = buildHoles(b.progress, b.target, true);
          minis.className = "sheet-minis";
          minis.style.display = "flex";
          minis.style.gridTemplateColumns = "";
          card.appendChild(minis);
        }
        var left = b.target - b.progress;
        card.appendChild(el("p", "sheet-status", b.progress + " of " + b.target + ", " + left + " more to go"));
      }

      var close = el("button", "sheet-close", "Close");
      close.type = "button";
      close.addEventListener("click", closeBadgeSheet);
      card.appendChild(close);

      sheetOpener = document.activeElement;
      sheet.classList.remove("is-hidden");
      window.requestAnimationFrame(function () { sheet.classList.add("is-open"); });
      close.focus();
    }

    function closeBadgeSheet() {
      var sheet = $("badge-sheet");
      if (sheet.classList.contains("is-hidden")) return;
      sheet.classList.remove("is-open");
      window.setTimeout(function () { sheet.classList.add("is-hidden"); }, 200);
      if (sheetOpener && sheetOpener.focus) sheetOpener.focus();
    }

    $("badge-sheet").addEventListener("click", function (e) {
      if (e.target === $("badge-sheet")) closeBadgeSheet();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeBadgeSheet();
    });

    var RECENT_VISIBLE = 5;

    function renderRecent(items) {
      var list = $("recent-list");
      var toggle = $("recent-toggle");
      list.innerHTML = "";
      $("recent-empty").classList.toggle("is-hidden", items.length > 0);
      list.classList.toggle("is-hidden", items.length === 0);

      var expanded = false;
      function applyVisibility() {
        Array.prototype.forEach.call(list.children, function (row, i) {
          row.classList.toggle("is-hidden", !expanded && i >= RECENT_VISIBLE);
        });
        toggle.textContent = expanded ? "Show less" : "Show all " + items.length;
        toggle.setAttribute("aria-expanded", String(expanded));
      }
      toggle.classList.toggle("is-hidden", items.length <= RECENT_VISIBLE);
      toggle.onclick = function () { expanded = !expanded; applyVisibility(); };

      items.forEach(function (s) {
        var row = el("div", "recent-item");
        row.appendChild(el("span", "recent-node " + (s.crowd_level ? "crowd-" + s.crowd_level : "crowd-none")));

        var main = el("div", "recent-main");
        main.appendChild(el("strong", null, s.stop_name || "Stop"));
        var sub = el("small");
        var parts = [];
        if (s.route_name) parts.push(s.route_name);
        if (s.operator) parts.push(s.operator);
        sub.appendChild(document.createTextNode(parts.join(", ")));
        if (s.crowd_level) {
          if (parts.length) sub.appendChild(document.createElement("br"));
          sub.appendChild(el("span", "crowd-text-" + s.crowd_level, s.crowd_level.charAt(0).toUpperCase() + s.crowd_level.slice(1)));
        }
        main.appendChild(sub);

        row.appendChild(main);
        row.appendChild(el("span", "recent-when", formatWhen(s.seen_at)));
        list.appendChild(row);
      });
      applyVisibility();
    }
  });
})();
