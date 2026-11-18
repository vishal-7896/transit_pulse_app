from flask import redirect, url_for, request, flash, session as flask_session
from flask_admin import Admin, AdminIndexView, expose
try:
    import flask_admin.contrib.sqla._types as _fa_types
    if not hasattr(_fa_types, 'T_SESSION'):
        _fa_types.T_SESSION = object
except Exception:
    pass

from flask_admin.contrib.sqla import ModelView
from wtforms.fields import FloatField
from sqlalchemy.orm import Session
from sqlalchemy.orm import scoped_session, sessionmaker

from alchemy_models import engine, Route, Stop, RouteStop, Operator, User, Sighting, Feedback, PosterScan

import os
import hmac
from werkzeug.security import check_password_hash
from dotenv import load_dotenv

load_dotenv()
from werkzeug.security import generate_password_hash

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH") or generate_password_hash("admin123")

def credentials_ok(username, password):
    return (hmac.compare_digest(username or "", ADMIN_USERNAME)
            and check_password_hash(ADMIN_PASSWORD_HASH, password or ""))


class SecureModelView(ModelView):
    def is_accessible(self):
        return flask_session.get("is_admin", False)

    def inaccessible_callback(self, name, **kwargs):
        return redirect(url_for("admin.login_view", next=request.url))


class SecureAdminIndexView(AdminIndexView):
    @expose("/")
    def index(self):
        if not flask_session.get("is_admin", False):
            return redirect(url_for(".login_view"))
        return super().index()

    @expose("/poster")
    def poster_view(self):
        if not flask_session.get("is_admin", False):
            return redirect(url_for(".login_view"))
        return redirect("/poster.html?admin=1")

    @expose("/login", methods=["GET", "POST"])
    def login_view(self):
        if request.method == "POST":
            username = request.form.get("username", "")
            password = request.form.get("password", "")

            if credentials_ok(username, password):
                flask_session["is_admin"] = True
                next_url = request.args.get("next") or ""
                if not next_url.startswith("/") or next_url.startswith("//"):
                    next_url = url_for(".index")
                return redirect(next_url)
            else:
                flash("Invalid credentials", "error")

        return """
        <!doctype html>
        <html>
        <head>
            <title>Admin Login — TransitPulse</title>
            <style>
                body { font-family: sans-serif; display: flex; justify-content: center;
                       align-items: center; height: 100vh; margin: 0;
                       background: #1a1a2e; color: #e0e0e0; }
                .box  { background: #16213e; padding: 40px; border-radius: 12px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.4); width: 320px; }
                h2    { margin-top: 0; text-align: center; color: #00d4ff; }
                input { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #333;
                        border-radius: 6px; background: #0f3460; color: #fff;
                        box-sizing: border-box; font-size: 14px; }
                button { width: 100%; padding: 12px; margin-top: 12px; border: none;
                         border-radius: 6px; background: #00d4ff; color: #1a1a2e;
                         font-weight: bold; font-size: 15px; cursor: pointer; }
                button:hover { background: #00b8d9; }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>🚌 TransitPulse Admin</h2>
                <form method="POST">
                    <input type="text" name="username" placeholder="Username" required>
                    <input type="password" name="password" placeholder="Password" required>
                    <button type="submit">Login</button>
                </form>
            </div>
        </body>
        </html>
        """

    @expose("/logout")
    def logout_view(self):
        flask_session.pop("is_admin", None)
        return redirect(url_for(".login_view"))


class OperatorAdmin(SecureModelView):
    column_list = ["id", "name", "short_code", "type"]
    column_searchable_list = ["name", "short_code"]
    column_filters = ["type"]
    form_choices = {
        "type": [("government", "Government"), ("private", "Private")]
    }


class RouteAdmin(SecureModelView):
    column_list = ["id", "name", "start_terminus", "stop_terminus", "frequency_minutes"]
    column_searchable_list = ["name", "start_terminus", "stop_terminus"]


class SightingAdmin(SecureModelView):
    column_list = ["id", "route_stop", "user", "operator", "direction", "service_type", "crowd_level", "is_trip_confirmation", "seen_at"]
    column_filters = ["direction", "service_type", "crowd_level", "is_trip_confirmation", "seen_at"]
    form_choices = {
        "direction": [("forward", "Forward"), ("return", "Return")],
        "service_type": [("shuttle", "Kaushambi Shuttle"), ("long_haul", "Anand Vihar Long-Haul")],
        "crowd_level": [("empty", "Empty seats"), ("moderate", "Standing only"), ("packed", "Fully packed")]
    }
    can_create = False


class RouteStopAdmin(SecureModelView):
    column_list = ["id", "route", "stop", "stop_order", "avg_travel_seconds", "distance_km", "is_waypoint"]
    form_columns = ["route", "stop", "stop_order", "avg_travel_seconds", "distance_km", "is_waypoint"]
    form_overrides = {"distance_km": FloatField}
    form_args = {"distance_km": {"label": "Distance (km)", "default": 0.0}}
    column_filters = ["route", "is_waypoint"]


class StopAdmin(SecureModelView):
    column_list = ["id", "name", "landmark", "routes_display"]
    column_searchable_list = ["name", "landmark"]
    form_overrides = {"latitude": FloatField, "longitude": FloatField}

    column_formatters = {
        "routes_display": lambda v, c, m, p: ", ".join(
            rs.route.name for rs in m.route_stops
        ) if m.route_stops else "—"
    }
    column_labels = {
        "routes_display": "Routes"
    }

def init_admin(app):
    admin = Admin(
        app,
        name="TransitPulse Admin",
        index_view=SecureAdminIndexView()
    )
    @app.teardown_appcontext
    def shutdown_session(exception=None):
        db_session.remove()

    db_session = scoped_session(sessionmaker(bind=engine))

    admin.add_view(OperatorAdmin(Operator, db_session, name="Operators"))
    admin.add_view(RouteAdmin(Route, db_session, name="Routes"))
    admin.add_view(StopAdmin(Stop, db_session, name="Stops"))
    admin.add_view(RouteStopAdmin(RouteStop, db_session, name="Route Stops"))
    admin.add_view(SecureModelView(User, db_session, name="Users"))
    admin.add_view(SightingAdmin(Sighting, db_session, name="Sightings"))
    admin.add_view(SecureModelView(Feedback, db_session, name="Feedback"))
    admin.add_view(SecureModelView(PosterScan, db_session, name="Poster Scans"))

    return admin
