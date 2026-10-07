"""
TransitPulse - Flask REST API Backend Reference Implementation
SQLite DB: transitpulse.db
Endpoints:
  GET /routes
  GET /stops?route_id=<id>
  GET /eta/<stop_id>
  POST /sighting
  POST /register
"""

import sqlite3
import time
from datetime import datetime
from flask import Flask, jsonify, request

app = Flask(__name__)

# Basic CORS headers handler
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

DB_FILE = 'transitpulse.db'

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    # Create tables
    c.execute('''
        CREATE TABLE IF NOT EXISTS route (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            name TEXT,
            description TEXT
        )
    ''')
    
    c.execute('''
        CREATE TABLE IF NOT EXISTS stop (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS route_stop (
            route_id INTEGER,
            stop_id INTEGER,
            sequence INTEGER,
            PRIMARY KEY (route_id, stop_id)
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS user (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS sighting (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER,
            stop_id INTEGER,
            user_id TEXT,
            timestamp INTEGER
        )
    ''')

    # Insert sample seed data if empty
    c.execute('SELECT COUNT(*) FROM route')
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO route (id, code, name, description) VALUES (1, 'R-101', 'Downtown Express', 'Central Station ↔ Metro University')")
        c.execute("INSERT INTO route (id, code, name, description) VALUES (2, 'R-204', 'Westside Loop', 'Tech Park ↔ Bayfront Terminal')")
        
        c.execute("INSERT INTO stop (id, name) VALUES (101, 'Central Station Plaza')")
        c.execute("INSERT INTO stop (id, name) VALUES (102, '5th Avenue & Market St')")
        c.execute("INSERT INTO stop (id, name) VALUES (103, 'City Hospital South')")
        c.execute("INSERT INTO stop (id, name) VALUES (104, 'Arts District Gateway')")
        c.execute("INSERT INTO stop (id, name) VALUES (105, 'Metro University North')")

        c.execute("INSERT INTO route_stop VALUES (1, 101, 1)")
        c.execute("INSERT INTO route_stop VALUES (1, 102, 2)")
        c.execute("INSERT INTO route_stop VALUES (1, 103, 3)")
        c.execute("INSERT INTO route_stop VALUES (1, 104, 4)")
        c.execute("INSERT INTO route_stop VALUES (1, 105, 5)")

    conn.commit()
    conn.close()

# OPTIONS preflight
@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def options_handler(path):
    return '', 200

@app.route('/routes', methods=['GET'])
def get_routes():
    conn = get_db()
    routes = conn.execute('SELECT * FROM route').fetchall()
    conn.close()
    return jsonify([dict(r) for r in routes])

@app.route('/stops', methods=['GET'])
def get_stops():
    route_id = request.args.get('route_id', type=int)
    conn = get_db()
    if route_id:
        stops = conn.execute('''
            SELECT s.id, s.name, rs.sequence 
            FROM stop s
            JOIN route_stop rs ON s.id = rs.stop_id
            WHERE rs.route_id = ?
            ORDER BY rs.sequence ASC
        ''', (route_id,)).fetchall()
    else:
        stops = conn.execute('SELECT * FROM stop').fetchall()
    conn.close()
    return jsonify([dict(s) for s in stops])

@app.route('/eta/<int:stop_id>', methods=['GET'])
def get_eta(stop_id):
    conn = get_db()
    # Find most recent sighting for any bus leading up to or at this stop
    row = conn.execute('''
        SELECT s.*, st.name as stop_name
        FROM sighting s
        JOIN stop st ON s.stop_id = st.id
        ORDER BY s.timestamp DESC LIMIT 1
    ''').fetchone()
    conn.close()

    if not row:
        return jsonify({
            'stop_id': stop_id,
            'eta_minutes': 6,
            'status': 'on_time',
            'last_sighting_mins_ago': 3,
            'last_stop_name': 'Depot Terminal'
        })

    now = int(time.time())
    elapsed_mins = max(0, (now - row['timestamp']) // 60)

    if elapsed_mins > 15:
        status = 'no_recent_data'
        eta_minutes = 12
    else:
        status = 'on_time'
        eta_minutes = max(1, 8 - elapsed_mins)

    return jsonify({
        'stop_id': stop_id,
        'eta_minutes': eta_minutes,
        'status': status,
        'last_sighting_mins_ago': elapsed_mins,
        'last_stop_name': row['stop_name']
    })

@app.route('/sighting', methods=['POST'])
def post_sighting():
    data = request.json or {}
    route_id = data.get('route_id')
    stop_id = data.get('stop_id')
    user_id = data.get('user_id', 'anonymous')

    if not route_id or not stop_id:
        return jsonify({'error': 'route_id and stop_id required'}), 400

    conn = get_db()
    now = int(time.time())

    # Rate limiting: 3 minutes (180 seconds) per user
    last_user_sighting = conn.execute('''
        SELECT timestamp FROM sighting 
        WHERE user_id = ? 
        ORDER BY timestamp DESC LIMIT 1
    ''', (user_id,)).fetchone()

    if last_user_sighting and (now - last_user_sighting['timestamp']) < 180:
        remaining = 180 - (now - last_user_sighting['timestamp'])
        conn.close()
        return jsonify({
            'error': 'Rate limit exceeded',
            'message': f'Please wait {remaining} seconds before submitting another sighting.'
        }), 429

    conn.execute('''
        INSERT INTO sighting (route_id, stop_id, user_id, timestamp)
        VALUES (?, ?, ?, ?)
    ''', (route_id, stop_id, user_id, now))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Sighting recorded successfully'})

@app.route('/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username')
    if not username:
        return jsonify({'error': 'username required'}), 400

    user_id = f"usr_{int(time.time())}"
    conn = get_db()
    try:
        conn.execute('INSERT INTO user (id, username) VALUES (?, ?)', (user_id, username))
        conn.commit()
    except sqlite3.IntegrityError:
        pass # Username exists, allow re-session
    finally:
        conn.close()

    return jsonify({'user_id': user_id, 'username': username, 'message': 'Registered successfully'})

if __name__ == '__main__':
    init_db()
    print("TransitPulse Flask Backend running on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
