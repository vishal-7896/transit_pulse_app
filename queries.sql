-- queries.sql — Hand these over to Person 1 (Backend)
-- Verified and tested by Person 3 (Database) ✓

-- QUERY 1: Get all stops for a route in order
-- Used by: GET /routes/<route_id>/stops
SELECT rs.id as route_stop_id, rs.stop_order,
       s.name, s.landmark, rs.avg_travel_seconds
FROM route_stop rs
JOIN stop s ON rs.stop_id = s.id
WHERE rs.route_id = ?
ORDER BY rs.stop_order;

-- QUERY 2: Get last sighting on a route (no stop_order filter)
-- Used by: GET /eta/<route_id> to find bus location
SELECT rs.id as route_stop_id, rs.stop_order, 
       s.seen_at, s.direction
FROM sighting s
JOIN route_stop rs ON s.route_stop_id = rs.id
WHERE rs.route_id = ?
ORDER BY s.seen_at DESC
LIMIT 1;

-- QUERY 3: Sum travel seconds between two stops
-- Used by: ETA calculation formula
SELECT COALESCE(SUM(avg_travel_seconds), 0) as total_seconds
FROM route_stop
WHERE route_id = ?
AND stop_order > ?
AND stop_order <= ?;