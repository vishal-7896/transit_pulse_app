import datetime
from sqlalchemy import select
from db import get_session
from alchemy_models import RouteStop, Stop, Sighting, Route


def get_corridor_slots():
    slots = []
    for t in range(6 * 60, 10 * 60 + 1, 15):
        slots.append(t)
    for t in range(10 * 60 + 30, 12 * 60 + 1, 30):
        slots.append(t)
    for t in range(12 * 60 + 35, 14 * 60 + 1, 35):
        slots.append(t)
    for t in range(14 * 60 + 30, 18 * 60 + 1, 30):
        slots.append(t)
    for t in range(18 * 60 + 40, 20 * 60 + 1, 40):
        slots.append(t)
    return sorted(list(set(slots)))


def format_clock_12h(total_minutes):
    total_minutes = total_minutes % (24 * 60)
    h = total_minutes // 60
    m = total_minutes % 60
    period = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {period}"


def get_departure_slots_info(now_ist):
    total_mins = now_ist.hour * 60 + now_ist.minute
    slots = get_corridor_slots()

    if total_mins > 20 * 60 or total_mins < 6 * 60:
        is_before_morning = total_mins < 6 * 60
        mins_to_morning = (6 * 60 - total_mins) if is_before_morning else (24 * 60 - total_mins + 6 * 60)
        return {
            "current_slot_time": "6:00 AM" if is_before_morning else "NO BUS",
            "current_slot_minutes": mins_to_morning if is_before_morning else 0,
            "upcoming_slots": [],
            "previous_slot_time": "8:00 PM",
            "is_closed": True,
            "message": f"First bus departs at 6:00 AM · in ~{mins_to_morning} min" if is_before_morning else "Last bus departs by 8:00 PM"
        }

    upcoming = [s for s in slots if s >= total_mins]
    if not upcoming:
        return {
            "current_slot_time": "NO BUS",
            "current_slot_minutes": 0,
            "upcoming_slots": [],
            "previous_slot_time": "8:00 PM",
            "is_closed": True,
            "message": "Last bus departs by 8:00 PM"
        }

    current_slot = upcoming[0]
    next_slots = upcoming[1:3]
    prev_slots = [s for s in slots if s < total_mins]
    prev_slot = prev_slots[-1] if prev_slots else None

    return {
        "current_slot_time": format_clock_12h(current_slot),
        "current_slot_minutes": max(0, current_slot - total_mins),
        "upcoming_slots": [format_clock_12h(s) for s in next_slots],
        "previous_slot_time": format_clock_12h(prev_slot) if prev_slot is not None else None,
        "is_closed": False
    }


def match_departure_to_slot(seen_dt_ist):
    seen_mins = seen_dt_ist.hour * 60 + seen_dt_ist.minute
    slots = get_corridor_slots()
    closest = min(slots, key=lambda s: abs(s - seen_mins))
    diff = seen_mins - closest
    slot_str = format_clock_12h(closest)
    seen_str = format_clock_12h(seen_mins)

    if diff == 0:
        offset_text = "on time"
        short_offset = "on time"
    elif diff > 0:
        offset_text = f"+{diff}m late"
        short_offset = f"+{diff}m"
    else:
        offset_text = f"{abs(diff)}m early"
        short_offset = f"{diff}m"

    return {
        "scheduled_slot": slot_str,
        "actual_time": seen_str,
        "offset_minutes": diff,
        "offset_text": offset_text,
        "short_offset": short_offset,
        "summary": f"{slot_str} bus departed at {seen_str} ({short_offset})"
    }


def get_headway_schedule(is_origin=False, now_ist=None):
    if now_ist is None:
        now_ist = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
    hour = now_ist.hour + now_ist.minute / 60.0

    if 6.0 <= hour < 10.0:
        headway = 15 if is_origin else 22
        tier = "Morning peak"
        desc = "Frequent departures every ~15 min" if is_origin else "Corridor headway ~22 min"
    elif 10.0 <= hour < 12.0:
        headway = 30
        tier = "Midday"
        desc = "Regular departures every ~30 min"
    elif 12.0 <= hour < 14.0:
        headway = 35 if is_origin else 40
        tier = "Afternoon slump"
        desc = "Departures every 35-40 min" if is_origin else "Corridor headway 35-40 min"
    elif 14.0 <= hour < 18.0:
        headway = 25 if is_origin else 30
        tier = "Evening corridor"
        desc = "Regular departures every ~30 min"
    elif 18.0 <= hour <= 20.0:
        headway = 35 if is_origin else 40
        tier = "Late evening"
        desc = "Final departures until 8:00 PM (last bus leaves 8:00 PM)"
    else:
        headway = 0
        tier = "Service Closed"
        desc = "Service ended for today (regular service runs 6:00 AM - 8:00 PM)"

    return {
        "headway_minutes": headway,
        "headway_seconds": headway * 60,
        "tier": tier,
        "description": desc,
        "is_night": hour > 20.0 or hour < 6.0
    }


def calculate_eta(route_stop_id, direction='forward'):
    with get_session() as session:
        this_stop = session.get(RouteStop, route_stop_id)

        if this_stop is None:
            return {"status": "error", "message": "stop not found"}, 404

        route_id = this_stop.route_id
        user_stop_order = this_stop.stop_order

        route_stops = session.scalars(
            select(RouteStop)
            .where(RouteStop.route_id == route_id)
            .order_by(RouteStop.stop_order)
        ).all()

        if not route_stops:
            return {"status": "error", "message": "no route stops found"}, 404

        first_order = route_stops[0].stop_order
        last_order = route_stops[-1].stop_order

        stop_name = this_stop.stop.name if this_stop.stop else ""
        stop_name_lower = stop_name.lower()

        if direction == 'return':
            is_origin = (user_stop_order == last_order) or ('delhi' in stop_name_lower or 'anand vihar' in stop_name_lower or 'kaushambi' in stop_name_lower)
            is_terminus = (user_stop_order == first_order) or ('hapur' in stop_name_lower)
        else:
            is_origin = (user_stop_order == first_order) or ('hapur' in stop_name_lower)
            is_terminus = (user_stop_order == last_order) or ('delhi' in stop_name_lower or 'anand vihar' in stop_name_lower or 'kaushambi' in stop_name_lower)

        now_ist = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
        sched = get_headway_schedule(is_origin=is_origin, now_ist=now_ist)
        headway_min = sched["headway_minutes"]
        headway_sec = sched["headway_seconds"]
        slots_info = get_departure_slots_info(now_ist)

        travel_times = {rs.stop_order: (rs.avg_travel_seconds or 0) for rs in route_stops}

        def is_beyond(order):
            return order < user_stop_order if direction == 'return' else order > user_stop_order

        stmt = (
            select(RouteStop.stop_order, Stop.name, Sighting.seen_at, Sighting.user_id, RouteStop.id)
            .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
            .join(Stop, RouteStop.stop_id == Stop.id)
            .where(
                RouteStop.route_id == route_id,
                Sighting.direction == direction
            )
            .order_by(Sighting.seen_at.desc())
        )
        sightings = session.execute(stmt).all()

        curr_time = datetime.datetime.utcnow()
        approaching_buses = []
        passed_sightings = []
        origin_sightings = []
        fresh_sightings_count = 0
        freshest_seen_at = None
        seen_users = set()

        for sighting_stop_order, s_stop_name, seen_at, user_id, s_rs_id in sightings:
            if isinstance(seen_at, str):
                seen_at_formatted = datetime.datetime.fromisoformat(seen_at)
            else:
                seen_at_formatted = seen_at

            age = curr_time - seen_at_formatted
            if age > datetime.timedelta(minutes=45):
                continue

            if user_id and user_id in seen_users:
                continue
            if user_id:
                seen_users.add(user_id)

            if freshest_seen_at is None:
                freshest_seen_at = seen_at_formatted

            fresh_sightings_count += 1
            elapsed = age.total_seconds()

            if is_origin:
                if s_rs_id == route_stop_id or sighting_stop_order == user_stop_order:
                    origin_sightings.append((elapsed, s_stop_name, seen_at_formatted))
                else:
                    passed_sightings.append(elapsed)
                continue

            if is_beyond(sighting_stop_order) or sighting_stop_order == user_stop_order:
                passed_sightings.append((elapsed, seen_at_formatted))
                continue

            min_order = min(sighting_stop_order, user_stop_order)
            max_order = max(sighting_stop_order, user_stop_order)
            remaining_seconds = sum(travel_times.get(k, 0) for k in range(min_order + 1, max_order + 1))
            eta_seconds = remaining_seconds - elapsed

            if eta_seconds > 0:
                approaching_buses.append({
                    "eta_seconds": int(eta_seconds),
                    "eta_minutes": max(1, round(eta_seconds / 60)),
                    "spotted_at": s_stop_name,
                    "seen_ago_seconds": int(elapsed),
                    "seen_ago_minutes": max(0, round(elapsed / 60))
                })
            else:
                passed_sightings.append((elapsed, seen_at_formatted))

        seen_ago_seconds = int((curr_time - freshest_seen_at).total_seconds()) if freshest_seen_at else 0
        seen_ago_minutes = max(0, round(seen_ago_seconds / 60))

        upcoming_str = ("Upcoming: " + " · ".join(slots_info["upcoming_slots"])) if (slots_info and slots_info.get("upcoming_slots")) else ""
        origin_name_label = "Hapur" if direction == 'forward' else "Delhi"
        latest_evening_dep_time = None
        latest_evening_dep_offset = None
        origin_target_order = first_order if direction == 'forward' else last_order
        for s_order, s_name, s_seen_at, _, _ in sightings:
            if s_order == origin_target_order:
                dt = datetime.datetime.fromisoformat(s_seen_at) if isinstance(s_seen_at, str) else s_seen_at
                ist = dt + datetime.timedelta(hours=5, minutes=30)
                if ist.date() == now_ist.date() and ist.hour >= 17:
                    dep_m = match_departure_to_slot(ist)
                    latest_evening_dep_time = dep_m['actual_time']
                    latest_evening_dep_offset = dep_m['short_offset']
                    break

        if is_origin:
            night_dep_msg = f"Last bus departed at {latest_evening_dep_time} ({latest_evening_dep_offset})" if latest_evening_dep_time else "Last bus from depot departs by 8:00 PM"
        elif is_terminus:
            night_dep_msg = "Last bus arrived · Service ended for today" if latest_evening_dep_time else "Last bus terminates here by ~9:30 PM"
        else:
            night_dep_msg = f"Last bus passed · Departed {origin_name_label} at {latest_evening_dep_time}" if latest_evening_dep_time else f"Last bus from {origin_name_label} departs by 8:00 PM"

        if is_origin:
            if origin_sightings:
                latest_origin_elapsed, origin_name, origin_seen_dt = origin_sightings[0]
                origin_seen_ist = origin_seen_dt + datetime.timedelta(hours=5, minutes=30)
                dep_match = match_departure_to_slot(origin_seen_ist)
                remaining = headway_sec - latest_origin_elapsed
                elapsed_min = max(0, round(latest_origin_elapsed / 60))

                if slots_info.get("is_closed"):
                    return {
                        "status": "closed",
                        "eta seconds": 0,
                        "eta minutes": 0,
                        "clock_time": "NO BUS",
                        "upcoming_text": "",
                        "spotted at": origin_name,
                        "is_departure": True,
                        "is_closed": True,
                        "reports_count": fresh_sightings_count,
                        "seen_ago_minutes": elapsed_min,
                        "seen_ago_seconds": int(latest_origin_elapsed),
                        "headway_minutes": 0,
                        "tier": sched["tier"],
                        "departure_match": dep_match,
                        "message": f"Last bus departed at {dep_match['actual_time']} ({dep_match['short_offset']})"
                    }

                if remaining > 60:
                    rem_sec = int(remaining)
                    rem_min = max(1, round(remaining / 60))
                    msg = f"{dep_match['summary']} · Next in ~{rem_min} min"
                else:
                    rem_sec = 60
                    rem_min = 1
                    msg = f"{dep_match['summary']} · Next bus due to depart now"

                return {
                    "status": "live",
                    "eta seconds": rem_sec,
                    "eta minutes": rem_min,
                    "clock_time": slots_info["current_slot_time"],
                    "upcoming_text": upcoming_str,
                    "spotted at": origin_name,
                    "is_departure": True,
                    "reports_count": fresh_sightings_count,
                    "seen_ago_minutes": elapsed_min,
                    "seen_ago_seconds": int(latest_origin_elapsed),
                    "headway_minutes": headway_min,
                    "tier": sched["tier"],
                    "departure_match": dep_match,
                    "message": msg
                }

            cur_mins = slots_info["current_slot_minutes"]
            if slots_info.get("is_closed"):
                return {
                    "status": "closed",
                    "eta minutes": 0,
                    "clock_time": "NO BUS",
                    "upcoming_text": "",
                    "headway_minutes": 0,
                    "is_departure": True,
                    "is_closed": True,
                    "reports_count": 0,
                    "tier": sched["tier"],
                    "message": night_dep_msg
                }

            dep_msg = f"Scheduled slot · Departs in ~{cur_mins} min" if cur_mins > 0 else "Scheduled slot · Departing now"

            return {
                "status": "scheduled",
                "eta minutes": cur_mins if cur_mins > 0 else headway_min,
                "clock_time": slots_info["current_slot_time"],
                "upcoming_text": upcoming_str,
                "headway_minutes": headway_min,
                "is_departure": True,
                "reports_count": 0,
                "tier": sched["tier"],
                "message": dep_msg
            }

        if approaching_buses:
            approaching_buses.sort(key=lambda b: b["eta_seconds"])
            earliest = approaching_buses[0]

            response = {
                "status": "live",
                "eta seconds": earliest["eta_seconds"],
                "eta minutes": earliest["eta_minutes"],
                "spotted at": earliest["spotted_at"],
                "reports_count": fresh_sightings_count,
                "seen_ago_minutes": earliest["seen_ago_minutes"],
                "seen_ago_seconds": earliest["seen_ago_seconds"],
                "headway_minutes": headway_min,
                "tier": sched["tier"]
            }

            if len(approaching_buses) > 1:
                subsequent = approaching_buses[1]
                response["subsequent bus"] = {
                    "eta minutes": subsequent["eta_minutes"],
                    "spotted at": subsequent["spotted_at"]
                }

            return response

        if passed_sightings:
            min_elapsed, passed_seen_dt = min(passed_sightings, key=lambda x: x[0])
            passed_mins = max(0, round(min_elapsed / 60))

            if sched["is_night"]:
                return {
                    "status": "closed",
                    "clock_time": "NO BUS",
                    "eta minutes": 0,
                    "headway_minutes": 0,
                    "is_closed": True,
                    "reports_count": fresh_sightings_count,
                    "seen_ago_minutes": passed_mins,
                    "seen_ago_seconds": int(min_elapsed),
                    "tier": sched["tier"],
                    "message": f"Last bus passed {passed_mins}m ago" if passed_mins <= 30 else night_dep_msg
                }

            rem_sec = headway_sec - min_elapsed
            if rem_sec > 60:
                next_mins = max(1, round(rem_sec / 60))
                msg = f"Bus passed {passed_mins}m ago · Next bus expected in ~{next_mins} min"
            else:
                next_mins = 1
                msg = f"Bus passed {passed_mins}m ago · Next bus due now"

            return {
                "status": "passed",
                "eta minutes": next_mins,
                "next bus approx mins": next_mins,
                "headway_minutes": headway_min,
                "reports_count": fresh_sightings_count,
                "seen_ago_minutes": passed_mins,
                "seen_ago_seconds": int(min_elapsed),
                "tier": sched["tier"],
                "message": msg
            }

        if sched["is_night"]:
            return {
                "status": "closed",
                "clock_time": "NO BUS",
                "eta minutes": 0,
                "headway_minutes": 0,
                "is_closed": True,
                "reports_count": 0,
                "tier": sched["tier"],
                "message": night_dep_msg
            }

        return {
            "status": "scheduled",
            "eta minutes": headway_min,
            "headway_minutes": headway_min,
            "reports_count": 0,
            "tier": sched["tier"],
            "message": f"About {headway_min} min (usual timing)"
        }
