import datetime
from sqlalchemy import select
from db import get_session
from alchemy_models import RouteStop, Stop, Sighting, Route


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

        travel_times = {rs.stop_order: (rs.avg_travel_seconds or 0) for rs in route_stops}

        if direction == 'return':
            order_filter = RouteStop.stop_order >= user_stop_order
        else:
            order_filter = RouteStop.stop_order <= user_stop_order

        stmt = (
            select(RouteStop.stop_order, Stop.name, Sighting.seen_at)
            .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
            .join(Stop, RouteStop.stop_id == Stop.id)
            .where(
                RouteStop.route_id == route_id,
                Sighting.direction == direction,
                order_filter
            )
            .order_by(Sighting.seen_at.desc())
        )
        sightings = session.execute(stmt).all()

        if not sightings:
            return {"status": "no data"}

        curr_time = datetime.datetime.utcnow()
        approaching_buses = []
        passed_buses = []
        has_fresh_sighting = False

        for sighting_stop_order, stop_name, seen_at in sightings:
            if isinstance(seen_at, str):
                seen_at_formatted = datetime.datetime.fromisoformat(seen_at)
            else:
                seen_at_formatted = seen_at

            age = curr_time - seen_at_formatted
            if age > datetime.timedelta(minutes=30):
                continue

            has_fresh_sighting = True
            elapsed = age.total_seconds()

            min_order = min(sighting_stop_order, user_stop_order)
            max_order = max(sighting_stop_order, user_stop_order)
            remaining_seconds = sum(travel_times.get(k, 0) for k in range(min_order + 1, max_order + 1))

            eta_seconds = remaining_seconds - elapsed

            if eta_seconds > 0:
                approaching_buses.append({
                    "eta_seconds": int(eta_seconds),
                    "eta_minutes": max(1, round(eta_seconds / 60)),
                    "spotted_at": stop_name
                })
            else:
                passed_buses.append(eta_seconds)

        if not has_fresh_sighting:
            first_seen_at = sightings[0].seen_at
            return {"status": "stale", "seen at": str(first_seen_at)}

        if approaching_buses:
            approaching_buses.sort(key=lambda b: b["eta_seconds"])
            earliest = approaching_buses[0]

            response = {
                "status": "live",
                "eta seconds": earliest["eta_seconds"],
                "eta minutes": earliest["eta_minutes"],
                "spotted at": earliest["spotted_at"]
            }

            if len(approaching_buses) > 1:
                subsequent = approaching_buses[1]
                response["subsequent bus"] = {
                    "eta minutes": subsequent["eta_minutes"],
                    "spotted at": subsequent["spotted_at"]
                }

            return response

        if passed_buses:
            route = session.get(Route, route_id)
            freq_min = route.frequency_minutes if route and route.frequency_minutes else 30
            return {
                "status": "passed",
                "message": "Bus may just have passed",
                "next bus approx mins": freq_min
            }

        return {"status": "no data"}
