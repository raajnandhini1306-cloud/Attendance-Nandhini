// ─── DEVICE FINGERPRINT ───────────────────────────────────────────────
async function getFingerprint() {
    const raw = [
        navigator.userAgent,
        screen.width + 'x' + screen.height,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.language,
        screen.colorDepth
    ].join('|');

    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── SET CLASSROOM LOCATION (faculty) ────────────────────────────────
async function setClassroomLocation() {
    const classroom = document.getElementById('classroomId').value.trim();
    const faculty_id = localStorage.getItem('reg_number');

    if (!classroom)
        return alert('Enter classroom ID first.');

    if (!navigator.geolocation)
        return alert('Geolocation not supported.');

    document.getElementById('locationStatus').textContent = 'Getting your location...';

    navigator.geolocation.getCurrentPosition(async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        const res = await fetch('/api/set-classroom-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ classroom_id: classroom, latitude, longitude, faculty_id, radius: 30 })
        });

        const data = await res.json();
        if (data.success) {
            document.getElementById('locationStatus').textContent =
                `Location set: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} — radius ${data.radius}m`;
        } else {
            document.getElementById('locationStatus').textContent = data.message;
        }
    }, () => {
        document.getElementById('locationStatus').textContent = 'Location access denied.';
    });
}

// ─── LOGIN ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const identifier = document.getElementById('identifier').value;
        const role = document.getElementById('role').value;

        try {
            const fingerprint = await getFingerprint();

            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, identifier, role, fingerprint })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('reg_number', identifier);
                localStorage.setItem('role', role);
                localStorage.setItem('name', username);
                if (data.deviceRegistered) {
                    alert('Device registered successfully. This device is now linked to your account.');
                }
                window.location.href = role === 'student'
                    ? 'student_dashboard.html'
                    : 'faculty_dashboard.html';
            } else {
                alert(data.message);
            }
        } catch (err) {
            alert('Server error. Please try again.');
        }
    });

    document.getElementById('signupButton').addEventListener('click', async () => {
        const username = document.getElementById('username').value;
        const identifier = document.getElementById('identifier').value;
        const role = document.getElementById('role').value;

        if (!username || !identifier)
            return alert('Please fill all fields.');

        try {
            const res = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, identifier, role })
            });
            const data = await res.json();
            alert(data.success ? 'Signup successful! You can now log in.' : data.message);
        } catch (err) {
            alert('Server error during signup.');
        }
    });
});

// ─── START ATTENDANCE (faculty) ──────────────────────────────────────
async function startAttendance() {
    const timeLimitInput = document.getElementById('timeLimit').value;
    const classroom = document.getElementById('classroomId').value;
    const faculty_id = localStorage.getItem('reg_number');
    const timeLimit = parseInt(timeLimitInput);

    if (!timeLimit || timeLimit <= 0)
        return alert('Please enter a valid time limit.');
    if (!classroom)
        return alert('Please enter classroom ID.');

    const res = await fetch('/api/start-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faculty_id, classroom, timeLimit })
    });

    const data = await res.json();
    if (data.success) {
        localStorage.setItem('sessionToken', data.token);
        localStorage.setItem('classroom', classroom);

        document.getElementById('boardCodeDisplay').innerHTML =
            `<h3>Board Code: <span style="color:#e74c3c; font-size:2em;">${data.boardCode}</span></h3>
             <p>Write this on the board. Expires in ${timeLimit} minute(s).</p>
             <p style="font-size:11px; color:#888; word-break:break-all;">Token: ${data.token}</p>`;

        startCountdown(data.expiryTime);
    } else {
        alert(data.message);
    }
}

// ─── COUNTDOWN TIMER ─────────────────────────────────────────────────
function startCountdown(expiryTime) {
    const timerEl = document.getElementById('countdownTimer');
    if (!timerEl) return;

    const interval = setInterval(() => {
        const remaining = Math.max(0, expiryTime - Date.now());
        const seconds = Math.ceil(remaining / 1000);
        timerEl.textContent = `Session closes in: ${seconds}s`;
        if (remaining <= 0) {
            clearInterval(interval);
            timerEl.textContent = 'Session expired';
            document.getElementById('boardCodeDisplay').innerHTML = '';
        }
    }, 1000);
}

// ─── AUTO FETCH SESSION TOKEN (student) ──────────────────────────────
async function fetchSessionToken() {
    const classroom = document.getElementById('classroomInput').value.trim();
    const statusEl = document.getElementById('tokenStatus');
    if (!classroom) return;

    statusEl.textContent = 'Checking for active session...';
    statusEl.style.color = '#888';

    const res = await fetch(`/api/active-session?classroom=${classroom}`);

    if (res.status === 204) {
        statusEl.textContent = 'No active session for this classroom.';
        statusEl.style.color = '#e74c3c';
        document.getElementById('sessionTokenInput').value = '';
        return;
    }

    const data = await res.json();
    if (data.token) {
        document.getElementById('sessionTokenInput').value = data.token;
        statusEl.textContent = 'Session found — enter board code and submit.';
        statusEl.style.color = '#27ae60';
    }
}

// ─── MARK ATTENDANCE (student) ───────────────────────────────────────
async function markAttendance() {
    const reg_number = localStorage.getItem('reg_number');
    if (!reg_number) return alert('Please log in again.');

    const classroom = document.getElementById('classroomInput').value.trim();
    const boardCode = document.getElementById('boardCodeInput').value.trim();
    const sessionToken = document.getElementById('sessionTokenInput').value.trim();

    if (!classroom || !boardCode || !sessionToken)
        return alert('Please fill all fields.');

    if (!navigator.geolocation)
        return alert('Geolocation not supported.');

    navigator.geolocation.getCurrentPosition(async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        const fingerprint = await getFingerprint();

        const res = await fetch('/api/mark-attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reg_number, latitude, longitude,
                classroom, boardCode, sessionToken, fingerprint
            })
        });

        const data = await res.json();
        alert(data.message);
    }, () => {
        alert('Location access denied. Please allow location.');
    });
}

// ─── VIEW ATTENDANCE (student) ───────────────────────────────────────
async function viewAttendance() {
    const reg_number = localStorage.getItem('reg_number');
    if (!reg_number) return alert('Please log in again.');

    const res = await fetch('/api/view-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reg_number })
    });

    const data = await res.json();
    if (!data.success) return alert('Error fetching attendance.');

    let html = '<h3>Your Attendance</h3><table border="1"><tr><th>Date</th><th>Time</th><th>Classroom</th><th>Status</th></tr>';
    data.attendance.forEach(r => {
        html += `<tr><td>${r.date}</td><td>${r.time}</td><td>${r.classroom}</td><td>${r.status}</td></tr>`;
    });
    html += '</table>';
    document.getElementById('attendanceList').innerHTML = html;
}

// ─── VIEW ATTENDANCE (faculty) ────────────────────────────────────────
async function facultyViewAttendance() {
    const classroom = localStorage.getItem('classroom');
    if (!classroom) return alert('No classroom set. Start attendance first.');

    const res = await fetch('/api/faculty-view-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroom })
    });

    const data = await res.json();
    if (!data.success) return alert('Error fetching attendance.');

    let html = `<h3>Attendance — ${classroom}</h3>
    <table border="1">
    <tr><th>S.No</th><th>Reg Number</th><th>Name</th><th>Time</th></tr>`;
    data.attendance.forEach((s, i) => {
        html += `<tr><td>${i + 1}</td><td>${s.reg_number}</td><td>${s.name}</td><td>${s.time}</td></tr>`;
    });
    html += '</table>';
    document.getElementById('attendanceTable').innerHTML = html;
}