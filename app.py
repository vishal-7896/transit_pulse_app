from flask import Flask,request,jsonify
from db import get_db
from flask_cors import CORS
from eta import calculate_eta
app=Flask(__name__)
CORS(app)

@app.route('/')
def home():
    return "<p>This is the home page of Transit Pulse</p>"
@app.route('/routes',methods=['GET'])

def get_route():
    conn=get_db()
    rows=conn.execute('SELECT id, name, start_terminus, stop_terminus FROM route').fetchall()
    return jsonify([dict(r) for r in rows])
@app.route('/routes/<int:route_id>/stops',methods=['GET'])
def get_stops(route_id):
    conn = get_db()
    rows=conn.execute('''SELECT rs.id AS route_stop_id,
    rs.stop_order,
    s.name,
    s.landmark,
    rs.avg_travel_seconds
    FROM route_stop rs JOIN stop s ON rs.stop_id=s.id
    WHERE rs.route_id=? ORDER BY rs.stop_order''' , (route_id,) ).fetchall()
    return jsonify([dict(r) for r in rows])
@app.route('/sighting',methods=['POST'])
def post_sighting():

    data=request.get_json()
    route_stop_id =data.get('route_stop_id')
    user_id=data.get('user_id')
    direction=data.get('direction','forward')

    if not route_stop_id or not user_id:
        return jsonify({"error":"require all fields"}),400
    conn = get_db()

    recent=conn.execute("""
    SELECT id FROM sighting WHERE user_id=?
     AND route_stop_id IN(SELECT id FROM route_stop 
     WHERE route_id=(SELECT route_id FROM route_stop 
     WHERE id=?)) AND seen_at > datetime('now','-3 minutes')
    """,(user_id,route_stop_id)).fetchone()
    if recent:
        return jsonify({"error":"too many requests "}),429
    conn.execute('INSERT INTO sighting (user_id,route_stop_id,direction) VALUES (?,?,?)' , (user_id,route_stop_id,direction))
    conn.commit()
    return jsonify({"status":"ok"})

@app.route('/eta/<int:route_stop_id>',methods=['GET'])
def get_eta(route_stop_id):
    return(calculate_eta(route_stop_id))

@app.route('/register',methods=['POST'])
def register_user():
    data=request.get_json()
    user_name=data.get('name','Anonymous')
    ph_num=data.get('phone')
    if ph_num is None:
        return jsonify({"status":"error",
                "message":"enter phone number"}),400
    conn=get_db()

    try:
        cur=conn.execute("""
        INSERT INTO user (name,phone) VALUES (?,?)
        """,(user_name,ph_num))
        user_id = cur.lastrowid
        conn.commit()

        return jsonify({"user_id":user_id})
    except Exception as e:
        user_id = conn.execute("""
                SELECT id FROM user WHERE phone=?
                """, ( ph_num,)).fetchone()
        return jsonify({"user_id": user_id['id']})


if __name__=='__main__':
    app.run(debug=True)