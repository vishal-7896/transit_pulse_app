import os
from flask import Flask, request, jsonify, g, abort, send_from_directory
from flask_cors import CORS
from sqlalchemy import select, func
from datetime import datetime, timedelta
from dotenv import load_dotenv
from db import get_session
from alchemy_models import Route, RouteStop, Sighting, User, Operator, UserFavorite, Stop
from eta import calculate_eta
from auth_middleware import require_auth
from admin_views import init_admin


app = Flask(__name__)

load_dotenv()
app.secret_key = os.getenv("SECRET_KEY")
if not app.secret_key:
    raise RuntimeError("SECRET_KEY is not set. Add it to your .env file")
CORS(app)

init_admin(app)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
ALLOWED_EXTENSIONS = {'.html', '.js', '.css', '.png', '.jpg', '.jpeg',
                      '.svg', '.ico', '.webmanifest', '.woff2'}


@app.route('/')
def home():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/routes', methods=['GET'])
def get_route():
    with get_session() as session:
        routes = session.scalars(select(Route)).all()
        return jsonify([{
            "id": r.id,
            "name": r.name,
            "start_terminus": r.start_terminus,
            "stop_terminus": r.stop_terminus
        } for r in routes])


@app.route('/routes/<int:route_id>/stops', methods=['GET'])
def get_stops(route_id):
    with get_session() as session:
        stmt = (
            select(RouteStop)
            .where(RouteStop.route_id == route_id)
            .order_by(RouteStop.stop_order)
        )
        route_stops = session.scalars(stmt).all()
        return jsonify([{
            "route_stop_id": rs.id,
            "stop_order": rs.stop_order,
            "name": rs.stop.name,
            "landmark": rs.stop.landmark,
            "avg_travel_seconds": rs.avg_travel_seconds
        } for rs in route_stops])


@app.route('/routes/<int:route_id>/operators', methods=['GET'])
def get_route_operators(route_id):
    with get_session() as session:
        stmt = (
            select(
                Operator.short_code,
                Operator.name,
                Operator.type,
                func.count(Sighting.id).label("count")
            )
            .join(Sighting, Sighting.operator_id == Operator.id)
            .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
            .where(RouteStop.route_id == route_id)
            .group_by(Operator.id)
            .order_by(func.count(Sighting.id).desc())
        )
        rows = session.execute(stmt).all()

        total = sum(r.count for r in rows)
        if total == 0:
            return jsonify({"route_id": route_id, "operators": [], "total_sightings": 0})

        return jsonify({
            "route_id": route_id,
            "total_sightings": total,
            "operators": [{
                "short_code": r.short_code,
                "name": r.name,
                "type": r.type,
                "count": r.count,
                "percentage": round((r.count / total) * 100, 1)
            } for r in rows]
        })


@app.route('/operators', methods=['GET'])
def get_operators():
    with get_session() as session:
        operators = session.scalars(select(Operator)).all()
        return jsonify([{
            "id": op.id,
            "name": op.name,
            "short_code": op.short_code,
            "type": op.type
        } for op in operators])


def update_adaptive_travel_time(session, current_rs, sighting, alpha=0.2):
    try:
        if sighting.direction == 'return':
            prev_order = current_rs.stop_order + 1
        else:
            prev_order = current_rs.stop_order - 1

        if prev_order < 1:
            return

        stmt = (
            select(Sighting)
            .join(RouteStop)
            .where(
                RouteStop.route_id == current_rs.route_id,
                RouteStop.stop_order == prev_order,
                Sighting.direction == sighting.direction,
                Sighting.seen_at > datetime.utcnow() - timedelta(minutes=45)
            )
        )
        if sighting.operator_id:
            stmt = stmt.where(Sighting.operator_id == sighting.operator_id)

        prev_sighting = session.scalars(stmt.order_by(Sighting.seen_at.desc())).first()

        if not prev_sighting:
            return

        delta_seconds = (datetime.utcnow() - prev_sighting.seen_at).total_seconds()

        if 60 <= delta_seconds <= 2700:
            segment_order = max(current_rs.stop_order, prev_order)
            target_rs = current_rs if current_rs.stop_order == segment_order else session.scalars(
                select(RouteStop).where(
                    RouteStop.route_id == current_rs.route_id,
                    RouteStop.stop_order == segment_order
                )
            ).first()

            if target_rs:
                old_avg = target_rs.avg_travel_seconds or delta_seconds
                new_avg = round((1 - alpha) * old_avg + alpha * delta_seconds)
                target_rs.avg_travel_seconds = int(new_avg)
    except Exception as e:
        print(f"Adaptive travel update notice: {e}")


@app.route('/sighting', methods=['POST'])
@require_auth
def post_sighting():
    data = request.get_json()
    route_stop_id = data.get('route_stop_id')
    direction = data.get('direction', 'forward')
    crowd_level = data.get('crowd_level')
    operator_id = data.get('operator_id')
    user_id = g.current_user['id']

    if not route_stop_id or not user_id:
        return jsonify({"error": "require all fields"}), 400

    with get_session() as session:
        current_rs = session.get(RouteStop, route_stop_id)
        if not current_rs:
            return jsonify({"error": "stop not found"}), 404

        three_min_ago = datetime.utcnow() - timedelta(minutes=3)
        stmt = (
            select(Sighting)
            .join(RouteStop)
            .where(
                Sighting.user_id == user_id,
                RouteStop.route_id == current_rs.route_id,
                Sighting.seen_at > three_min_ago
            )
        )
        recent = session.scalars(stmt).first()

        if recent:
            return jsonify({"error": "too many requests"}), 429

        sighting = Sighting(
            user_id=user_id,
            route_stop_id=route_stop_id,
            direction=direction,
            crowd_level=crowd_level,
            operator_id=operator_id
        )
        session.add(sighting)

        update_adaptive_travel_time(session, current_rs, sighting)

        session.commit()
        return jsonify({"status": "ok"})


@app.route('/eta/<int:route_stop_id>', methods=['GET'])
def get_eta(route_stop_id):
    direction = request.args.get('direction', 'forward')
    return calculate_eta(route_stop_id, direction)


def mask_user_phone(phone):
    if not phone:
        return "Verified Commuter"
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) >= 10:
        last4 = digits[-4:]
        prefix = f"+{digits[:-10]} " if len(digits) > 10 else "+91 "
        return f"{prefix}••••• •{last4}"
    if len(phone) > 4:
        return f"••••••{phone[-4:]}"
    return phone


@app.route('/user/<int:user_id>/profile', methods=['GET'])
def get_user_profile(user_id):
    with get_session() as session:
        user = session.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        user_sightings_stmt = select(Sighting).where(Sighting.user_id == user_id).order_by(Sighting.seen_at.asc())
        user_sightings = session.scalars(user_sightings_stmt).all()
        total_sightings = len(user_sightings)

        total_favorites = session.scalar(
            select(func.count(UserFavorite.id)).where(UserFavorite.user_id == user_id)
        ) or 0

        user_dates = sorted(list({s.seen_at.date() for s in user_sightings if s.seen_at}))
        streak_days = 0
        if user_dates:
            today = datetime.now().date()
            yesterday = today - timedelta(days=1)
            if user_dates[-1] in (today, yesterday):
                curr = user_dates[-1]
                streak_days = 1
                for i in range(len(user_dates) - 2, -1, -1):
                    if user_dates[i] == curr - timedelta(days=1):
                        streak_days += 1
                        curr = user_dates[i]
                    else:
                        break

        recent_stmt = (
            select(Sighting, Stop.name, Route.name)
            .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
            .join(Stop, RouteStop.stop_id == Stop.id)
            .join(Route, RouteStop.route_id == Route.id)
            .where(Sighting.user_id == user_id)
            .order_by(Sighting.seen_at.desc())
            .limit(10)
        )
        recent_rows = session.execute(recent_stmt).all()

        recent_sightings = []
        for s, stop_name, route_name in recent_rows:
            recent_sightings.append({
                "id": s.id,
                "stop_name": stop_name,
                "route_name": route_name,
                "direction": s.direction,
                "crowd_level": s.crowd_level,
                "seen_at": (s.seen_at.isoformat() + "Z") if s.seen_at else None
            })

        tier = "New Commuter"
        if total_sightings >= 50:
            tier = "👑 Transit Legend"
        elif total_sightings >= 25:
            tier = "🥇 Route Guardian"
        elif total_sightings >= 10:
            tier = "🥈 Silver Scout"
        elif total_sightings >= 1:
            tier = "🥉 Bronze Tracker"

        distinct_stop_count = len({s.route_stop_id for s in user_sightings if s.route_stop_id})
        directions_seen = {s.direction for s in user_sightings if s.direction}
        early_sightings = [s for s in user_sightings if s.seen_at and 5 <= s.seen_at.hour < 9]
        night_sightings = [s for s in user_sightings if s.seen_at and s.seen_at.hour >= 20]
        crowd_sightings = [s for s in user_sightings if s.crowd_level]

        badges = [
            {
                "id": "first_spotter",
                "name": "First Spotter",
                "desc": "Logged your first verified bus sighting",
                "emblem": "🎯",
                "earned": total_sightings >= 1,
                "earned_date": user_sightings[0].seen_at.strftime("%d %b %Y") if total_sightings >= 1 and user_sightings[0].seen_at else None,
                "progress": min(total_sightings, 1),
                "target": 1
            },
            {
                "id": "early_bird",
                "name": "Early Bird",
                "desc": "Reported a bus during morning rush (5-9 AM)",
                "emblem": "🌅",
                "earned": len(early_sightings) > 0,
                "earned_date": early_sightings[0].seen_at.strftime("%d %b %Y") if early_sightings and early_sightings[0].seen_at else None,
                "progress": min(len(early_sightings), 1),
                "target": 1
            },
            {
                "id": "night_owl",
                "name": "Night Owl",
                "desc": "Tracked a late-night bus after 8:00 PM",
                "emblem": "🌙",
                "earned": len(night_sightings) > 0,
                "earned_date": night_sightings[0].seen_at.strftime("%d %b %Y") if night_sightings and night_sightings[0].seen_at else None,
                "progress": min(len(night_sightings), 1),
                "target": 1
            },
            {
                "id": "shortcut_master",
                "name": "Shortcut Master",
                "desc": "Starred 2 or more frequent bus stops",
                "emblem": "⭐",
                "earned": total_favorites >= 2,
                "earned_date": "Active" if total_favorites >= 2 else None,
                "progress": min(total_favorites, 2),
                "target": 2
            },
            {
                "id": "round_tripper",
                "name": "Round Tripper",
                "desc": "Spotted buses in both forward and return directions",
                "emblem": "🔄",
                "earned": ("forward" in directions_seen and "return" in directions_seen),
                "earned_date": "Completed" if ("forward" in directions_seen and "return" in directions_seen) else None,
                "progress": 2 if ("forward" in directions_seen and "return" in directions_seen) else (1 if len(directions_seen) > 0 else 0),
                "target": 2
            },
            {
                "id": "highway_scout",
                "name": "Highway Scout",
                "desc": "Reported buses across 3 distinct stops",
                "emblem": "🧭",
                "earned": distinct_stop_count >= 3,
                "earned_date": "Active" if distinct_stop_count >= 3 else None,
                "progress": min(distinct_stop_count, 3),
                "target": 3
            },
            {
                "id": "crowd_reporter",
                "name": "Crowd Reporter",
                "desc": "Shared bus occupancy with the community",
                "emblem": "👥",
                "earned": len(crowd_sightings) > 0,
                "earned_date": crowd_sightings[0].seen_at.strftime("%d %b %Y") if crowd_sightings and crowd_sightings[0].seen_at else None,
                "progress": min(len(crowd_sightings), 1),
                "target": 1
            },
            {
                "id": "regular_rider",
                "name": "Regular Rider",
                "desc": "Reach 10 total verified bus reports",
                "emblem": "🏅",
                "earned": total_sightings >= 10,
                "earned_date": user_sightings[9].seen_at.strftime("%d %b %Y") if total_sightings >= 10 and user_sightings[9].seen_at else None,
                "progress": min(total_sightings, 10),
                "target": 10
            },
            {
                "id": "route_guardian",
                "name": "Route Guardian",
                "desc": "Reach 25 total verified bus reports",
                "emblem": "🛡️",
                "earned": total_sightings >= 25,
                "earned_date": user_sightings[24].seen_at.strftime("%d %b %Y") if total_sightings >= 25 and user_sightings[24].seen_at else None,
                "progress": min(total_sightings, 25),
                "target": 25
            },
            {
                "id": "transit_legend",
                "name": "Transit Legend",
                "desc": "Reach 50 total verified bus reports",
                "emblem": "👑",
                "earned": total_sightings >= 50,
                "earned_date": user_sightings[49].seen_at.strftime("%d %b %Y") if total_sightings >= 50 and user_sightings[49].seen_at else None,
                "progress": min(total_sightings, 50),
                "target": 50
            }
        ]

        milestone_candidates = [b for b in badges if b["id"] in ("regular_rider", "route_guardian", "transit_legend") and not b["earned"]]
        next_milestone = None
        if milestone_candidates:
            target_badge = milestone_candidates[0]
            remaining = max(0, target_badge["target"] - target_badge["progress"])
            percent = int((target_badge["progress"] / target_badge["target"]) * 100) if target_badge["target"] else 0
            next_milestone = {
                "id": target_badge["id"],
                "name": target_badge["name"],
                "desc": target_badge["desc"],
                "emblem": target_badge["emblem"],
                "target": target_badge["target"],
                "progress": target_badge["progress"],
                "remaining": remaining,
                "percent": percent
            }

        earned_count = sum(1 for b in badges if b["earned"])

        return jsonify({
            "id": user.id,
            "name": user.name or "Commuter",
            "phone": mask_user_phone(user.phone),
            "raw_phone": user.phone or "",
            "created_at": user.created_at.strftime("%b %Y") if user.created_at else "Recently",
            "total_sightings": total_sightings,
            "streak_days": streak_days,
            "tier": tier,
            "badges": badges,
            "earned_badges_count": earned_count,
            "total_badges_count": len(badges),
            "next_milestone": next_milestone,
            "recent_sightings": recent_sightings
        })


@app.route('/user/<int:user_id>/update-name', methods=['POST'])
def update_user_name(user_id):
    data = request.get_json() or {}
    new_name = (data.get('name') or '').strip()
    if not new_name:
        return jsonify({"error": "Name is required"}), 400

    with get_session() as session:
        user = session.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        user.name = new_name
        session.commit()
        return jsonify({"status": "ok", "name": user.name})


@app.route('/favorites', methods=['GET'])
def get_favorites():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])

    with get_session() as session:
        stmt = (
            select(RouteStop, Route, Stop)
            .join(UserFavorite, UserFavorite.route_stop_id == RouteStop.id)
            .join(Route, RouteStop.route_id == Route.id)
            .join(Stop, RouteStop.stop_id == Stop.id)
            .where(UserFavorite.user_id == int(user_id))
            .order_by(UserFavorite.created_at.desc())
        )
        rows = session.execute(stmt).all()
        return jsonify([{
            "route_stop_id": rs.id,
            "route_id": r.id,
            "route_name": r.name,
            "name": s.name,
            "landmark": s.landmark
        } for rs, r, s in rows])


@app.route('/favorites/toggle', methods=['POST'])
def toggle_favorite():
    data = request.get_json() or {}
    user_id = data.get('user_id')
    route_stop_id = data.get('route_stop_id')

    if not user_id or not route_stop_id:
        return jsonify({"error": "user_id and route_stop_id are required"}), 400

    with get_session() as session:
        stmt = select(UserFavorite).where(
            UserFavorite.user_id == int(user_id),
            UserFavorite.route_stop_id == int(route_stop_id)
        )
        existing = session.scalars(stmt).first()

        if existing:
            session.delete(existing)
            session.commit()
            return jsonify({"status": "ok", "starred": False})
        else:
            fav = UserFavorite(user_id=int(user_id), route_stop_id=int(route_stop_id))
            session.add(fav)
            session.commit()
            return jsonify({"status": "ok", "starred": True})


@app.route('/register', methods=['POST'])
@require_auth
def register_user():
    data = request.get_json() or {}
    user_name = data.get('name')

    with get_session() as session:
        user = session.get(User, g.current_user['id'])
        if not user:
            return jsonify({"error": "user not found"}), 404

        if user_name:
            user.name = user_name
            session.commit()

        return jsonify({
            "status": "ok",
            "user_id":user.id,
            "user": {
                "id": user.id,
                "phone": user.phone,
                "name": user.name
            }
        })


@app.route('/<path:filename>')
def serve_static(filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        abort(404)
    return send_from_directory(FRONTEND_DIR, filename)


if __name__ == '__main__':
    app.run(debug=True)
