// generateArea.js
// Creates a 10m x 10m geofence polygon around a center point

const fs = require('fs');

// === ✏️ EDIT these 3 lines for each new area ===
const name = "AB3";   // Name of the area
const center = { lat: 12.841233, lng: 80.154600 }; // Your single GPS point
const offsetMeters = 10;     // Half-width of the area in meters (10 = 10m)

// =================================================

// Convert meters to degrees (approx, good enough for small distances)
const meterToDegLat = offsetMeters / 111320;
const meterToDegLng = offsetMeters / (111320 * Math.cos(center.lat * Math.PI / 180));

// Build the 4 rectangle corners clockwise
const polygon = [
  { lat: center.lat - meterToDegLat, lng: center.lng - meterToDegLng },
  { lat: center.lat - meterToDegLat, lng: center.lng + meterToDegLng },
  { lat: center.lat + meterToDegLat, lng: center.lng + meterToDegLng },
  { lat: center.lat + meterToDegLat, lng: center.lng - meterToDegLng }
];

// Load and update allowedArea.json
const filePath = './allowedArea.json';
const areas = JSON.parse(fs.readFileSync(filePath, 'utf8'));
areas[name] = polygon;

// Save back prettified
fs.writeFileSync(filePath, JSON.stringify(areas, null, 2));
console.log(`✅ Added ${name} area with polygon:`, polygon);
