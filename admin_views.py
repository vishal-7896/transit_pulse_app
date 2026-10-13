from flask import redirect, url_for, request, flash, session as flask_session
from flask_admin import Admin, AdminIndexView, expose
from flask_admin.contrib.sqla import ModelView
from sqlalchemy.orm import Session
from sqlalchemy.orm import scoped_session, sessionmaker

from alchemy_models import engine, Route, Stop, RouteStop, Operator, User, Sighting

import os
import hmac
from werkzeug.security import check_password_hash
from dotenv import load_dotenv

load_dotenv()
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH")
if not ADMIN_USERNAME or not ADMIN_PASSWORD_HASH:
    raise RuntimeError("ADMIN_USERNAME / ADMIN_PASSWORD_HASH missing from .env")

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
    column_list = ["id", "route_stop", "user", "operator", "direction", "crowd_level", "seen_at"]
    column_filters = ["direction", "crowd_level", "seen_at"]
    form_choices = {
        "direction": [("forward", "Forward"), ("return", "Return")],
        "crowd_level": [("empty", "Empty"), ("moderate", "Moderate"), ("packed", "Packed")]
    }
    can_create = False
class StopAdmin(SecureModelView):
    column_list = ["id", "name", "landmark", "routes_display"]
    column_searchable_list = ["name", "landmark"]

    # Custom column that shows which routes this stop belongs to
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
        # template_mode="bootstrap4",
        index_view=SecureAdminIndexView()
    )
    @app.teardown_appcontext
    def shutdown_session(exception=None):
        db_session.remove()

    db_session = scoped_session(sessionmaker(bind=engine))

    admin.add_view(OperatorAdmin(Operator, db_session, name="Operators"))
    admin.add_view(RouteAdmin(Route, db_session, name="Routes"))
    admin.add_view(StopAdmin(Stop, db_session, name="Stops"))
    admin.add_view(SecureModelView(RouteStop, db_session, name="Route Stops"))
    admin.add_view(SecureModelView(User, db_session, name="Users"))
    admin.add_view(SightingAdmin(Sighting, db_session, name="Sightings"))

    return admin