"""Badge + stats engine for TransitPulse profiles.

Badges are *derived* from a user's sightings, so no extra table or migration is
needed and the server stays the single source of truth (clients can't fake them).
Trade-off: if an admin deletes sightings, the matching badges go away too.

`sighting.seen_at` is stored as naive UTC. Everything that depends on the clock
(streak days, Early Bird, Night Owl) is evaluated in Indian Standard Time, so a
sighting at 11 PM IST counts as 11 PM, not as 5:30 PM.
"""
from datetime import datetime, timedelta

from sqlalchemy import select

from alchemy_models import Sighting, RouteStop, Route, Stop, Operator

IST_OFFSET = timedelta(hours=5, minutes=30)

# Morning rush 5-9 AM; "night" is 8 PM until 4 AM (all IST).
EARLY_START, EARLY_END = 5, 9
NIGHT_START, NIGHT_END = 20, 4

# metric -> what is counted for it (see _scan)
#   total        sightings submitted
#   with_crowd   sightings that included a crowd level
#   stops        distinct stops sighted at
#   directions   distinct directions sighted (forward / return)
#   best_streak  longest run of consecutive IST days with a sighting
#   early        sightings during the morning rush
#   night        sightings at night
BADGES = [
    {"id": "first_spotter",  "name": "First Spotter",   "icon": "👀", "tier": "bronze",
     "metric": "total", "target": 1,
     "description": "Share your first bus sighting."},
    {"id": "regular_rider",  "name": "Regular Rider",   "icon": "🚌", "tier": "bronze",
     "metric": "total", "target": 10,
     "description": "Share 10 sightings."},
    {"id": "route_guardian", "name": "Route Guardian",  "icon": "🛡️", "tier": "silver",
     "metric": "total", "target": 25,
     "description": "Share 25 sightings."},
    {"id": "pulse_hero",     "name": "Pulse Hero",      "icon": "⚡", "tier": "gold",
     "metric": "total", "target": 50,
     "description": "Share 50 sightings."},
    {"id": "transit_legend", "name": "Transit Legend",  "icon": "🏆", "tier": "gold",
     "metric": "total", "target": 100,
     "description": "Share 100 sightings."},
    {"id": "streak_3",       "name": "3-Day Streak",    "icon": "🔥", "tier": "silver",
     "metric": "best_streak", "target": 3,
     "description": "Share sightings on 3 days in a row."},
    {"id": "streak_7",       "name": "Week Warrior",    "icon": "📅", "tier": "gold",
     "metric": "best_streak", "target": 7,
     "description": "Share sightings on 7 days in a row."},
    {"id": "early_bird",     "name": "Early Bird",      "icon": "🌅", "tier": "special",
     "metric": "early", "target": 1,
     "description": "Share a sighting in the morning rush (5–9 AM)."},
    {"id": "night_owl",      "name": "Night Owl",       "icon": "🦉", "tier": "special",
     "metric": "night", "target": 1,
     "description": "Share a sighting after 8 PM."},
    {"id": "crowd_reporter", "name": "Crowd Reporter",  "icon": "👥", "tier": "silver",
     "metric": "with_crowd", "target": 10,
     "description": "Report the crowd level on 10 sightings."},
    {"id": "highway_scout",  "name": "Highway Scout",   "icon": "🧭", "tier": "silver",
     "metric": "stops", "target": 3,
     "description": "Share sightings at 3 different stops."},
    {"id": "round_tripper",  "name": "Round Tripper",   "icon": "🔄", "tier": "special",
     "metric": "directions", "target": 2,
     "description": "Spot buses heading both ways."},
]

# Rank shown under the user's name, by total sightings (highest match wins).
LEVELS = [
    (0, "New Commuter"),
    (1, "Spotter"),
    (10, "Regular Rider"),
    (25, "Route Guardian"),
    (50, "Pulse Hero"),
    (100, "Transit Legend"),
]


def _to_ist(utc_dt):
    return utc_dt + IST_OFFSET


def _in_window(hour, start, end):
    """True if `hour` is in [start, end), where the window may wrap past midnight."""
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def _level_for(total):
    title = LEVELS[0][1]
    for threshold, name in LEVELS:
        if total >= threshold:
            title = name
    return title


def _scan(rows):
    """Walk sightings oldest -> newest, tracking each metric as it grows.

    `rows` are (seen_at_utc, crowd_level, route_stop_id, direction).
    Returns (final_metrics, timeline) where timeline[metric] is a list of
    (value, seen_at) recorded every time the metric increased. That lets us say
    *when* a badge was earned, not just whether it was.
    """
    metrics = {"total": 0, "with_crowd": 0, "stops": 0, "directions": 0,
               "best_streak": 0, "early": 0, "night": 0}
    timeline = {m: [] for m in metrics}

    def bump(metric, value, when):
        if value > metrics[metric]:
            metrics[metric] = value
            timeline[metric].append((value, when))

    stop_ids = set()
    directions = set()
    last_day = None
    streak = 0

    for seen_at, crowd_level, route_stop_id, direction in rows:
        bump("total", metrics["total"] + 1, seen_at)
        if crowd_level:
            bump("with_crowd", metrics["with_crowd"] + 1, seen_at)

        stop_ids.add(route_stop_id)
        bump("stops", len(stop_ids), seen_at)

        if direction in ("forward", "return"):
            directions.add(direction)
            bump("directions", len(directions), seen_at)

        local = _to_ist(seen_at)
        if _in_window(local.hour, EARLY_START, EARLY_END):
            bump("early", metrics["early"] + 1, seen_at)
        if _in_window(local.hour, NIGHT_START, NIGHT_END):
            bump("night", metrics["night"] + 1, seen_at)

        day = local.date()
        if day != last_day:
            if last_day is not None and day == last_day + timedelta(days=1):
                streak += 1
            else:
                streak = 1
            last_day = day
            bump("best_streak", streak, seen_at)

    return metrics, timeline


def _current_streak(days, today):
    """Consecutive-day run ending today (or yesterday, so it doesn't reset at midnight)."""
    if today in days:
        cursor = today
    elif today - timedelta(days=1) in days:
        cursor = today - timedelta(days=1)
    else:
        return 0
    run = 0
    while cursor in days:
        run += 1
        cursor -= timedelta(days=1)
    return run


def evaluate(session, user_id):
    """Return (stats, badges) for one user. `badges` keeps the BADGES order."""
    stmt = (
        select(Sighting.seen_at, Sighting.crowd_level,
               Sighting.route_stop_id, Sighting.direction)
        .where(Sighting.user_id == user_id)
        .order_by(Sighting.seen_at, Sighting.id)
    )
    rows = [tuple(r) for r in session.execute(stmt).all()]

    metrics, timeline = _scan(rows)

    now = datetime.utcnow()
    today = _to_ist(now).date()
    days = {_to_ist(r[0]).date() for r in rows}
    week_ago = now - timedelta(days=7)

    stats = {
        "total_sightings": metrics["total"],
        "this_week": sum(1 for r in rows if r[0] > week_ago),
        "current_streak": _current_streak(days, today),
        "best_streak": metrics["best_streak"],
        "stops_covered": metrics["stops"],
        "level": _level_for(metrics["total"]),
    }

    badges = []
    for b in BADGES:
        value = metrics[b["metric"]]
        earned = value >= b["target"]
        earned_at = None
        if earned:
            for v, when in timeline[b["metric"]]:
                if v >= b["target"]:
                    earned_at = when
                    break
        badges.append({
            "id": b["id"],
            "name": b["name"],
            "description": b["description"],
            "icon": b["icon"],
            "tier": b["tier"],
            "earned": earned,
            "earned_at": (earned_at.isoformat() + "Z") if earned_at else None,
            "progress": min(value, b["target"]),
            "target": b["target"],
        })

    return stats, badges


def earned_ids(badges):
    return {b["id"] for b in badges if b["earned"]}


def next_badge(badges):
    """The locked badge the user is closest to (highest progress fraction)."""
    locked = [b for b in badges if not b["earned"]]
    if not locked:
        return None
    return max(locked, key=lambda b: b["progress"] / b["target"])


def recent_sightings(session, user_id, limit=10):
    stmt = (
        select(Sighting.seen_at, Sighting.direction, Sighting.crowd_level,
               Route.name, Stop.name, Operator.short_code)
        .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
        .join(Route, RouteStop.route_id == Route.id)
        .join(Stop, RouteStop.stop_id == Stop.id)
        .outerjoin(Operator, Sighting.operator_id == Operator.id)
        .where(Sighting.user_id == user_id)
        .order_by(Sighting.seen_at.desc(), Sighting.id.desc())
        .limit(limit)
    )
    return [{
        "seen_at": seen_at.isoformat() + "Z",
        "direction": direction,
        "crowd_level": crowd_level,
        "route_name": route_name,
        "stop_name": stop_name,
        "operator": operator,
    } for seen_at, direction, crowd_level, route_name, stop_name, operator
        in session.execute(stmt).all()]
