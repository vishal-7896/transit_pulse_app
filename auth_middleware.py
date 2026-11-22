import os
import json
import base64
from functools import wraps
from flask import request, jsonify, g
import firebase_admin
from firebase_admin import credentials, auth
from sqlalchemy import select
from db import get_session
from alchemy_models import User

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None

if os.path.exists("serviceAccountKey.json"):
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
elif os.getenv("FIREBASE_SERVICE_ACCOUNT"):
    try:
        cred_dict = json.loads(os.getenv("FIREBASE_SERVICE_ACCOUNT"))
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
    except Exception as e:
        print(f"CRITICAL: Failed to parse FIREBASE_SERVICE_ACCOUNT: {e}")

is_prod = os.getenv("FLASK_ENV") == "production" or os.getenv("RENDER") is not None

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({"error": "Unauthorized: Missing Bearer token"}), 401

        token = auth_header.split('Bearer ')[1].strip()
        if not token:
            return jsonify({"error": "Unauthorized: Empty Bearer token"}), 401

        firebase_uid = None
        verified_phone = None

        try:
            if firebase_admin._apps:
                decoded_token = auth.verify_id_token(token)
                firebase_uid = decoded_token.get('uid')
                verified_phone = decoded_token.get('phone_number')
            else:
                if is_prod:
                    return jsonify({"error": "Authentication service unavailable. Please try again shortly."}), 503

                parts = token.split('.')
                if len(parts) >= 2:
                    payload_b64 = parts[1] + '=' * (-len(parts[1]) % 4)
                    payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode('utf-8')).decode('utf-8'))
                    firebase_uid = payload.get('user_id') or payload.get('sub')
                    verified_phone = payload.get('phone_number')
                if not firebase_uid:
                    firebase_uid = "local_dev_user"
                if not verified_phone:
                    verified_phone = "+910000000000"

            if not firebase_uid:
                return jsonify({"error": "Invalid token identity"}), 401

            with get_session() as session:
                user = session.scalars(select(User).where(User.firebase_uid == firebase_uid)).first()

                if not user and verified_phone:
                    phone_candidates = [verified_phone]
                    if len(verified_phone) >= 10:
                        raw_10 = verified_phone[-10:]
                        phone_candidates.extend([raw_10, f"+91{raw_10}"])
                    user = session.scalars(select(User).where(User.phone.in_(phone_candidates))).first()
                    if user and not user.firebase_uid:
                        user.firebase_uid = firebase_uid
                        session.commit()

                if not user:
                    user = User(
                        firebase_uid=firebase_uid,
                        phone=verified_phone,
                        name="Commuter"
                    )
                    session.add(user)
                    session.commit()

                g.current_user = {
                    "id": user.id,
                    "name": user.name,
                    "phone": user.phone
                }

        except Exception as e:
            if sentry_sdk:
                sentry_sdk.capture_exception(e)
            return jsonify({"error": "Invalid or expired authentication token"}), 401

        return f(*args, **kwargs)

    return decorated_function
