import sqlite3

conn = sqlite3.connect('transitpulse.db')

# ====================================================================
# ROUTE 1 — Hapur-Delhi (Data provided by Leader)
# ====================================================================

# 1. Insert the route details
conn.execute("""
    INSERT INTO route (name, start_terminus, end_terminus, frequency_minutes)
    VALUES (?, ?, ?, ?)
""", ('Hapur-Delhi', 'Hapur', 'Delhi', 20))

# Automatically get the generated route ID
route1_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

# 2. Insert the physical stops and save their generated IDs
stops_route1 = [
    ('Hapur', 'Ambedkar Chowk'),
    ('Nizampur', 'Tilak Hospital'),
    ('Pilkhuwa', 'GS Hospital'),
    ('Dasna', 'IMS Engineering college')
]

stop_ids_route1 = []
for stop_name, landmark in stops_route1:
    conn.execute("""
        INSERT INTO stop (name, landmark)
        VALUES (?, ?)
    """, (stop_name, landmark))
    stop_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    stop_ids_route1.append(stop_id)

# 3. Link stops to the route with their sequence and travel times (in seconds)
route_stop_data_route1 = [
    (route1_id, stop_ids_route1[0], 1, 0),    # Hapur (Start)
    (route1_id, stop_ids_route1[1], 2, 480),  # Nizampur (480s from previous)
    (route1_id, stop_ids_route1[2], 3, 360),  # Pilkhuwa (360s from previous)
    (route1_id, stop_ids_route1[3], 4, 600)   # Dasna (600s from previous)
]

for route_id, stop_id, order, travel_sec in route_stop_data_route1:
    conn.execute("""
        INSERT INTO route_stop (route_id, stop_id, stop_order, avg_travel_seconds)
        VALUES (?, ?, ?, ?)
    """, (route_id, stop_id, order, travel_sec))

# ====================================================================
# COMMIT AND CLOSE
# ====================================================================
conn.commit()
conn.close()

print("✅ Database seeded successfully with leader's fieldwork data!")