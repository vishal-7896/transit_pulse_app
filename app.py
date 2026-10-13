import os
from flask import Flask, request, jsonify, g,abort,send_from_directory
from flask_cors import CORS
from sqlalchemy import select, func
from datetime import datetime, timedelta
from dotenv import load_dotenv
from db import get_session
from alchemy_models import Route, RouteStop, Sighting, User, Operator
from eta import calculate_eta
from auth_middleware import require_auth


app = Flask(__name__)

load_dotenv()
app.secret_key = os.getenv("SECRET_KEY")
if not app.secret_key:
    raise RuntimeError("SECRET_KEY is not set. Add it to your .env file")
CORS(app)

from admin_views import init_admin
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

        three_min_ago = datetime.now() - timedelta(minutes=3)
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
        session.commit()
        return jsonify({"status": "ok"})


@app.route('/eta/<int:route_stop_id>', methods=['GET'])
def get_eta(route_stop_id):
    direction = request.args.get('direction', 'forward')
    return calculate_eta(route_stop_id, direction)


@app.route('/register', methods=['POST'])
@require_auth
def register_user():
    data = request.get_json() or {}
    user_name = data.get('name')

    with get_session() as session:
        user = session.get(User, g.current_user['id'])
        if user_name:
            user.name = user_name
            session.commit()

    return jsonify({
        "status": "ok",
        "user_id": g.current_user['id'],
        "name": g.current_user.get('name', user_name)
    })

@app.route('/<path:filename>')
def serve_frontend_files(filename):
    ext = os.path.splitext(filename)[1].lower()
    # allowlist only, and block anything starting with a dot (.env, .git, etc.)
    if ext not in ALLOWED_EXTENSIONS or any(part.startswith('.') for part in filename.split('/')):
        abort(404)
    return send_from_directory(FRONTEND_DIR, filename)

if __name__ == '__main__':
    app.run(debug=True)