const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const DB_FILE = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(DB_FILE);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'green-secret-please-change',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Serve frontend
app.use(express.static(path.join(__dirname, '../public')));

// Initialize DB tables if not present
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    done INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    reward TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Preload some tips table (optional simple file)
  db.run(`CREATE TABLE IF NOT EXISTS tips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tip TEXT
  )`, () => {
    db.get("SELECT COUNT(*) AS c FROM tips", (err, row) => {
      if (row && row.c === 0) {
        const tips = [
          "Turn off lights when leaving a room.",
          "Use a reusable bottle instead of single-use plastic.",
          "Take shorter showers to save water.",
          "Carry a cloth bag for shopping.",
          "Compost kitchen scraps if you can.",
          "Plant a native flower to help pollinators.",
          "Air dry clothes when possible to save energy."
        ];
        const stmt = db.prepare("INSERT INTO tips (tip) VALUES (?)");
        tips.forEach(t => stmt.run(t));
        stmt.finalize();
      }
    });
  });
});

// Helpers
function requireLogin(req, res, next){
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// Signup
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const hashed = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashed], function(err) {
    if (err) return res.status(400).json({ error: 'Username already exists' });
    req.session.userId = this.lastID;
    res.json({ success: true });
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid username or password' });
    req.session.userId = user.id;
    res.json({ success: true });
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not log out' });
    res.json({ success: true });
  });
});

// Get Task of the Day
app.get('/api/task', requireLogin, (req, res) => {
  // For simplicity the "task" is chosen by day of month mod number of tips + static text
  const tasks = [
    "Plant a seed or small plant 🌱",
    "Refill a reusable bottle instead of buying plastic",
    "Collect and compost kitchen scraps for 15 minutes",
    "Pick up 5 pieces of litter in your neighborhood",
    "Avoid single-use plastics for the whole day",
    "Use public transport or walk for one trip today"
  ];
  const idx = (new Date()).getDate() % tasks.length;
  const task = tasks[idx];
  res.json({ task });
});

// Mark task done (and award reward if first time today)
app.post('/api/task', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const today = (new Date()).toISOString().slice(0,10);
  db.get(`SELECT * FROM tasks WHERE user_id = ? AND date = ?`, [userId, today], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (row) return res.json({ message: 'Already completed today' });
    db.run(`INSERT INTO tasks (user_id, date, done) VALUES (?, ?, 1)`, [userId, today], function(err2){
      if (err2) return res.status(500).json({ error: 'DB insert error' });
      const rewardText = `Eco Star — completed task on ${today}`;
      db.run(`INSERT INTO rewards (user_id, reward) VALUES (?, ?)`, [userId, rewardText], function(err3){
        if (err3) return res.status(500).json({ error: 'DB insert error' });
        res.json({ success: true, reward: rewardText });
      });
    });
  });
});

// Get streak data (last N days)
app.get('/api/streak', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const DAYS = parseInt(req.query.days || '14', 10);
  const today = new Date();
  const days = [];
  for (let i = DAYS-1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().slice(0,10));
  }
  db.all(`SELECT date FROM tasks WHERE user_id = ? AND date >= ?`, [userId, days[0]], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const doneDates = new Set(rows.map(r => r.date));
    const values = days.map(d => doneDates.has(d) ? 1 : 0);
    res.json({ labels: days, values });
  });
});

// Get tips - tip of the day or all tips
app.get('/api/tip', (req, res) => {
  // Tip of the day chosen deterministically
  db.all(`SELECT * FROM tips ORDER BY id`, (err, rows) => {
    if (err || !rows || rows.length === 0) {
      return res.json({ tip: "Reduce, reuse, recycle." });
    }
    const idx = (new Date()).getDate() % rows.length;
    res.json({ tip: rows[idx].tip });
  });
});

// Get rewards for user
app.get('/api/rewards', requireLogin, (req, res) => {
  const userId = req.session.userId;
  db.all(`SELECT reward, created_at FROM rewards WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ rewards: rows.map(r => ({ text: r.reward, date: r.created_at })) });
  });
});

// Get current user status
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  db.get(`SELECT id, username FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
    if (err || !user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user });
  });
});

// Fallback to index page for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
