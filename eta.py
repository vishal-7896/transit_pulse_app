import datetime
from db import get_db

def calculate_eta(route_stop_id):
    conn=get_db()
    this_stop=conn.execute("""
    SELECT route_id,stop_order FROM route_stop
    WHERE id=?
    """,(route_stop_id,)).fetchone()

    if this_stop is None:
        return {"status":"error","message":"stop not found"},404
    route_id=this_stop['route_id']
    user_stop_order=this_stop['stop_order']

    last=conn.execute("""
    SELECT route_stop.stop_order,sighting.seen_at FROM sighting
    JOIN route_stop ON sighting.route_stop_id=route_stop.id WHERE 
    route_stop.route_id=? AND route_stop.stop_order <=? ORDER BY
    sighting.seen_at DESC LIMIT 1
    """,(route_id,user_stop_order)).fetchone()
    if last is None:
        return {"status":"no data"}
    sighting_stop_order=last['stop_order']
    seen_at=last['seen_at']

    seen_at_formatted=datetime.datetime.fromisoformat(seen_at)
    curr_time=datetime.datetime.utcnow()
    age=curr_time-seen_at_formatted

    if age > datetime.timedelta(minutes=30):
        return {"status":"stale","seen at":seen_at_formatted}

    remaining =conn.execute("""
    SELECT COALESCE(SUM(avg_travel_seconds),0) FROM 
    route_stop WHERE route_id=? AND stop_order>? AND
    stop_order<=?
    """,(route_id,sighting_stop_order,user_stop_order)).fetchone()[0]
    elapsed=age.total_seconds()
    eta_seconds = remaining - elapsed
    eta=max(0,eta_seconds)

    if eta ==0 and remaining < elapsed:
        row=conn.execute("""
        SELECT frequency_minutes FROM route WHERE id=?
        """,(route_id,)).fetchone()
        freq_min=row['frequency_minutes']
        return {"status":"passed",
                "message":"Bus may just have passed",
                "next bus approx mins":freq_min  }

    else:
        return {"status":"live",
                "eta seconds":eta_seconds,
                "eta minutes":round((eta_seconds/60))}
