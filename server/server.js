const express = require('express');
const cors = require('cors');

const bodyParser = require('body-parser');
const path = require('path');
const authRoutes = require('./auth');
const db = require('./db');


const app = express();

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(authRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', authRoutes);

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
