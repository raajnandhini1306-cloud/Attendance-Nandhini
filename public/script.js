async function markAttendance() {
    const reg_number = localStorage.getItem('reg_number');
    if (!reg_number) {
        alert("Registration number not found. Please log in again.");
        return;
    }

    const classroom = prompt("Enter your classroom ID (e.g., 204b, 205a):");
    if (!classroom) {
        alert("Classroom ID is required.");
        return;
    }

    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        const response = await fetch('/api/mark-attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reg_number, latitude, longitude, classroom })
        });

        const data = await response.json();

        if (data.success) {
            alert(`Attendance marked! Date: ${data.date}, Time: ${data.time}`);
        } else {
            alert(data.message);
        }
    }, () => {
        alert("Unable to retrieve your location. Please allow location access.");
    });
}

async function viewAttendance() {
    const reg_number = localStorage.getItem('reg_number');
    if (!reg_number) {
        alert("Registration number not found. Please log in again.");
        return;
    }

    const response = await fetch('/api/view-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reg_number })
    });

    const data = await response.json();
    if (data.success) {
        let attendanceList = "<h3>Your Attendance</h3><ul>";
        data.attendance.forEach(record => {
            attendanceList += `<li>Date: ${record.date} Time: ${record.time} - Status: ${record.status}</li>`;
        });
        attendanceList += "</ul>";
        document.getElementById("attendanceList").innerHTML = attendanceList;
    } else {
        alert("Error fetching attendance.");
    }
}



async function startAttendance() {
    const timeLimitInput = document.getElementById("timeLimit").value;
    const timeLimit = parseInt(timeLimitInput);

    if (!timeLimit || timeLimit <= 0) {
        alert("Please enter a valid time limit in minutes.");
        return;
    }

    const response = await fetch('/api/start-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeLimit })
    });

    const data = await response.json();
    if (data.success) {
        alert("Attendance session started for " + timeLimit + " minute(s).");
    } else {
        alert("Error starting attendance.");
    }
}

async function facultyViewAttendance() {
    const response = await fetch('/api/faculty-view-attendance', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
        let html = "<h3>Grouped Attendance for Today</h3>";

        data.groupedAttendance.forEach((group, index) => {
            if (group.length === 0) return;

            html += `<h4>Group ${index + 1} - Date: ${group[0].date}</h4>`;
            html += "<table border='1'><tr><th>S.No</th><th>Reg Number</th><th>Name</th><th>Time</th></tr>";

            group.forEach((student, i) => {
                html += `<tr><td>${i + 1}</td><td>${student.reg_number}</td><td>${student.name}</td><td>${student.time}</td></tr>`;
            });

            html += "</table><br>";
        });

        document.getElementById("attendanceTable").innerHTML = html;
    } else {
        alert("Error fetching attendance.");
    }
}
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault(); 

        const username = document.getElementById('username').value;
        const identifier = document.getElementById('identifier').value;
        const role = document.getElementById('role').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, identifier, role })
            });

            const data = await response.json();
            
            if (data.success) {
                if (role === 'student') {
                    localStorage.setItem('reg_number', identifier);
                    window.location.href = 'student_dashboard.html';
                } else if (role === 'faculty') {
                    window.location.href = 'faculty_dashboard.html';
                }
            } else {
                alert(data.message); 
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Server error, please try again.');
        }
    });

    document.getElementById('signupButton').addEventListener('click', async () => {
        const username = document.getElementById('username').value;
        const identifier = document.getElementById('identifier').value;
        const role = document.getElementById('role').value;

        if (!username || !identifier) {
            alert('Please fill out all fields.');
            return;
        }

        try {
            const response = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, identifier, role })
            });

            const data = await response.json();
            if (data.success) {
                alert('Signup successful! You can now log in.');
            } else {
                alert(data.message);
            }
        } catch (error) {
            console.error('Signup error:', error);
            alert('Server error during signup.');
        }
    });
});
