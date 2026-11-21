import os
try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None
from flask import Flask, request, jsonify, g, abort, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import select, func
from datetime import datetime, timedelta
from dotenv import load_dotenv
from db import get_session
from alchemy_models import Route, RouteStop, Sighting, User, Operator, UserFavorite, Stop, PredictionLog, Feedback, PosterScan
import badges
from eta import calculate_eta, compute_hop_distances, span_sum, estimate_live_corridor_speed
from auth_middleware import require_auth
from admin_views import init_admin


load_dotenv()

sentry_dsn = os.getenv("SENTRY_DSN", "https://5900da1832d4c247e5f044781ce4d36b@o4512355430432768.ingest.us.sentry.io/4512355513794560")
if sentry_dsn and sentry_sdk:
    sentry_sdk.init(
        dsn=sentry_dsn,
        traces_sample_rate=0.1
    )

is_prod = os.getenv("FLASK_ENV") == "production" or os.getenv("RENDER") is not None

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "transitpulse_dev_local_secret_key")
app.config.update(
    SESSION_COOKIE_SECURE=is_prod,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=24)
)

CORS(app)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["300 per minute"],
    storage_uri="memory://",
    strategy="fixed-window"
)

@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({"error": "Too many requests. Please wait a moment before trying again."}), 429

init_admin(app, limiter=limiter)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
ALLOWED_EXTENSIONS = {'.html', '.js', '.css', '.png', '.jpg', '.jpeg',
                      '.svg', '.ico', '.webmanifest', '.woff2'}


@app.route('/ping', methods=['GET'])
def ping():
    return jsonify({"status": "ok", "time": datetime.utcnow().isoformat()}), 200


@app.route('/')
def home():
    return send_from_directory(FRONTEND_DIR, 'index.html')


def format_delhi_terminus(name):
    if not name:
        return name
    low = name.strip().lower()
    if low in ("delhi", "kaushambi", "anand vihar", "anand vihar isbt", "anand vihar / kaushambi", "delhi (anand vihar / kaushambi)"):
        return "Delhi (Anand Vihar / Kaushambi)"
    return name


def format_delhi_landmark(name, landmark):
    if not name:
        return landmark
    low = name.strip().lower()
    if low in ("delhi", "kaushambi", "anand vihar", "anand vihar isbt", "anand vihar / kaushambi", "delhi (anand vihar / kaushambi)"):
        return "Anand Vihar ISBT · Kaushambi Metro"
    return landmark


@app.route('/routes', methods=['GET'])
def get_route():
    with get_session() as session:
        routes = session.scalars(select(Route)).all()
        return jsonify([{
            "id": r.id,
            "name": r.name,
            "start_terminus": format_delhi_terminus(r.start_terminus),
            "stop_terminus": format_delhi_terminus(r.stop_terminus)
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
        hop_distances = compute_hop_distances(route_stops)
        return jsonify([{
            "route_stop_id": rs.id,
            "stop_order": rs.stop_order,
            "name": format_delhi_terminus(rs.stop.name),
            "landmark": format_delhi_landmark(rs.stop.name, rs.stop.landmark),
            "avg_travel_seconds": rs.avg_travel_seconds,
            "distance_km": hop_distances.get(rs.stop_order, 0.0),
            "is_waypoint": bool(getattr(rs, "is_waypoint", False))
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


def check_speed_anti_cheat(session, user_id, current_rs, hop_distances, now_utc):
    thirty_min_ago = now_utc - timedelta(minutes=30)
    row = session.execute(
        select(Sighting, RouteStop)
        .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
        .where(
            Sighting.user_id == user_id,
            RouteStop.route_id == current_rs.route_id,
            Sighting.seen_at > thirty_min_ago
        )
        .order_by(Sighting.seen_at.desc())
    ).first()

    if not row:
        return True, None

    last_sighting, last_rs = row
    if last_rs.stop_order == current_rs.stop_order:
        return True, None

    dist_km = span_sum(hop_distances, last_rs.stop_order, current_rs.stop_order)
    dt_sec = (now_utc - last_sighting.seen_at).total_seconds()
    if dist_km > 0.5 and dt_sec > 0:
        implied_kmh = dist_km / (dt_sec / 3600.0)
        if implied_kmh > 110.0:
            return False, round(implied_kmh, 1)

    return True, None


def update_adaptive_travel_time(session, current_rs, sighting, route_stops, hop_distances, now_utc, alpha=0.2):
    try:
        ordered = sorted(route_stops, key=lambda rs: rs.stop_order)
        curr_idx = next((i for i, rs in enumerate(ordered) if rs.id == current_rs.id), None)
        if curr_idx is None:
            return

        if sighting.direction == 'return':
            candidate_stops = ordered[curr_idx + 1: curr_idx + 4]
        else:
            start_i = max(0, curr_idx - 3)
            candidate_stops = list(reversed(ordered[start_i: curr_idx]))

        if not candidate_stops:
            return

        candidate_ids = [rs.id for rs in candidate_stops]
        stmt = (
            select(Sighting, RouteStop)
            .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
            .where(
                RouteStop.id.in_(candidate_ids),
                Sighting.direction == sighting.direction,
                Sighting.seen_at > now_utc - timedelta(minutes=45)
            )
            .order_by(Sighting.seen_at.desc())
        )
        if sighting.operator_id:
            stmt = stmt.where(Sighting.operator_id == sighting.operator_id)

        rows = session.execute(stmt).all()
        if not rows:
            return

        chosen = None
        if getattr(sighting, "is_trip_confirmation", False):
            for s_obj, rs_obj in rows:
                if s_obj.user_id == sighting.user_id:
                    chosen = (s_obj, rs_obj)
                    break
        if chosen is None:
            chosen = rows[0]

        prev_sighting, prev_rs = chosen
        delta_seconds = (now_utc - prev_sighting.seen_at).total_seconds()
        if not (60 <= delta_seconds <= 2700):
            return

        span_km = span_sum(hop_distances, prev_rs.stop_order, current_rs.stop_order)
        if span_km >= 0.5:
            seg_speed = span_km / (delta_seconds / 3600.0)
            if not (8.0 <= seg_speed <= 95.0):
                return

        min_o = min(prev_rs.stop_order, current_rs.stop_order)
        max_o = max(prev_rs.stop_order, current_rs.stop_order)
        hop_rows = [rs for rs in ordered if min_o < rs.stop_order <= max_o]
        if not hop_rows:
            return

        if len(hop_rows) == 1:
            target_rs = hop_rows[0]
            old_avg = target_rs.avg_travel_seconds or delta_seconds
            target_rs.avg_travel_seconds = int(round((1 - alpha) * old_avg + alpha * delta_seconds))
            return

        weights = [
            float(rs.avg_travel_seconds) if (rs.avg_travel_seconds and rs.avg_travel_seconds > 0)
            else max(0.5, float(hop_distances.get(rs.stop_order, 1.0)))
            for rs in hop_rows
        ]
        total_weight = sum(weights)
        if total_weight <= 0:
            return

        for rs, w in zip(hop_rows, weights):
            hop_obs = delta_seconds * (w / total_weight)
            old_avg = rs.avg_travel_seconds or hop_obs
            rs.avg_travel_seconds = int(round((1 - alpha) * old_avg + alpha * hop_obs))
    except Exception as e:
        print(f"Adaptive travel update notice: {e}")


def build_active_trip(session, user_id, current_rs, direction, operator_id, service_type, route_stops, hop_distances, now_utc):
    try:
        fav_rows = session.execute(
            select(RouteStop, Stop)
            .join(UserFavorite, UserFavorite.route_stop_id == RouteStop.id)
            .join(Stop, RouteStop.stop_id == Stop.id)
            .where(
                UserFavorite.user_id == user_id,
                RouteStop.route_id == current_rs.route_id
            )
        ).all()

        downstream = []
        for fav_rs, fav_stop in fav_rows:
            if direction == 'return' and fav_rs.stop_order < current_rs.stop_order:
                downstream.append((fav_rs, fav_stop))
            elif direction != 'return' and fav_rs.stop_order > current_rs.stop_order:
                downstream.append((fav_rs, fav_stop))

        if not downstream:
            return None

        downstream.sort(key=lambda pair: abs(pair[0].stop_order - current_rs.stop_order))
        target_rs, target_stop = downstream[0]

        travel_times = {rs.stop_order: (rs.avg_travel_seconds or 0) for rs in route_stops}
        base_sec = span_sum(travel_times, current_rs.stop_order, target_rs.stop_order)
        dist_km = round(span_sum(hop_distances, current_rs.stop_order, target_rs.stop_order), 1)

        recent_sightings = session.execute(
            select(
                RouteStop.stop_order,
                Stop.name,
                Sighting.seen_at,
                Sighting.user_id,
                RouteStop.id,
                Sighting.operator_id,
                RouteStop.is_waypoint
            )
            .join(RouteStop, Sighting.route_stop_id == RouteStop.id)
            .join(Stop, RouteStop.stop_id == Stop.id)
            .where(
                RouteStop.route_id == current_rs.route_id,
                Sighting.direction == direction,
                Sighting.seen_at > now_utc - timedelta(minutes=45)
            )
            .order_by(Sighting.seen_at.desc())
        ).all()

        live_speed = estimate_live_corridor_speed(recent_sightings, hop_distances, travel_times, direction, now_utc)
        pace_factor = live_speed["pace_factor"] if live_speed else 1.0
        service_factor = 0.92 if service_type == "long_haul" else 1.0

        est_sec = max(120, int(round(base_sec * pace_factor * service_factor))) if base_sec > 0 else 600
        if est_sec <= 240:
            prompt_after_sec = max(60, int(est_sec * 0.70))
        else:
            prompt_after_sec = max(90, min(est_sec - 120, int(est_sec * 0.80)))

        route_obj = session.get(Route, current_rs.route_id)
        return {
            "route_id": current_rs.route_id,
            "route_name": route_obj.name if route_obj else "",
            "direction": direction,
            "operator_id": operator_id,
            "service_type": service_type,
            "boarded_stop_id": current_rs.id,
            "boarded_stop_name": format_delhi_terminus(current_rs.stop.name) if current_rs.stop else "",
            "boarded_at": now_utc.isoformat() + "Z",
            "target_stop_id": target_rs.id,
            "target_stop_name": format_delhi_terminus(target_stop.name),
            "estimated_travel_seconds": est_sec,
            "distance_km": dist_km if dist_km > 0 else None,
            "prompt_after_seconds": prompt_after_sec
        }
    except Exception as e:
        print(f"Active trip lookup notice: {e}")
        return None


@app.route('/sighting', methods=['POST'])
@limiter.limit("15 per minute; 60 per hour")
@require_auth
def post_sighting():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid request payload format."}), 400

    raw_rs_id = data.get('route_stop_id')
    try:
        route_stop_id = int(raw_rs_id)
        if route_stop_id <= 0:
            return jsonify({"error": "Invalid route_stop_id."}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "route_stop_id must be a valid integer."}), 400

    direction = data.get('direction', 'forward')
    if direction not in ('forward', 'return'):
        return jsonify({"error": "direction must be 'forward' or 'return'."}), 400

    crowd_level = data.get('crowd_level')
    if crowd_level is not None and crowd_level not in ('empty', 'standing', 'packed'):
        return jsonify({"error": "crowd_level must be one of: empty, standing, packed."}), 400

    raw_operator_id = data.get('operator_id')
    operator_id = None
    if raw_operator_id is not None:
        try:
            operator_id = int(raw_operator_id)
            if operator_id <= 0:
                operator_id = None
        except (ValueError, TypeError):
            return jsonify({"error": "operator_id must be a valid integer."}), 400

    raw_service_type = data.get('service_type')
    if raw_service_type is not None:
        if raw_service_type not in ('shuttle', 'long_haul'):
            return jsonify({"error": "service_type must be 'shuttle' or 'long_haul'."}), 400
        service_type = raw_service_type
    else:
        service_type = None

    is_trip_confirmation = bool(data.get('is_trip_confirmation', False))
    user_id = g.current_user['id']

    if not user_id:
        return jsonify({"error": "User identification required."}), 400

    with get_session() as session:
        current_rs = session.get(RouteStop, route_stop_id)
        if not current_rs:
            return jsonify({"error": "stop not found"}), 404

        if operator_id is not None:
            op_exists = session.get(Operator, operator_id)
            if not op_exists:
                return jsonify({"error": f"Operator with id {operator_id} does not exist."}), 400

        now_utc = datetime.utcnow()
        three_min_ago = now_utc - timedelta(minutes=3)
        stmt = (
            select(Sighting)
            .join(RouteStop)
            .where(
                Sighting.user_id == user_id,
                RouteStop.route_id == current_rs.route_id,
                Sighting.seen_at > three_min_ago
            )
            .order_by(Sighting.seen_at.desc())
        )
        recent = session.scalars(stmt).first()

        if recent:
            allow_trip_confirm = (
                is_trip_confirmation
                and recent.route_stop_id != route_stop_id
                and (now_utc - recent.seen_at).total_seconds() >= 60
            )
            if not allow_trip_confirm:
                return jsonify({"error": "too many requests"}), 429

        ist_now = now_utc + timedelta(hours=5, minutes=30)
        if 1 <= ist_now.hour < 4:
            return jsonify({"error": "Sightings are paused between 1:00 AM and 4:00 AM IST."}), 400

        route_stops = session.scalars(
            select(RouteStop)
            .where(RouteStop.route_id == current_rs.route_id)
            .order_by(RouteStop.stop_order)
        ).all()
        hop_distances = compute_hop_distances(route_stops)

        speed_ok, implied_kmh = check_speed_anti_cheat(session, user_id, current_rs, hop_distances, now_utc)
        if not speed_ok:
            return jsonify({
                "error": "Sighting rejected: physically impossible travel speed detected.",
                "implied_speed_kmh": implied_kmh
            }), 400

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
            operator_id=operator_id,
            service_type=service_type,
            is_trip_confirmation=is_trip_confirmation
        )
        session.add(sighting)

        update_adaptive_travel_time(session, current_rs, sighting, route_stops, hop_distances, now_utc)

        try:
            window_start = now_utc - timedelta(minutes=60)
            pending_logs = session.scalars(
                select(PredictionLog).where(
                    PredictionLog.route_stop_id == route_stop_id,
                    PredictionLog.direction == direction,
                    PredictionLog.actual_arrival_at.is_(None),
                    PredictionLog.predicted_at >= window_start
                )
            ).all()
            for pl in pending_logs:
                pl.actual_arrival_at = sighting.seen_at or now_utc
                actual_diff = (pl.actual_arrival_at - pl.predicted_at).total_seconds() / 60.0
                pl.error_minutes = round(abs(pl.predicted_eta_minutes - actual_diff), 2)
        except Exception as e:
            print(f"Prediction log matching notice: {e}")

        try:
            session.commit()
        except Exception as e:
            session.rollback()
            if sentry_sdk:
                sentry_sdk.capture_exception(e)
            return jsonify({"error": "Failed to save sighting due to a database error."}), 500

        new_badges = []
        if earned_before is not None:
            try:
                _, badges_after = badges.evaluate(session, user_id)
                new_badges = [b for b in badges_after
                              if b["earned"] and b["id"] not in earned_before]
            except Exception as e:
                print(f"Badge check (after) notice: {e}")

        active_trip = build_active_trip(
            session, user_id, current_rs, direction, operator_id, service_type, route_stops, hop_distances, now_utc
        )

        return jsonify({
            "status": "ok",
            "new_badges": new_badges,
            "active_trip": active_trip
        })


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
@limiter.limit("60 per minute")
def get_eta(route_stop_id):
    direction = request.args.get('direction', 'forward')
    if direction not in ('forward', 'return'):
        direction = 'forward'
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
@limiter.limit("5 per minute; 20 per hour")
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


@app.route('/analytics/scan', methods=['POST', 'GET'])
@limiter.limit("30 per minute")
def record_scan():
    src = request.args.get('src')
    if not src and request.is_json:
        data = request.get_json(silent=True) or {}
        src = data.get('src')
    src = (src or 'poster')[:50]
    user_agent = request.headers.get('User-Agent', '')[:255]
    try:
        with get_session() as session:
            scan = PosterScan(src=src, user_agent=user_agent)
            session.add(scan)
            session.commit()
            count = session.scalars(select(func.count(PosterScan.id)).where(PosterScan.src == src)).first() or 1
            return jsonify({"status": "ok", "src": src, "total_scans": count})
    except Exception as e:
        if sentry_sdk:
            sentry_sdk.capture_exception(e)
        return jsonify({"status": "error", "message": "Failed to record scan"}), 500


@app.route('/analytics/accuracy', methods=['GET'])
def get_accuracy_metrics():
    with get_session() as session:
        evaluated = session.scalars(
            select(PredictionLog).where(PredictionLog.error_minutes.is_not(None))
        ).all()
        poster_scans = session.scalars(select(func.count(PosterScan.id)).where(PosterScan.src == 'poster')).first() or 0
        total_scans = session.scalars(select(func.count(PosterScan.id))).first() or 0
        if not evaluated:
            return jsonify({
                "samples_count": 0,
                "mae_minutes": None,
                "mape_percent": None,
                "poster_scans": poster_scans,
                "total_scans": total_scans,
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
            "accuracy_percent": round(max(0.0, 100.0 - mape), 1) if mape is not None else None,
            "poster_scans": poster_scans,
            "total_scans": total_scans
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
            "name": format_delhi_terminus(s.name),
            "landmark": format_delhi_landmark(s.name, s.landmark)
        } for rs, r, s in rows])


@app.route('/favorites/toggle', methods=['POST'])
@limiter.limit("30 per minute")
def toggle_favorite():
    data = request.get_json(silent=True) or {}
    raw_user_id = data.get('user_id')
    raw_route_stop_id = data.get('route_stop_id')

    try:
        user_id = int(raw_user_id)
        route_stop_id = int(raw_route_stop_id)
        if user_id <= 0 or route_stop_id <= 0:
            return jsonify({"error": "user_id and route_stop_id must be positive integers"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "user_id and route_stop_id must be valid integers"}), 400

    with get_session() as session:
        if not session.get(User, user_id):
            return jsonify({"error": "User not found"}), 404
        if not session.get(RouteStop, route_stop_id):
            return jsonify({"error": "RouteStop not found"}), 404

        stmt = select(UserFavorite).where(
            UserFavorite.user_id == user_id,
            UserFavorite.route_stop_id == route_stop_id
        )
        existing = session.scalars(stmt).first()

        try:
            if existing:
                session.delete(existing)
                session.commit()
                return jsonify({"status": "ok", "starred": False})
            else:
                fav = UserFavorite(user_id=user_id, route_stop_id=route_stop_id)
                session.add(fav)
                session.commit()
                return jsonify({"status": "ok", "starred": True})
        except Exception as e:
            session.rollback()
            if sentry_sdk:
                sentry_sdk.capture_exception(e)
            return jsonify({"error": "Failed to update favorite due to a database error."}), 500


@app.route('/register', methods=['POST'])
@limiter.limit("10 per minute; 30 per hour")
@require_auth
def register_user():
    data = request.get_json(silent=True) or {}
    user_name = (data.get('name') or '').strip()[:40]

    with get_session() as session:
        user = session.get(User, g.current_user['id'])
        if not user:
            return jsonify({"error": "user not found"}), 404

        if user_name:
            user.name = user_name
            try:
                session.commit()
            except Exception as e:
                session.rollback()
                if sentry_sdk:
                    sentry_sdk.capture_exception(e)
                return jsonify({"error": "Failed to save profile name."}), 500

        return jsonify({
            "status": "ok",
            "user_id": user.id,
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
    debug_flag = os.getenv("FLASK_DEBUG", "false").lower() in ("true", "1", "t")
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=debug_flag)
