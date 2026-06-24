const express = require('express');
const router = express.Router();
const db = require('./db');
const { v4: uuidv4 } = require('uuid');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');

function generateBoardCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function getNow() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString('en-GB', {
        hour12: false,
        timeZone: 'Asia/Kolkata'
    });
    return { date, time };
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── helper: normalize any credential ID to base64url string ─────────
function toBase64url(value) {
    if (typeof value === 'string') {
        return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
    return Buffer.from(value).toString('base64url');
}

// ─── LOGIN ───────────────────────────────────────────────────────────
router.post('/api/login', (req, res) => {
    const { username, identifier, role, fingerprint } = req.body;
    const table = role === 'student' ? 'students' : 'faculty';
    const column = role === 'student' ? 'reg_number' : 'faculty_id';

    db.get(
        `SELECT * FROM ${table} WHERE name = ? AND ${column} = ?`,
        [username, identifier],
        (err, row) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            if (!row) return res.status(401).json({ success: false, message: 'Invalid credentials' });

            if (role !== 'student') {
                return res.json({ success: true, role, name: row.name, identifier });
            }

            db.get(
                `SELECT * FROM device_fingerprints WHERE reg_number = ?`,
                [identifier],
                (err, fpRow) => {
                    if (err) return res.status(500).json({ success: false, message: 'Database error' });

                    if (!fpRow) {
                        db.run(
                            `INSERT INTO device_fingerprints (reg_number, fingerprint, registered_at)
                             VALUES (?, ?, ?)`,
                            [identifier, fingerprint, Date.now()],
                            (err) => {
                                if (err) return res.status(500).json({ success: false, message: 'Failed to register device' });
                                res.json({ success: true, role, name: row.name, identifier, deviceRegistered: true });
                            }
                        );
                    } else {
                        if (fpRow.fingerprint !== fingerprint) {
                            return res.status(401).json({
                                success: false,
                                message: 'This account is registered to a different device. Please use your registered device.'
                            });
                        }
                        res.json({ success: true, role, name: row.name, identifier, deviceRegistered: false });
                    }
                }
            );
        }
    );
});

// ─── SIGNUP ──────────────────────────────────────────────────────────
router.post('/api/signup', (req, res) => {
    const { username, identifier, role } = req.body;
    if (!username || !identifier || !role)
        return res.status(400).json({ success: false, message: 'Missing fields' });

    const table = role === 'student' ? 'students' : 'faculty';
    const column = role === 'student' ? 'reg_number' : 'faculty_id';

    db.get(`SELECT * FROM ${table} WHERE ${column} = ?`, [identifier], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (row) return res.status(400).json({ success: false, message: `${role} already registered` });

        db.run(
            `INSERT INTO ${table} (name, ${column}) VALUES (?, ?)`,
            [username, identifier],
            function (err) {
                if (err) return res.status(500).json({ success: false, message: 'Registration failed' });
                res.json({ success: true, message: 'Registered successfully' });
            }
        );
    });
});

// ─── SET CLASSROOM LOCATION ───────────────────────────────────────────
router.post('/api/set-classroom-location', (req, res) => {
    const { classroom_id, latitude, longitude, faculty_id, radius } = req.body;

    if (!classroom_id || !latitude || !longitude || !faculty_id)
        return res.status(400).json({ success: false, message: 'Missing fields' });

    db.run(
        `INSERT INTO classrooms (classroom_id, center_lat, center_lng, radius, set_by, set_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(classroom_id) DO UPDATE SET
         center_lat = excluded.center_lat,
         center_lng = excluded.center_lng,
         radius = excluded.radius,
         set_by = excluded.set_by,
         set_at = excluded.set_at`,
        [classroom_id, latitude, longitude, radius || 30, faculty_id, Date.now()],
        function (err) {
            if (err) return res.status(500).json({ success: false, message: 'Failed to save location' });
            res.json({
                success: true,
                message: `Location set for ${classroom_id}`,
                latitude,
                longitude,
                radius: radius || 30
            });
        }
    );
});

// ─── START ATTENDANCE ─────────────────────────────────────────────────
router.post('/api/start-attendance', (req, res) => {
    const { faculty_id, classroom, timeLimit } = req.body;

    if (!faculty_id || !classroom || !timeLimit)
        return res.status(400).json({ success: false, message: 'Missing fields' });

    db.get(
        `SELECT * FROM classrooms WHERE classroom_id = ?`,
        [classroom],
        (err, classroomRow) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            if (!classroomRow)
                return res.status(400).json({
                    success: false,
                    message: 'Classroom location not set. Please set your location first.'
                });

            db.run(
                `UPDATE sessions SET is_active = 0 WHERE classroom = ? AND is_active = 1`,
                [classroom],
                (err) => {
                    if (err) return res.status(500).json({ success: false, message: 'Database error' });

                    const token = uuidv4();
                    const boardCode = generateBoardCode();
                    const startTime = Date.now();
                    const expiryTime = startTime + timeLimit * 60 * 1000;

                    db.run(
                        `INSERT INTO sessions (token, board_code, classroom, started_by, start_time, expiry_time, is_active)
                         VALUES (?, ?, ?, ?, ?, ?, 1)`,
                        [token, boardCode, classroom, faculty_id, startTime, expiryTime],
                        function (err) {
                            if (err) return res.status(500).json({ success: false, message: 'Failed to create session' });
                            res.json({
                                success: true,
                                token,
                                boardCode,
                                classroom,
                                expiryTime,
                                message: `Attendance started for ${timeLimit} minute(s). Board code: ${boardCode}`
                            });
                        }
                    );
                }
            );
        }
    );
});

// ─── ACTIVE SESSION (student polls this) ─────────────────────────────
router.get('/api/active-session', (req, res) => {
    const classroom = req.query.classroom;
    if (!classroom)
        return res.status(400).json({ success: false, message: 'Classroom required' });

    const now = Date.now();

    db.get(
        `SELECT * FROM sessions
         WHERE classroom = ? AND is_active = 1 AND expiry_time > ?
         ORDER BY start_time DESC LIMIT 1`,
        [classroom, now],
        (err, row) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            if (!row) return res.sendStatus(204);
            res.json({ token: row.token, boardCode: row.board_code, expiryTime: row.expiry_time });
        }
    );
});

// ─── MARK ATTENDANCE ──────────────────────────────────────────────────
router.post('/api/mark-attendance', (req, res) => {
    const { reg_number, latitude, longitude, classroom, boardCode, sessionToken, fingerprint, rssi } = req.body;

    if (!reg_number || !latitude || !longitude || !classroom || !boardCode || !sessionToken || !fingerprint)
        return res.status(400).json({ success: false, message: 'Missing fields' });

    const now = Date.now();
    const { date, time } = getNow();

    // Step 0 — Validate device fingerprint (L2)
    db.get(
        `SELECT * FROM device_fingerprints WHERE reg_number = ?`,
        [reg_number],
        (err, fpRow) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            if (!fpRow) return res.status(400).json({ success: false, message: 'Device not registered. Please log in first.' });
            if (fpRow.fingerprint !== fingerprint)
                return res.status(400).json({ success: false, message: 'Wrong device. Please use your registered device.' });

            // Step 1 — Validate session (L3)
            db.get(
                `SELECT * FROM sessions
                 WHERE token = ? AND classroom = ? AND is_active = 1 AND expiry_time > ?`,
                [sessionToken, classroom, now],
                (err, session) => {
                    if (err) return res.status(500).json({ success: false, message: 'Database error' });
                    if (!session)
                        return res.status(400).json({ success: false, message: 'No active session — time may have expired' });

                    // Step 1.5 — BLE RSSI proximity check (L5)
                    // rssi is sent by the student's phone after connecting to the ESP32 beacon.
                    // The ESP32 advertises its name as the classroom ID (e.g. "AB3").
                    // Threshold: -90 dBm — anything weaker means the student is too far away.
                    if (rssi === undefined || rssi === null)
                        return res.status(400).json({ success: false, message: 'BLE proximity check missing — make sure Bluetooth is enabled.' });

                    const rssiValue = Number(rssi);
                    if (isNaN(rssiValue) || rssiValue < -90)
                        return res.status(400).json({
                            success: false,
                            message: `BLE signal too weak (${rssiValue} dBm). You must be inside the classroom.`
                        });

                    // Step 2 — Validate board code (L6)
                    if (session.board_code !== boardCode)
                        return res.status(400).json({ success: false, message: 'Wrong board code' });

                    // Step 3 — Get classroom location and GPS distance check (L4)
                    db.get(
                        `SELECT * FROM classrooms WHERE classroom_id = ?`,
                        [classroom],
                        (err, classroomRow) => {
                            if (err) return res.status(500).json({ success: false, message: 'Database error' });
                            if (!classroomRow)
                                return res.status(400).json({ success: false, message: 'Classroom location not found' });

                            const distance = getDistanceMeters(
                                latitude, longitude,
                                classroomRow.center_lat, classroomRow.center_lng
                            );

                            if (distance > classroomRow.radius)
                                return res.status(400).json({
                                    success: false,
                                    message: `You are ${Math.round(distance)}m away. Must be within ${classroomRow.radius}m.`
                                });

                            // Step 4 — Insert attendance, block duplicate (L8)
                            db.run(
                                `INSERT INTO attendance (reg_number, session_id, date, time, status)
                                 VALUES (?, ?, ?, ?, 'Present')`,
                                [reg_number, session.id, date, time],
                                function (err) {
                                    if (err) {
                                        if (err.message.includes('UNIQUE constraint failed'))
                                            return res.status(400).json({ success: false, message: 'Attendance already marked for this session' });
                                        return res.status(500).json({ success: false, message: 'Database error' });
                                    }

                                    db.run(
                                        `INSERT INTO location (reg_number, latitude, longitude, date, time)
                                         VALUES (?, ?, ?, ?, ?)`,
                                        [reg_number, latitude, longitude, date, time]
                                    );

                                    res.json({
                                        success: true,
                                        message: `Attendance marked. You were ${Math.round(distance)}m from classroom.`,
                                        date,
                                        time
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// ─── VIEW ATTENDANCE (student) ─────────────────────────────────────────
router.post('/api/view-attendance', (req, res) => {
    const { reg_number } = req.body;
    db.all(
        `SELECT a.date, a.time, a.status, s.classroom
         FROM attendance a
         JOIN sessions s ON a.session_id = s.id
         WHERE a.reg_number = ?
         ORDER BY datetime(a.date || ' ' || a.time) DESC`,
        [reg_number],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            res.json({ success: true, attendance: rows });
        }
    );
});

// ─── VIEW ATTENDANCE (faculty) ─────────────────────────────────────────
router.post('/api/faculty-view-attendance', (req, res) => {
    const { classroom } = req.body;
    const date = new Date().toISOString().split('T')[0];

    db.all(
        `SELECT st.name, st.reg_number, a.time, a.date, s.classroom
         FROM attendance a
         JOIN students st ON a.reg_number = st.reg_number
         JOIN sessions s ON a.session_id = s.id
         WHERE a.date = ? AND a.status = 'Present' AND s.classroom = ?
         ORDER BY a.time ASC`,
        [date, classroom],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            res.json({ success: true, attendance: rows });
        }
    );
});

// ─── CHECK PROXY ───────────────────────────────────────────────────────
router.get('/api/check-proxy', (req, res) => {
    const date = new Date().toISOString().split('T')[0];
    const classroom = req.query.classroom;

    db.all(
        `SELECT st.name, st.reg_number, l.latitude, l.longitude, l.time
         FROM attendance a
         JOIN students st ON a.reg_number = st.reg_number
         JOIN sessions s ON a.session_id = s.id
         JOIN location l ON l.reg_number = st.reg_number AND l.date = ?
         WHERE a.date = ? AND a.status = 'Present' AND s.classroom = ?
         ORDER BY a.time ASC`,
        [date, date, classroom],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            res.json({ success: true, locations: rows });
        }
    );
});

// ─── TEMP RESET ROUTE (remove after use) ─────────────────────────────
router.get('/api/reset-db', (req, res) => {
    const tables = ['attendance', 'location', 'sessions', 'device_fingerprints', 'classrooms', 'students', 'faculty', 'webauthn_credentials'];
    let done = 0;
    tables.forEach(table => {
        db.run(`DELETE FROM ${table}`, () => {
            done++;
            if (done === tables.length) {
                res.json({ success: true, message: 'All data cleared' });
            }
        });
    });
});

// ─── WEBAUTHN REGISTRATION OPTIONS ───────────────────────────────────
router.post('/api/webauthn/register-options', async (req, res) => {
    const { reg_number, name } = req.body;
    if (!reg_number || !name)
        return res.status(400).json({ success: false, message: 'Missing fields' });

    try {
        const options = await generateRegistrationOptions({
            rpName: 'Smart Attendance System',
            rpID: 'attendance-webauthfix.onrender.com',
            userID: new TextEncoder().encode(reg_number),
            userName: reg_number,
            userDisplayName: name,
            attestationType: 'none',
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
                residentKey: 'preferred'
            },
            timeout: 60000,
        });

        db.run(
            `INSERT INTO webauthn_credentials (reg_number, credential_id, public_key, current_challenge, counter, registered_at)
             VALUES (?, 'pending', 'pending', ?, 0, ?)
             ON CONFLICT(reg_number) DO UPDATE SET
             credential_id = 'pending',
             public_key = 'pending',
             current_challenge = ?`,
            [reg_number, options.challenge, Date.now(), options.challenge],
            (err) => {
                if (err) {
                    console.error('Insert error:', err);
                    return res.status(500).json({ success: false, message: 'DB error saving challenge' });
                }
                res.json({ success: true, options });
            }
        );
    } catch (err) {
        console.error('WebAuthn register options error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate registration options' });
    }
});

// ─── WEBAUTHN REGISTRATION VERIFY ────────────────────────────────────
router.post('/api/webauthn/register-verify', async (req, res) => {
    const { reg_number, response } = req.body;
    if (!reg_number || !response)
        return res.status(400).json({ success: false, message: 'Missing fields' });

    db.get(`SELECT * FROM webauthn_credentials WHERE reg_number = ?`, [reg_number], async (err, row) => {
        if (err || !row)
            return res.status(400).json({ success: false, message: 'No pending registration' });

        try {
            const verification = await verifyRegistrationResponse({
                response,
                expectedChallenge: row.current_challenge,
                expectedOrigin: 'https://attendance-webauthfix.onrender.com',
                expectedRPID: 'attendance-webauthfix.onrender.com',
                requireUserVerification: true,
            });

            if (!verification.verified)
                return res.status(400).json({ success: false, message: 'Fingerprint verification failed' });

            const info = verification.registrationInfo;
            const credentialID = info.credentialID || info.credential?.id;
            const credentialPublicKey = info.credentialPublicKey || info.credential?.publicKey;
            const counter = info.counter ?? info.credential?.counter ?? 0;

            const credIdStored = toBase64url(credentialID);
            const pubKeyStored = typeof credentialPublicKey === 'string'
                ? credentialPublicKey
                : Buffer.from(credentialPublicKey).toString('base64');

            db.run(
                `UPDATE webauthn_credentials SET
                 credential_id = ?,
                 public_key = ?,
                 current_challenge = NULL,
                 counter = ?
                 WHERE reg_number = ?`,
                [credIdStored, pubKeyStored, counter, reg_number],
                (err) => {
                    if (err) return res.status(500).json({ success: false, message: 'Failed to save credential' });
                    res.json({ success: true, message: 'Fingerprint registered successfully' });
                }
            );
        } catch (err) {
            console.error('WebAuthn register verify error:', err);
            res.status(500).json({ success: false, message: 'Registration verification failed: ' + err.message });
        }
    });
});

// ─── WEBAUTHN AUTHENTICATION OPTIONS ─────────────────────────────────
router.post('/api/webauthn/auth-options', async (req, res) => {
    const { reg_number } = req.body;
    if (!reg_number)
        return res.status(400).json({ success: false, message: 'Missing reg_number' });

    db.get(`SELECT * FROM webauthn_credentials WHERE reg_number = ? AND credential_id != 'pending'`, [reg_number], async (err, row) => {
        if (err || !row)
            return res.status(400).json({ success: false, message: 'No fingerprint registered' });

        try {
            const credIdBase64url = toBase64url(row.credential_id);

            const options = await generateAuthenticationOptions({
                rpID: 'attendance-webauthfix.onrender.com',
                allowCredentials: [{
                    id: credIdBase64url,
                    type: 'public-key',
                    transports: ['internal'],
                }],
                userVerification: 'required',
                timeout: 60000,
            });

            db.run(
                `UPDATE webauthn_credentials SET current_challenge = ? WHERE reg_number = ?`,
                [options.challenge, reg_number],
                (err) => {
                    if (err) {
                        console.error('Failed to save challenge:', err);
                        return res.status(500).json({ success: false, message: 'DB error' });
                    }
                    res.json({ success: true, options });
                }
            );
        } catch (err) {
            console.error('WebAuthn auth options error:', err);
            res.status(500).json({ success: false, message: 'Failed to generate auth options: ' + err.message });
        }
    });
});

// ─── WEBAUTHN AUTHENTICATION VERIFY ──────────────────────────────────
router.post('/api/webauthn/auth-verify', async (req, res) => {
    const { reg_number, response } = req.body;
    if (!reg_number || !response)
        return res.status(400).json({ success: false, message: 'Missing fields' });

    db.get(`SELECT * FROM webauthn_credentials WHERE reg_number = ?`, [reg_number], async (err, row) => {
        if (err || !row)
            return res.status(400).json({ success: false, message: 'No credential found' });

        try {
            const credIdBytes = new Uint8Array(Buffer.from(row.credential_id, 'base64url'));
            const pubKeyBytes = new Uint8Array(Buffer.from(row.public_key, 'base64'));

            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge: row.current_challenge,
                expectedOrigin: 'https://attendance-webauthfix.onrender.com',
                expectedRPID: 'attendance-webauthfix.onrender.com',
                authenticator: {
                    credentialID: credIdBytes,
                    credentialPublicKey: pubKeyBytes,
                    counter: row.counter,
                },
                requireUserVerification: true,
            });

            if (!verification.verified)
                return res.status(400).json({ success: false, message: 'Fingerprint not recognized' });

            db.run(
                `UPDATE webauthn_credentials SET counter = ?, current_challenge = NULL WHERE reg_number = ?`,
                [verification.authenticationInfo.newCounter, reg_number]
            );

            res.json({ success: true, message: 'Fingerprint verified' });
        } catch (err) {
            console.error('WebAuthn auth verify error:', err);
            res.status(500).json({ success: false, message: 'Authentication failed: ' + err.message });
        }
    });
});

// ─── DEBUG ENDPOINT (remove before production) ────────────────────────
router.get('/api/debug-webauthn/:reg_number', (req, res) => {
    db.get(`SELECT reg_number, credential_id, counter, registered_at FROM webauthn_credentials WHERE reg_number = ?`,
        [req.params.reg_number],
        (err, row) => {
            res.json({
                row,
                err: err?.message,
                credential_id_type: typeof row?.credential_id,
                is_buffer: Buffer.isBuffer(row?.credential_id),
                credential_id_raw: row?.credential_id?.toString()
            });
        }
    );
});

module.exports = router;