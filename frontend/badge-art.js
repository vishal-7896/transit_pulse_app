// badge-art.js: draws each badge as a rubber stamp (SVG). Shared by the profile page and the
// "badge unlocked" popup. Everything here is static markup built from our own constants;
// no user text is ever put into it.
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  // 24px stroke glyphs
  var GLYPHS = {
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    bus: '<rect x="3" y="3" width="18" height="15" rx="3"/><line x1="3" y1="11" x2="21" y2="11"/><circle cx="7.5" cy="15" r="1"/><circle cx="16.5" cy="15" r="1"/><line x1="6" y1="18" x2="6" y2="21"/><line x1="18" y1="18" x2="18" y2="21"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.2 13.9 7 23 12 20 17 23 15.8 13.9"/>',
    flame: '<path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    sunrise: '<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.2" y1="10.2" x2="5.6" y2="11.6"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.4" y1="11.6" x2="19.8" y2="10.2"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9 16.2 7.8"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    award2: '<circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9"/>'
  };

  // badge id -> [glyph, stamp shape]. Shapes: single ring, double ring, rounded square, solid disc.
  var BY_ID = {
    first_spotter:  ["eye", "single"],
    regular_rider:  ["bus", "single"],
    route_guardian: ["shield", "dbl"],
    pulse_hero:     ["bolt", "disc"],
    transit_legend: ["award", "disc"],
    streak_3:       ["flame", "dbl"],
    streak_7:       ["cal", "disc"],
    early_bird:     ["sunrise", "sq"],
    night_owl:      ["moon", "sq"],
    crowd_reporter: ["users", "dbl"],
    highway_scout:  ["compass", "dbl"],
    round_tripper:  ["repeat", "sq"]
  };

  var PAPER = "#e6dfcc";

  function build(id, earned, rotate) {
    var def = BY_ID[id] || ["award2", "single"];
    var glyph = GLYPHS[def[0]];
    var shape = def[1];
    var dash = earned ? "" : ' stroke-dasharray="3.5 4"';
    function g(color) {
      return '<svg x="19" y="19" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="' + color +
        '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + glyph + "</svg>";
    }
    var body = "";
    if (shape === "single") {
      body = '<circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-width="2.4"' + dash + "/>" + g("currentColor");
    } else if (shape === "dbl") {
      body = '<circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2.4"' + dash + "/>" +
        '<circle cx="32" cy="32" r="23.5" fill="none" stroke="currentColor" stroke-width="1.2"' + dash + "/>" + g("currentColor");
    } else if (shape === "sq") {
      body = '<rect x="4" y="4" width="56" height="56" rx="14" fill="none" stroke="currentColor" stroke-width="2.4"' + dash + "/>" +
        '<rect x="9" y="9" width="46" height="46" rx="10" fill="none" stroke="currentColor" stroke-width="1.2"' + dash + "/>" + g("currentColor");
    } else { // disc
      body = earned
        ? '<circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="32" cy="32" r="23" fill="currentColor"/>' + g(PAPER)
        : '<circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="3.5 4"/>' +
          '<circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3.5 4"/>' + g("currentColor");
    }
    return body;
  }

  // Returns an <svg> element. `earned` stamps are inked (and slightly rotated, like a real stamp).
  function stamp(id, earned, rotate) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "stampsvg" + (earned ? " earned-stamp" : ""));
    svg.setAttribute("viewBox", "0 0 64 64");
    svg.setAttribute("aria-hidden", "true");
    if (earned && rotate) svg.style.transform = "rotate(" + rotate + "deg)";
    svg.innerHTML = build(id, Boolean(earned), rotate);
    return svg;
  }

  // Small fixed set of tilts so a sheet of stamps looks hand-pressed but stays stable between renders.
  var TILTS = [-5, 4, -3, 6, -6, 3, -4, 5, -2, 3, -5, 4];
  function tilt(index) { return TILTS[index % TILTS.length]; }

  window.TransitPulseBadgeArt = { stamp: stamp, tilt: tilt };
})();
