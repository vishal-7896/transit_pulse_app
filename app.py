import os
from flask import Flask, request, jsonify, g, abort, send_from_directory
from flask_cors import CORS
from sqlalchemy import select, func
from datetime import datetime, timedelta
from dotenv import load_dotenv
from db import get_session
from alchemy_models import Route, RouteStop, Sighting, User, Operator, UserFavorite
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
