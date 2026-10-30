(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var userId = TransitPulseStorage.getUserId();
    if (!userId) {
      window.location.href = "register.html";
      return;
    }

    var avatarEl = document.getElementById("profile-avatar");
    var avatarStreakBadge = document.getElementById("avatar-streak-badge");
    var avatarStreakVal = document.getElementById("avatar-streak-val");
    var nameEl = document.getElementById("profile-name");
    var phoneEl = document.getElementById("profile-phone");
    var tierEl = document.getElementById("profile-tier");
    var statSightingsEl = document.getElementById("stat-sightings");
    var statStreakEl = document.getElementById("stat-streak");
    var statJoinedEl = document.getElementById("stat-joined");

    var nextMilestoneSection = document.getElementById("next-milestone-section");
    var nextMilestoneRemaining = document.getElementById("next-milestone-remaining");
    var nextMilestoneEmblem = document.getElementById("next-milestone-emblem");
    var nextMilestoneTitle = document.getElementById("next-milestone-title");
    var nextMilestoneDesc = document.getElementById("next-milestone-desc");
    var nextMilestoneBar = document.getElementById("next-milestone-bar");
    var nextMilestoneProgressText = document.getElementById("next-milestone-progress-text");

    var badgesCounterPill = document.getElementById("badges-counter-pill");
    var badgesGrid = document.getElementById("badges-grid");

    var editNameBtn = document.getElementById("edit-name-btn");
    var nameEditForm = document.getElementById("name-edit-form");
    var newNameInput = document.getElementById("new-name-input");
    var cancelNameBtn = document.getElementById("cancel-name-btn");
    var saveNameBtn = document.getElementById("save-name-btn");

    var activityLoading = document.getElementById("activity-loading");
    var activityEmpty = document.getElementById("activity-empty");
    var activityList = document.getElementById("activity-list");
    var logoutBtn = document.getElementById("logout-btn");

    function getInitials(name) {
      if (!name) return "C";
      var parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function formatRelativeDate(isoStr) {
      if (!isoStr) return "";
      try {
        var normalized = (isoStr.indexOf("Z") === -1 && isoStr.indexOf("+") === -1) ? isoStr + "Z" : isoStr;
        var date = new Date(normalized);
        var now = new Date();
        var diffMs = now - date;
        var diffSec = Math.floor(diffMs / 1000);
        var diffMin = Math.floor(diffSec / 60);
        var diffHrs = Math.floor(diffMin / 60);
        var diffDays = Math.floor(diffHrs / 24);

        if (diffMin < 1) return "Just now";
        if (diffMin < 60) return diffMin + " min ago";
        if (diffHrs < 24) return diffHrs + (diffHrs === 1 ? " hr ago" : " hrs ago");
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7) return diffDays + " days ago";
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } catch (e) {
        return "";
      }
    }

    loadProfile();

    async function loadProfile() {
      try {
        var profile = await TransitPulseAPI.getUserProfile(userId);
        renderProfile(profile);
      } catch (error) {
        console.error("Could not load profile:", error);
        nameEl.textContent = TransitPulseStorage.getUserName() || "Commuter";
        phoneEl.textContent = "Verified user";
        activityLoading.classList.add("is-hidden");
        activityEmpty.classList.remove("is-hidden");
      }
    }

    function renderProfile(data) {
      var displayName = data.name || "Commuter";
      nameEl.textContent = displayName;
      phoneEl.textContent = data.phone || "Verified commuter";
      avatarEl.textContent = getInitials(displayName);
      tierEl.textContent = data.tier || "New Commuter";

      statSightingsEl.textContent = String(data.total_sightings || 0);

      var streak = data.streak_days || 0;
      statStreakEl.textContent = streak + " Day" + (streak === 1 ? "" : "s");
      if (streak > 0 && avatarStreakBadge && avatarStreakVal) {
        avatarStreakVal.textContent = streak + "d";
        avatarStreakBadge.classList.remove("is-hidden");
      } else if (avatarStreakBadge) {
        avatarStreakBadge.classList.add("is-hidden");
      }

      statJoinedEl.textContent = data.created_at || "Recently";

      renderNextMilestone(data.next_milestone);
      renderBadges(data.badges || [], data.earned_badges_count || 0, data.total_badges_count || (data.badges ? data.badges.length : 10));

      activityLoading.classList.add("is-hidden");

      var sightings = data.recent_sightings || [];
      if (sightings.length === 0) {
        activityEmpty.classList.remove("is-hidden");
        activityList.classList.add("is-hidden");
        return;
      }

      activityEmpty.classList.add("is-hidden");
      activityList.classList.remove("is-hidden");
      activityList.innerHTML = "";

      sightings.forEach(function (s) {
        var card = document.createElement("div");
        card.className = "activity-card";

        var main = document.createElement("div");
        main.className = "activity-main";

        var strong = document.createElement("strong");
        strong.textContent = s.stop_name || "Bus Sighting";

        var sub = document.createElement("p");
        sub.className = "activity-sub";
        var dirLabel = s.direction === "return" ? "← To Hapur" : "To Delhi →";
        var ago = formatRelativeDate(s.seen_at);
        sub.textContent = (s.route_name ? s.route_name + " · " : "") + dirLabel + (ago ? " · " + ago : "");

        main.appendChild(strong);
        main.appendChild(sub);

        var badge = document.createElement("span");
        badge.className = "activity-badge";
        badge.textContent = s.crowd_level ? s.crowd_level.toUpperCase() : "SPOTTED";

        card.appendChild(main);
        card.appendChild(badge);
        activityList.appendChild(card);
      });
    }

    function renderNextMilestone(milestone) {
      if (!milestone || !nextMilestoneSection) {
        if (nextMilestoneSection) nextMilestoneSection.classList.add("is-hidden");
        return;
      }

      nextMilestoneSection.classList.remove("is-hidden");
      nextMilestoneRemaining.textContent = milestone.remaining + " sighting" + (milestone.remaining === 1 ? "" : "s") + " to unlock";
      nextMilestoneEmblem.textContent = milestone.emblem || "🏅";
      nextMilestoneTitle.textContent = milestone.name || "Next Milestone";
      nextMilestoneDesc.textContent = milestone.desc || "";
      nextMilestoneBar.style.width = Math.min(100, Math.max(0, milestone.percent || 0)) + "%";
      nextMilestoneProgressText.textContent = milestone.progress + " / " + milestone.target + " sightings (" + milestone.percent + "%)";
    }

    function renderBadges(badges, earnedCount, totalCount) {
      if (!badgesGrid) return;
      if (badgesCounterPill) {
        badgesCounterPill.textContent = earnedCount + " of " + totalCount + " Earned";
      }

      badgesGrid.innerHTML = "";
      badges.forEach(function (badge) {
        var card = document.createElement("div");
        card.className = "badge-card " + (badge.earned ? "is-earned" : "is-locked");

        var topRow = document.createElement("div");
        topRow.className = "badge-top-row";

        var emblem = document.createElement("div");
        emblem.className = "badge-emblem";
        emblem.textContent = badge.emblem || "🏅";

        var info = document.createElement("div");
        info.className = "badge-info";

        var title = document.createElement("div");
        title.className = "badge-title";
        title.textContent = badge.name;

        info.appendChild(title);
        topRow.appendChild(emblem);
        topRow.appendChild(info);

        var desc = document.createElement("div");
        desc.className = "badge-desc";
        desc.textContent = badge.desc;

        var statusWrap = document.createElement("div");
        statusWrap.className = "badge-status-wrap";

        if (badge.earned) {
          var pill = document.createElement("span");
          pill.className = "earned-pill";
          pill.textContent = "✓ Earned " + (badge.earned_date ? badge.earned_date : "");
          statusWrap.appendChild(pill);
        } else {
          var progressWrap = document.createElement("div");
          progressWrap.className = "progress-wrap";

          var track = document.createElement("div");
          track.className = "progress-bar-track";

          var fill = document.createElement("div");
          fill.className = "progress-bar-fill";
          var pct = badge.target ? Math.min(100, Math.round((badge.progress / badge.target) * 100)) : 0;
          fill.style.width = pct + "%";
          track.appendChild(fill);

          var label = document.createElement("div");
          label.className = "progress-label";
          label.innerHTML = "<span>Progress</span><span>" + badge.progress + " / " + badge.target + "</span>";

          progressWrap.appendChild(track);
          progressWrap.appendChild(label);
          statusWrap.appendChild(progressWrap);
        }

        card.appendChild(topRow);
        card.appendChild(desc);
        card.appendChild(statusWrap);
        badgesGrid.appendChild(card);
      });
    }

    editNameBtn.addEventListener("click", function () {
      newNameInput.value = nameEl.textContent.trim();
      nameEditForm.classList.remove("is-hidden");
      newNameInput.focus();
    });

    cancelNameBtn.addEventListener("click", function () {
      nameEditForm.classList.add("is-hidden");
    });

    saveNameBtn.addEventListener("click", async function () {
      var newName = newNameInput.value.trim();
      if (!newName) return;

      saveNameBtn.disabled = true;
      saveNameBtn.textContent = "Saving...";

      try {
        var res = await TransitPulseAPI.updateUserName(userId, newName);
        var updated = (res && res.name) || newName;
        nameEl.textContent = updated;
        avatarEl.textContent = getInitials(updated);
        TransitPulseStorage.saveUser(userId, updated);
        nameEditForm.classList.add("is-hidden");
      } catch (err) {
        console.error("Failed to update name:", err);
      } finally {
        saveNameBtn.disabled = false;
        saveNameBtn.textContent = "Save";
      }
    });

    logoutBtn.addEventListener("click", function () {
      TransitPulseStorage.clearUser();
      localStorage.removeItem("tp_sighting_cooldown_until");
      if (window.firebase) {
        try {
          firebase.auth().signOut();
        } catch (e) {}
      }
      window.location.href = "index.html";
    });
  });
})();
