import datetime
from sqlalchemy import select, func
from db import get_session
from alchemy_models import RouteStop, Sighting, Route


def calculate_eta(route_stop_id, direction='forward'):
    with get_session() as session:
        this_stop = session.get(RouteStop, route_stop_id)

        if this_stop is None:
            return {"status": "error", "message": "stop not found"}, 404

        route_id = this_stop.route_id
        user_stop_order = this_stop.stop_order

        if direction == 'return':
            order_filter = RouteStop.stop_order >= user_stop_order
        else:
            order_filter = RouteStop.stop_order <= user_stop_order

        stmt = (
            select(RouteStop.stop_order, Sighting.seen_at)
            .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
            .where(
                RouteStop.route_id == route_id,
                Sighting.direction == direction,
                order_filter
            )
            .order_by(Sighting.seen_at.desc())
            .limit(1)
        )
        last = session.execute(stmt).first()

        if last is None:
            return {"status": "no data"}

        sighting_stop_order = last.stop_order
        seen_at = last.seen_at

        if isinstance(seen_at, str):
            seen_at_formatted = datetime.datetime.fromisoformat(seen_at)
        else:
            seen_at_formatted = seen_at

        curr_time = datetime.datetime.utcnow()
        age = curr_time - seen_at_formatted

        if age > datetime.timedelta(minutes=30):
            return {"status": "stale", "seen at": str(seen_at_formatted)}

        if direction == 'return':
            order_range = (
                RouteStop.stop_order <= sighting_stop_order,
                RouteStop.stop_order > user_stop_order,
                )
        else:
            order_range = (
                RouteStop.stop_order > sighting_stop_order,
                RouteStop.stop_order <= user_stop_order,
            )

        sum_stmt = (
            select(func.coalesce(func.sum(RouteStop.avg_travel_seconds), 0))
            .where(
                RouteStop.route_id == route_id,
                *order_range
            )
        )
        remaining = session.scalar(sum_stmt)

        elapsed = age.total_seconds()
        eta_seconds = remaining - elapsed
        eta = max(0, eta_seconds)

        if eta == 0 and remaining < elapsed:
            route = session.get(Route, route_id)
            freq_min = route.frequency_minutes
            return {
                "status": "passed",
                "message": "Bus may just have passed",
                "next bus approx mins": freq_min
            }
        else:
            return {
                "status": "live",
                "eta seconds": eta_seconds,
                "eta minutes": round(eta_seconds / 60)
            }
