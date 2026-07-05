   # seed.py — Insert real route data from fieldwork into the database
# TEMPLATE: Replace all placeholder values with actual data from group leader
# Run once with: python seed.py
# Then open DB Browser to verify the data appears

import sqlite3

conn = sqlite3.connect('transitpulse.db')

# ====================================================================
# ROUTE 1 — Actual route data from group leader's fieldwork
# Replace all placeholder values below with real data
# ====================================================================

# Step 1: Insert the first route
# TODO: Replace these values with actual route from group leader
ROUTE1_NAME = "Route 14"  # Bus route number/name
ROUTE1_START = "College Gate"  # Starting terminus
ROUTE1_END = "Bus Terminal"  # Ending terminus
ROUTE1_FREQUENCY = 20  # Minutes between buses

conn.execute("""
    INSERT INTO route (name, start_terminus, end_terminus, frequency_minutes)
    VALUES (?, ?, ?, ?)
""", (ROUTE1_NAME, ROUTE1_START, ROUTE1_END, ROUTE1_FREQUENCY))

route1_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

# Step 2: Insert stops for Route 1
# TODO: Replace with actual stop names and landmarks from fieldwork
# Format: (stop_name, landmark_description)
# Get these from group leader's fieldwork notes
stops_route1 = [
    ("Stop 1 Name", "Landmark near Stop 1"),
    ("Stop 2 Name", "Landmark near Stop 2"),
    ("Stop 3 Name", "Landmark near Stop 3"),
]

stop_ids_route1 = []
for stop_name, landmark in stops_route1:
    conn.execute("""
        INSERT INTO stop (name, landmark)
        VALUES (?, ?)
    """, (stop_name, landmark))
    stop_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    stop_ids_route1.append(stop_id)

# Step 3: Link stops to route with measured travel times
# TODO: Replace travel seconds with actual measurements from fieldwork
# Format: (route_id, stop_id, stop_order, avg_travel_seconds)
# 
# IMPORTANT: 
# - stop_order: 1, 2, 3, 4... in sequence
# - avg_travel_seconds: Time from PREVIOUS stop to THIS stop (in seconds)
# - First stop should have 0 (no travel to get there)
# - Second stop: time from Stop 1 to Stop 2
# - Example: If Stop 1 to Stop 2 takes 8.5 minutes, that's 510 seconds
#
# Get these numbers from group leader's measured travel times

route_stop_data_route1 = [
    (route1_id, stop_ids_route1[0], 1, 0),           # Stop 1: 0 seconds (starting point)
    (route1_id, stop_ids_route1[1], 2, 510),         # Stop 2: XXX seconds from Stop 1 [REPLACE 510]
    (route1_id, stop_ids_route1[2], 3, 405),         # Stop 3: XXX seconds from Stop 2 [REPLACE 405]
]

for route_id, stop_id, order, travel_sec in route_stop_data_route1:
    conn.execute("""
        INSERT INTO route_stop (route_id, stop_id, stop_order, avg_travel_seconds)
        VALUES (?, ?, ?, ?)
    """, (route_id, stop_id, order, travel_sec))

# ====================================================================
# ROUTE 2 — Second actual route from group leader's fieldwork
# Replace all placeholder values below with real data
# ====================================================================

# Repeat the same process for your second route

# Step 1: Insert the second route
# TODO: Replace these values with actual route from group leader
ROUTE2_NAME = "Route 7"  # Bus route number/name
ROUTE2_START = "Market Square"  # Starting terminus
ROUTE2_END = "Training Center"  # Ending terminus
ROUTE2_FREQUENCY = 15  # Minutes between buses

conn.execute("""
    INSERT INTO route (name, start_terminus, end_terminus, frequency_minutes)
    VALUES (?, ?, ?, ?)
""", (ROUTE2_NAME, ROUTE2_START, ROUTE2_END, ROUTE2_FREQUENCY))

route2_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

# Step 2: Insert stops for Route 2
# TODO: Replace with actual stop names and landmarks from fieldwork
stops_route2 = [
    ("Stop 1 Name", "Landmark near Stop 1"),
    ("Stop 2 Name", "Landmark near Stop 2"),
    ("Stop 3 Name", "Landmark near Stop 3"),
]

stop_ids_route2 = []
for stop_name, landmark in stops_route2:
    conn.execute("""
        INSERT INTO stop (name, landmark)
        VALUES (?, ?)
    """, (stop_name, landmark))
    stop_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    stop_ids_route2.append(stop_id)

# Step 3: Link stops to route with measured travel times
# TODO: Replace travel seconds with actual measurements from fieldwork
route_stop_data_route2 = [
    (route2_id, stop_ids_route2[0], 1, 0),           # Stop 1: 0 seconds
    (route2_id, stop_ids_route2[1], 2, 420),         # Stop 2: XXX seconds from Stop 1 [REPLACE 420]
    (route2_id, stop_ids_route2[2], 3, 380),         # Stop 3: XXX seconds from Stop 2 [REPLACE 380]
]

for route_id, stop_id, order, travel_sec in route_stop_data_route2:
    conn.execute("""
        INSERT INTO route_stop (route_id, stop_id, stop_order, avg_travel_seconds)
        VALUES (?, ?, ?, ?)
    """, (route_id, stop_id, order, travel_sec))

# ====================================================================
# COMMIT AND DONE
# ====================================================================

conn.commit()
conn.close()

print('✅ Database seeded successfully!')
print('Open DB Browser to verify your data appears in all tables.')
print('')
print('If you see errors:')
print('  1. Check that transitpulse.db is in the same folder as this script')
print('  2. Verify all route names, stop names, and travel times are filled in')
print('  3. Make sure travel times are in SECONDS (not minutes)')