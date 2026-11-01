import os
try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None
from flask import Flask, request, jsonify, g, abort, send_from_directory
from flask_cors import CORS
from sqlalchemy import select, func
from datetime import datetime, timedelta
from dotenv import load_dotenv
from db import get_session
from alchemy_models import Route, RouteStop, Sighting, User, Operator, UserFavorite, Stop, PredictionLog, Feedback
import badges
from eta import calculate_eta
from auth_middleware import require_auth
from admin_views import init_admin


load_dotenv()

sentry_dsn = os.getenv("SENTRY_DSN", "https://5900da1832d4c247e5f044781ce4d36b@o4512355430432768.ingest.us.sentry.io/4512355513794560")
if sentry_dsn and sentry_sdk:
    sentry_sdk.init(
        dsn=sentry_dsn,
        traces_sample_rate=0.1
    )

app = Flask(__name__)
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

        ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
        if 1 <= ist_now.hour < 4:
            return jsonify({"error": "Sightings are paused between 1:00 AM and 4:00 AM IST."}), 400

        
        try:
            _, badges_before = badges.evaluate(session, user_id)
            earned_before = badges.earned_ids(badges_before)
        except Exception as e:
            print(f"Badge check (before) notice: {e}")
            earned_before = None

        sighting = Sighting(
            user_id=user_id,
            route_stop_id=route_stop_id,
            direction=direction,
            crowd_level=crowd_level,
            operator_id=operator_id
        )
        session.add(sighting)

        update_adaptive_travel_time(session, current_rs, sighting)

        try:
            window_start = datetime.utcnow() - timedelta(minutes=60)
            pending_logs = session.scalars(
                select(PredictionLog).where(
                    PredictionLog.route_stop_id == route_stop_id,
                    PredictionLog.direction == direction,
                    PredictionLog.actual_arrival_at.is_(None),
                    PredictionLog.predicted_at >= window_start
                )
            ).all()
            for pl in pending_logs:
                pl.actual_arrival_at = sighting.seen_at or datetime.utcnow()
                actual_diff = (pl.actual_arrival_at - pl.predicted_at).total_seconds() / 60.0
                pl.error_minutes = round(abs(pl.predicted_eta_minutes - actual_diff), 2)
        except Exception as e:
            print(f"Prediction log matching notice: {e}")

        session.commit()

        
        new_badges = []
        if earned_before is not None:
            try:
                _, badges_after = badges.evaluate(session, user_id)
                new_badges = [b for b in badges_after
                              if b["earned"] and b["id"] not in earned_before]
            except Exception as e:
                print(f"Badge check (after) notice: {e}")

        return jsonify({"status": "ok", "new_badges": new_badges})


@app.route('/profile', methods=['GET'])
@require_auth
def get_profile():

    user_id = g.current_user['id']

    with get_session() as session:
        user = session.get(User, user_id)
        if not user:
            return jsonify({"error": "user not found"}), 404

        stats, badge_list = badges.evaluate(session, user_id)
        nxt = badges.next_badge(badge_list)

        phone = user.phone or ""
        masked_phone = f"{phone[:3]} ••••• {phone[-4:]}" if len(phone) >= 8 else ""

        return jsonify({
            "user": {
                "id": user.id,
                "name": user.name,
                "phone": masked_phone,
                "member_since": user.created_at.isoformat() + "Z" if user.created_at else None,
            },
            "stats": stats,
            "badges": badge_list,
            "badges_earned": sum(1 for b in badge_list if b["earned"]),
            "next_badge_id": nxt["id"] if nxt else None,
            "recent": badges.recent_sightings(session, user_id),
        })


@app.route('/eta/<int:route_stop_id>', methods=['GET'])
def get_eta(route_stop_id):
    direction = request.args.get('direction', 'forward')
    res = calculate_eta(route_stop_id, direction)
    if isinstance(res, dict) and "eta minutes" in res:
        try:
            with get_session() as session:
                log_entry = PredictionLog(
                    route_stop_id=route_stop_id,
                    direction=direction,
                    predicted_eta_minutes=float(res.get("eta minutes", 15)),
                    status=str(res.get("status", "unknown"))
                )
                session.add(log_entry)
                session.commit()
        except Exception as e:
            print(f"Prediction logging notice: {e}")
    return res


@app.route('/feedback', methods=['POST'])
def submit_feedback():
    data = request.get_json() or {}
    msg = (data.get('message') or '').strip()
    category = (data.get('category') or 'General').strip()
    user_id = data.get('user_id')
    if not msg:
        return jsonify({"error": "Message is required"}), 400
    with get_session() as session:
        fb = Feedback(
            user_id=int(user_id) if user_id and str(user_id).isdigit() else None,
            category=category[:50],
            message=msg[:1000]
        )
        session.add(fb)
        session.commit()
        return jsonify({"status": "ok", "message": "Thank you! Your feedback has been received."})


@app.route('/analytics/accuracy', methods=['GET'])
def get_accuracy_metrics():
    with get_session() as session:
        evaluated = session.scalars(
            select(PredictionLog).where(PredictionLog.error_minutes.is_not(None))
        ).all()
        if not evaluated:
            return jsonify({
                "samples_count": 0,
                "mae_minutes": None,
                "mape_percent": None,
                "status": "Collecting live arrival data"
            })
        errors = [p.error_minutes for p in evaluated]
        mae = round(sum(errors) / len(errors), 2)
        mape_list = []
        for p in evaluated:
            if p.predicted_eta_minutes and p.predicted_eta_minutes > 0:
                mape_list.append(abs(p.error_minutes / p.predicted_eta_minutes) * 100.0)
        mape = round(sum(mape_list) / len(mape_list), 1) if mape_list else None
        return jsonify({
            "samples_count": len(evaluated),
            "mae_minutes": mae,
            "mape_percent": mape,
            "accuracy_percent": round(max(0.0, 100.0 - mape), 1) if mape is not None else None
        })


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
    user_name = (data.get('name') or '').strip()[:40]

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
