# auth_middleware.py
from functools import wraps
from flask import request, jsonify, g
import firebase_admin
from firebase_admin import credentials, auth
from sqlalchemy import select

from db import get_session
from alchemy_models import User

# Initialize Firebase Admin using your downloaded key
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 1. Grab Authorization header: "Bearer <token>"
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({"error": "Unauthorized: Missing Bearer token"}), 401

        token = auth_header.split('Bearer ')[1].strip()

        try:
            # 2. Verify signature with Google servers
            decoded_token = auth.verify_id_token(token)
            firebase_uid = decoded_token['uid']
            verified_phone = decoded_token.get('phone_number')

            with get_session() as session:
                # 3. Look up user by firebase_uid
                stmt = select(User).where(User.firebase_uid == firebase_uid)
                user = session.scalars(stmt).first()

                # 4. If first-time user, create their DB row
                if not user:
                    user = User(
                        firebase_uid=firebase_uid,
                        phone=verified_phone,
                        name="Commuter"
                    )
                    session.add(user)
                    session.commit()

                # 5. Store user in Flask's request context
                g.current_user = {
                    "id": user.id,
                    "name": user.name,
                    "phone": user.phone
                }

        except Exception as e:
            return jsonify({"error": "Unauthorized: Invalid or expired token", "details": str(e)}), 401

        return f(*args, **kwargs)
    return decorated_function