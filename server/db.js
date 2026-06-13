const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
    } else {
        console.log("Connected to SQLite database");

        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            reg_number TEXT UNIQUE NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS faculty (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            faculty_id TEXT UNIQUE NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS classrooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            classroom_id TEXT UNIQUE NOT NULL,
            center_lat REAL NOT NULL,
            center_lng REAL NOT NULL,
            radius INTEGER DEFAULT 30,
            set_by TEXT NOT NULL,
            set_at INTEGER NOT NULL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS device_fingerprints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reg_number TEXT UNIQUE NOT NULL,
                fingerprint TEXT NOT NULL,
                registered_at INTEGER NOT NULL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reg_number TEXT UNIQUE NOT NULL,
        credential_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        current_challenge TEXT,
        counter INTEGER DEFAULT 0,
        registered_at INTEGER NOT NULL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            board_code TEXT NOT NULL,
            classroom TEXT NOT NULL,
            started_by TEXT NOT NULL,
            start_time INTEGER NOT NULL,
            expiry_time INTEGER NOT NULL,
            is_active INTEGER DEFAULT 1
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reg_number TEXT NOT NULL,
            session_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            status TEXT NOT NULL,
            UNIQUE(reg_number, session_id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS location (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reg_number TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL
        )`);

        console.log("All tables ready");
    }
});

module.exports = db;
