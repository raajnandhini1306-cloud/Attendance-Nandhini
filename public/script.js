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

// ─── WEBAUTHN REGISTRATION ────────────────────────────────────────────
async function registerFingerprint(reg_number, name) {
    try {
        // Get registration options from server
        const optRes = await fetch('/api/webauthn/register-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reg_number, name })
        });
        const optData = await optRes.json();
const options = optData.options;
if (!options) {
    alert('No options returned from server');
    return false;
}

// v13 returns challenge as base64url string — decode it
options.challenge = base64ToBuffer(options.challenge);
options.user.id = typeof options.user.id === 'string' 
    ? base64ToBuffer(options.user.id)
    : options.user.id;

        // Prompt fingerprint
        const credential = await navigator.credentials.create({ publicKey: options });

        // Send response to server
        const verifyRes = await fetch('/api/webauthn/register-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reg_number,
                response: {
                    id: credential.id,
                    rawId: bufferToBase64(credential.rawId),
                    response: {
                        clientDataJSON: bufferToBase64(credential.response.clientDataJSON),
                        attestationObject: bufferToBase64(credential.response.attestationObject),
                    },
                    type: credential.type,
                }
            })
        });

        const result = await verifyRes.json();
        return result.success;
    } catch (err) {
        console.error('Fingerprint registration error:', err);
        alert('Registration error: ' + err.message);
        return false;
    }
}

// ─── WEBAUTHN AUTHENTICATION ──────────────────────────────────────────
async function verifyFingerprint(reg_number) {
    try {
        // Get auth options from server
        const optRes = await fetch('/api/webauthn/auth-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reg_number })
        });

        if (!optRes.ok) return false;
        const { options } = await optRes.json();

        // Decode challenge and credential
        options.challenge = base64ToBuffer(options.challenge);
        options.allowCredentials = options.allowCredentials.map(cred => ({
            ...cred,
            id: base64ToBuffer(cred.id)
        }));

        // Prompt fingerprint
        const assertion = await navigator.credentials.get({ publicKey: options });

        // Send response to server
        const verifyRes = await fetch('/api/webauthn/auth-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reg_number,
                response: {
                    id: assertion.id,
                    rawId: bufferToBase64(assertion.rawId),
                    response: {
                        clientDataJSON: bufferToBase64(assertion.response.clientDataJSON),
                        authenticatorData: bufferToBase64(assertion.response.authenticatorData),
                        signature: bufferToBase64(assertion.response.signature),
                        userHandle: assertion.response.userHandle
                            ? bufferToBase64(assertion.response.userHandle)
                            : null,
                    },
                    type: assertion.type,
                }
            })
        });

        const result = await verifyRes.json();
        return result.success;
    } catch (err) {
        console.error('Fingerprint verification error:', err);
        return false;
    }
}

// ─── BASE64 HELPERS ───────────────────────────────────────────────────
function base64ToBuffer(base64) {
    const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    return buffer.buffer;
}

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

    // Register fingerprint for students on first login
   // Register fingerprint for students
if (role === 'student') {
    // Check if fingerprint already registered
    const checkRes = await fetch('/api/webauthn/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reg_number: identifier })
    });

    if (!checkRes.ok) {
        // No fingerprint registered yet — register now
        alert('Please scan your fingerprint to register it for attendance verification.');
        const registered = await registerFingerprint(identifier, username);
        if (registered) {
            alert('Fingerprint registered successfully.');
        } else {
            alert('Fingerprint registration failed or skipped.');
        }
    }
    // If ok — fingerprint already registered, skip
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

    // Verify fingerprint before submitting
    const fingerprintVerified = await verifyFingerprint(reg_number);
    if (!fingerprintVerified) {
        alert('Fingerprint verification failed. Attendance not marked.');
        return;
    }

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