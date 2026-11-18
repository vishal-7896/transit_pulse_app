from datetime import datetime, timedelta
from sqlalchemy import select
from alchemy_models import Sighting, RouteStop, Route, Stop, Operator

IST_OFFSET = timedelta(hours=5, minutes=30)
EARLY_START, EARLY_END = 5, 9
NIGHT_START, NIGHT_END = 20, 4

BADGES = [
    {"id": "first_spotter",  "name": "First Spotter",   "icon": "first_spotter", "tier": "bronze",
     "metric": "total", "target": 1,
     "description": "Share your first bus sighting."},
    {"id": "regular_rider",  "name": "Regular Rider",   "icon": "regular_rider", "tier": "bronze",
     "metric": "total", "target": 10,
     "description": "Share 10 sightings."},
    {"id": "route_guardian", "name": "Route Guardian",  "icon": "route_guardian", "tier": "silver",
     "metric": "total", "target": 25,
     "description": "Share 25 sightings."},
    {"id": "pulse_hero",     "name": "Pulse Hero",      "icon": "pulse_hero", "tier": "gold",
     "metric": "total", "target": 50,
     "description": "Share 50 sightings."},
    {"id": "transit_legend", "name": "Transit Legend",  "icon": "transit_legend", "tier": "gold",
     "metric": "total", "target": 100,
     "description": "Share 100 sightings."},
    {"id": "streak_3",       "name": "3-Day Streak",    "icon": "streak_3", "tier": "silver",
     "metric": "best_streak", "target": 3,
     "description": "Share sightings on 3 days in a row."},
    {"id": "streak_7",       "name": "Week Warrior",    "icon": "streak_7", "tier": "gold",
     "metric": "best_streak", "target": 7,
     "description": "Share sightings on 7 days in a row."},
    {"id": "early_bird",     "name": "Early Bird",      "icon": "early_bird", "tier": "special",
     "metric": "early", "target": 1,
     "description": "Share a sighting in the morning rush (5 to 9 AM)."},
    {"id": "night_owl",      "name": "Night Owl",       "icon": "night_owl", "tier": "special",
     "metric": "night", "target": 1,
     "description": "Share a sighting after 8 PM."},
    {"id": "crowd_reporter", "name": "Crowd Reporter",  "icon": "crowd_reporter", "tier": "silver",
     "metric": "with_crowd", "target": 10,
     "description": "Report the crowd level on 10 sightings."},
    {"id": "highway_scout",  "name": "Highway Scout",   "icon": "highway_scout", "tier": "silver",
     "metric": "stops", "target": 3,
     "description": "Share sightings at 3 different stops."},
    {"id": "round_tripper",  "name": "Round Tripper",   "icon": "round_tripper", "tier": "special",
     "metric": "directions", "target": 2,
     "description": "Spot buses heading both ways."},
    {"id": "trip_finisher",  "name": "Trip Finisher",   "icon": "trip_finisher", "tier": "special",
     "metric": "trip_confirmations", "target": 1,
     "description": "Confirm arrival at a starred stop during a ride."},
]

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
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end

def _level_for(total):
    title = LEVELS[0][1]
    for threshold, name in LEVELS:
        if total >= threshold:
            title = name
    return title

def _filter_plausible(rows):
    plausible = []
    last_seen = None
    last_stop = None
    for seen_at, crowd_level, route_stop_id, direction, is_trip_conf in rows:
        local = _to_ist(seen_at)
        if 1 <= local.hour < 4:
            continue
        if last_seen is not None and last_stop == route_stop_id:
            if (seen_at - last_seen).total_seconds() < 180:
                continue
        last_seen = seen_at
        last_stop = route_stop_id
        plausible.append((seen_at, crowd_level, route_stop_id, direction, bool(is_trip_conf)))
    return plausible

def _scan(rows):
    metrics = {"total": 0, "with_crowd": 0, "stops": 0, "directions": 0,
               "best_streak": 0, "early": 0, "night": 0, "trip_confirmations": 0}
    timeline = {m: [] for m in metrics}

    def bump(metric, value, when):
        if value > metrics[metric]:
            metrics[metric] = value
            timeline[metric].append((value, when))

    stop_ids = set()
    directions = set()
    last_day = None
    streak = 0

    for seen_at, crowd_level, route_stop_id, direction, is_trip_conf in rows:
        bump("total", metrics["total"] + 1, seen_at)
        if crowd_level:
            bump("with_crowd", metrics["with_crowd"] + 1, seen_at)
        if is_trip_conf:
            bump("trip_confirmations", metrics["trip_confirmations"] + 1, seen_at)

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
    stmt = (
        select(Sighting.seen_at, Sighting.crowd_level,
               Sighting.route_stop_id, Sighting.direction, Sighting.is_trip_confirmation)
        .where(Sighting.user_id == user_id)
        .order_by(Sighting.seen_at, Sighting.id)
    )
    raw_rows = [tuple(r) for r in session.execute(stmt).all()]
    rows = _filter_plausible(raw_rows)

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
        "trip_confirmations": metrics["trip_confirmations"],
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
    results = []
    for seen_at, direction, crowd_level, route_name, stop_name, operator in session.execute(stmt).all():
        local = _to_ist(seen_at)
        if 1 <= local.hour < 4:
            continue
        results.append({
            "seen_at": seen_at.isoformat() + "Z",
            "direction": direction,
            "crowd_level": crowd_level,
            "route_name": route_name,
            "stop_name": stop_name,
            "operator": operator,
        })
    return results
