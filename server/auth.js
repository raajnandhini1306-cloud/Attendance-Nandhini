const express = require('express');
const router = express.Router();
const db = require('./db');

let attendanceStartTime = null;
let attendanceTimeLimit = null;

router.post('/start-attendance', (req, res) => {
    const { timeLimit } = req.body;

    if (!timeLimit || timeLimit <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid time limit' });
    }

    attendanceStartTime = Date.now();
    attendanceTimeLimit = timeLimit * 60 * 1000; 

    res.json({ success: true, message: `Attendance started for ${timeLimit} minute(s)` });
});

router.post('/mark-attendance', (req, res) => {
    const { reg_number, latitude, longitude, classroom } = req.body;
    const currentTime = Date.now();
    const now = new Date();
    const date = new Date().toISOString().split('T')[0];
    const time = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' });

    if (!attendanceStartTime || !attendanceTimeLimit) {
        return res.status(400).json({ success: false, message: 'Attendance has not started' });
    }

    const timeElapsed = currentTime - attendanceStartTime;
    let status = 'Absent'; 

    if (timeElapsed <= attendanceTimeLimit) {

        const point = { lat: latitude, lng: longitude };
        const allAreas = require('./allowedArea.json');
        const allowedArea = allAreas[classroom];

        if (!allowedArea) {
            return res.status(400).json({ success: false, message: 'Invalid classroom ID or area not defined' });
        }

        function isInsidePolygon(point, polygon) {
            let x = point.lat, y = point.lng;
            let inside = false;

            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                let xi = polygon[i].lat, yi = polygon[i].lng;
                let xj = polygon[j].lat, yj = polygon[j].lng;

                let intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-10) + xi);
                if (intersect) inside = !inside;
            }

            return inside;
        }

        const insideGeoFence = isInsidePolygon(point, allowedArea);
        status = insideGeoFence ? 'Present' : 'Absent';
    }

    db.run(
        `INSERT INTO attendance (reg_number, date, time, status) VALUES (?, ?, ?, ?)`,
        [reg_number, date, time, status],
        (err) => {
            if (err) {
                res.status(500).json({ success: false, message: 'Database error (attendance)' });
            } else {
                db.run(
                    `INSERT INTO location (reg_number, latitude, longitude, date, time) VALUES (?, ?, ?, ?, ?)`,
                    [reg_number, latitude, longitude, date, time],
                    (locErr) => {
                        if (locErr) {
                            res.status(500).json({ success: false, message: 'Database error (location)' });
                        } else {
                            let msg;
                            if (timeElapsed > attendanceTimeLimit) {
                                msg = 'Attendance session expired, marked as Absent';
                            } else {
                                msg = status === 'Present'
                                ? 'Attendance marked as Present (within allowed area)'
                                : `You are outside the allowed area — marked as Absent. Your location: (${latitude}, ${longitude})`;
                            }
                            res.json({ success: status === 'Present', message: msg, date, time });

                        }
                    }
                );
            }
        }
    );
});
const groupByTime = (records, interval = 2) => {
    const groups = [];
    let currentGroup = [];
    let lastTime = null;
    const seenRegNumbers = new Set(); // Set to track seen registration numbers

    records.forEach(record => {
        const [hours, minutes, seconds] = record.time.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + seconds / 60;

        // Check if the registration number has already been added in this group
        if (!seenRegNumbers.has(record.reg_number)) {
            if (!lastTime || (totalMinutes - lastTime) <= interval) {
                currentGroup.push(record);
                seenRegNumbers.add(record.reg_number); // Add to seen set
            } else {
                groups.push(currentGroup);
                currentGroup = [record];
                seenRegNumbers.clear(); // Clear seen set for the new group
                seenRegNumbers.add(record.reg_number);
            }
        }

        lastTime = totalMinutes;
    });

    if (currentGroup.length) {
        groups.push(currentGroup);
    }

    return groups;
};


router.post('/view-attendance', (req, res) => {
    const { reg_number } = req.body;
    db.all(`
        SELECT date, time, status 
        FROM attendance 
        WHERE reg_number = ? 
        ORDER BY datetime(date || ' ' || time) DESC
    `, [reg_number], (err, rows) => {
        if (err) {
            res.status(500).json({ message: 'Database error' });
        } else {
            res.json({ success: true, attendance: rows });
        }
    });    
});

// const groupByTime = (records, interval = 2) => {
//     const groups = [];
//     let currentGroup = [];
//     let lastTime = null;

//     records.forEach(record => {
//         const [hours, minutes, seconds] = record.time.split(':').map(Number);
//         const totalMinutes = hours * 60 + minutes + seconds / 60;

//         if (!lastTime || (totalMinutes - lastTime) <= interval) {
//             currentGroup.push(record);
//         } else {
//             groups.push(currentGroup);
//             currentGroup = [record];
//         }

//         lastTime = totalMinutes;
//     });

//     if (currentGroup.length) {
//         groups.push(currentGroup);
//     }

//     return groups;
// };

router.post('/faculty-view-attendance', (req, res) => {
    const date = new Date().toISOString().split('T')[0];

    db.all(`SELECT students.name, students.reg_number, attendance.time, attendance.date FROM attendance 
            JOIN students ON attendance.reg_number = students.reg_number 
            WHERE attendance.date = ? AND attendance.status = 'Present'
            ORDER BY attendance.time ASC`, [date], (err, rows) => {
        if (err) {
            res.status(500).json({ message: 'Database error' });
        } else {
            const grouped = groupByTime(rows);
            // Sort each group by reg_number
            grouped.forEach(group => {
                group.sort((a, b) => a.reg_number.localeCompare(b.reg_number));
            });
            res.json({ success: true, groupedAttendance: grouped });
        }
    });
});
router.get('/check-proxy', (req, res) => {
    const date = new Date().toISOString().split('T')[0];
    const groupIndex = parseInt(req.query.group || "1", 10) - 1;

    db.all(`
        SELECT s.name, s.reg_number, l.latitude, l.longitude, l.time, a.time AS attendance_time
        FROM attendance a
        JOIN students s ON s.reg_number = a.reg_number
        JOIN location l ON l.reg_number = s.reg_number AND l.date = ?
        WHERE a.date = ? AND a.status = 'Present'
        ORDER BY a.time ASC
    `, [date, date], (err, rows) => {
        if (err) {
            console.error(err);
            return res.json({ success: false, message: 'Database error' });
        }

        const grouped = groupByTime(rows); // already defined function
        if (groupIndex >= grouped.length) {
            return res.json({ success: true, locations: [] });
        }

        const selectedGroup = grouped[groupIndex] || [];
        // --- Filter to latest location per student ---
        const latestLocations = {};
        selectedGroup.forEach(record => {
            if (
                !latestLocations[record.reg_number] ||
                record.time > latestLocations[record.reg_number].time
            ) {
                latestLocations[record.reg_number] = record;
            }
        });
        const uniqueLocations = Object.values(latestLocations);

        res.json({ success: true, locations: uniqueLocations });
    });
});

// router.get('/api/check-proxy', (req, res) => {
//     const date = new Date().toISOString().split('T')[0];
//     console.log("Check proxy API called");
//     const sql = `
//         SELECT s.name, s.reg_number, l.latitude, l.longitude, l.time
//         FROM attendance a
//         JOIN students s ON s.reg_number = a.reg_number
//         JOIN (
//             SELECT reg_number, MAX(time) AS max_time
//             FROM location
//             WHERE date = ?
//             GROUP BY reg_number
//         ) latest ON latest.reg_number = a.reg_number
//         JOIN location l ON l.reg_number = latest.reg_number AND l.time = latest.max_time
//         WHERE a.date = ? AND a.status = 'Present'
//     `;

//     db.all(sql, [date, date], (err, rows) => {
//         if (err) {
//             console.error(err);
//             res.json({ success: false, message: 'Database error' });
//         } else {
//             res.json({ success: true, locations: rows });
//         }
//     });
// });


router.post('/login', (req, res) => {
    const { username, identifier, role } = req.body;
    const table = role === 'student' ? 'students' : 'faculty';
    const column = role === 'student' ? 'reg_number' : 'faculty_id';

    console.log(`Login Attempt - Name: ${username}, ID: ${identifier}, Role: ${role}`);

    db.get(`SELECT * FROM ${table} WHERE name = ? AND ${column} = ?`, [username, identifier], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            res.status(500).json({ success: false, message: 'Database error' });
        } else if (row) {
            console.log("Login successful for:", row);
            res.json({ success: true, role });
        } else {
            console.log("Invalid credentials");
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    });
});
router.post('/signup', (req, res) => {
    const { username, identifier, role } = req.body;

    if (!username || !identifier || !role) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const table = role === 'student' ? 'students' : 'faculty';
    const column = role === 'student' ? 'reg_number' : 'faculty_id';

    db.get(`SELECT * FROM ${table} WHERE ${column} = ?`, [identifier], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (row) {
            return res.status(400).json({ success: false, message: `${role.charAt(0).toUpperCase() + role.slice(1)} already registered` });
        }

        db.run(`INSERT INTO ${table} (name, ${column}) VALUES (?, ?)`, [username, identifier], function (err) {
            if (err) {
                console.error("Insert error:", err.message);
                return res.status(500).json({ success: false, message: `Failed to register ${role}` });
            }

            console.log(`${role} registered:`, { id: this.lastID, name: username, identifier });
            res.json({ success: true });
        });
    });
});


module.exports = router;
