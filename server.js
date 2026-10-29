// BookIt backend for "Glow Studio" salon: Node + Express + SQLite (built into Node 22.13+)
// Run:  npm install  then  npm start  ->  http://localhost:3000
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const rules = require('./public/rules.js');   // opening hours + slot maths, shared with the frontend

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'bookit.db');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(9).toString('base64url');

// ===== 1. Database =====
if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS services (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    minutes INTEGER NOT NULL,              -- always a multiple of 30
    price   INTEGER NOT NULL,              -- in dollars
    about   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,       -- e.g. GLW-7K3Q, given to the customer
    service_id INTEGER NOT NULL REFERENCES services(id),
    date       TEXT NOT NULL,              -- 2026-11-03
    time       TEXT NOT NULL,              -- 10:30
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    email      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  -- One row for every 30-minute slot a booking uses.
  -- UNIQUE(date, time) is what makes double booking impossible.
  CREATE TABLE IF NOT EXISTS slots (
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    UNIQUE (date, time)
  );
`);
if (!db.prepare('SELECT COUNT(*) AS n FROM services').get().n) {
  const add = db.prepare('INSERT INTO services (name, minutes, price, about) VALUES (?, ?, ?, ?)');
  for (const s of rules.SERVICES) add.run(s.name, s.minutes, s.price, s.about);
}

// ===== 2. Helpers =====
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const fail = (res, status, error) => res.status(status).json({ error });
const getService = id => db.prepare('SELECT * FROM services WHERE id = ?').get(id);
const takenTimes = date => new Set(db.prepare('SELECT time FROM slots WHERE date = ?').all(date).map(r => r.time));

// GLW- + 4 letters/numbers that are easy to read (no 0/O or 1/I)
function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = 'GLW-' + Array.from(crypto.randomBytes(4), b => chars[b % chars.length]).join('');
  while (db.prepare('SELECT 1 FROM bookings WHERE code = ?').get(code));
  return code;
}
function admin(req, res, next) {
  const given = Buffer.from((req.get('authorization') || '').replace(/^Bearer /, ''));
  const real = Buffer.from(ADMIN_TOKEN);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) return fail(res, 401, 'Wrong admin password.');
  next();
}
const publicBooking = b => ({ code: b.code, date: b.date, time: b.time, name: b.name, service: b.service, minutes: b.minutes, price: b.price });

// ===== 3. Routes =====
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/services', (req, res) => res.json({ services: db.prepare('SELECT * FROM services ORDER BY id').all() }));

// Which start times are free for this service on this day?
app.get('/api/availability', (req, res) => {
  const date = String(req.query.date || '');
  const service = getService(req.query.service);
  if (!rules.isDate(date)) return fail(res, 400, 'Date must look like 2026-11-03.');
  if (!service) return fail(res, 404, 'Service not found.');
  res.json({ open: rules.isOpen(date), times: rules.startTimes(date, service.minutes, takenTimes(date), new Date()) });
});

app.post('/api/bookings', (req, res) => {
  const b = {
    service: getService(req.body.service_id), date: String(req.body.date || ''), time: String(req.body.time || ''),
    name: String(req.body.name || '').trim(), phone: String(req.body.phone || '').replace(/[\s-]/g, ''), email: String(req.body.email || '').trim().toLowerCase()
  };
  if (!b.service) return fail(res, 400, 'Please choose a service.');
  if (!rules.isDate(b.date) || !rules.isOpen(b.date)) return fail(res, 400, 'The salon is closed on that day.');
  if (b.name.length < 2 || b.name.length > 50) return fail(res, 400, 'Name must be 2 to 50 characters.');
  if (!/^\+?\d{7,15}$/.test(b.phone)) return fail(res, 400, 'Please enter a valid phone number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return fail(res, 400, 'Please enter a valid email.');
  // Is this a real start time: inside opening hours, not in the past, ends before closing?
  const valid = rules.startTimes(b.date, b.service.minutes, new Set(), new Date()).some(t => t.time === b.time && t.free);
  if (!valid) return fail(res, 400, 'Please pick one of the available times.');

  // Save the booking and all its slots together. If any slot is already taken,
  // the UNIQUE rule throws, and ROLLBACK undoes everything.
  const code = newCode();
  try {
    db.exec('BEGIN');
    const { lastInsertRowid } = db.prepare('INSERT INTO bookings (code, service_id, date, time, name, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(code, b.service.id, b.date, b.time, b.name, b.phone, b.email);
    const addSlot = db.prepare('INSERT INTO slots (date, time, booking_id) VALUES (?, ?, ?)');
    for (const t of rules.slotsFor(b.time, b.service.minutes)) addSlot.run(b.date, t, lastInsertRowid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (String(err.message).includes('UNIQUE')) return fail(res, 409, 'Sorry, someone just booked that time. Please pick another.');
    throw err;
  }
  res.status(201).json({ booking: publicBooking({ ...b, code, service: b.service.name, minutes: b.service.minutes, price: b.service.price }) });
});

// Find a booking: needs the code AND the email used, so codes can't be guessed
function findBooking(code, email) {
  return db.prepare(`SELECT bookings.*, services.name AS service, services.minutes, services.price
    FROM bookings JOIN services ON services.id = bookings.service_id
    WHERE bookings.code = ? AND bookings.email = ?`).get(String(code).toUpperCase(), String(email || '').trim().toLowerCase());
}
app.post('/api/bookings/find', (req, res) => {
  const b = findBooking(req.body.code, req.body.email);
  if (!b) return fail(res, 404, 'No booking found with that code and email.');
  res.json({ booking: publicBooking(b) });
});
app.post('/api/bookings/cancel', (req, res) => {
  const b = findBooking(req.body.code, req.body.email);
  if (!b) return fail(res, 404, 'No booking found with that code and email.');
  if (rules.toDate(b.date, b.time) < new Date()) return fail(res, 400, 'This appointment has already started.');
  db.prepare('DELETE FROM bookings WHERE id = ?').run(b.id);   // its slots are freed by ON DELETE CASCADE
  res.json({ ok: true });
});

// Admin: the schedule for one day, plus totals
app.get('/api/admin/day', admin, (req, res) => {
  const date = String(req.query.date || '');
  if (!rules.isDate(date)) return fail(res, 400, 'Date must look like 2026-11-03.');
  const bookings = db.prepare(`SELECT bookings.code, bookings.time, bookings.name, bookings.phone, bookings.email,
      services.name AS service, services.minutes, services.price
    FROM bookings JOIN services ON services.id = bookings.service_id
    WHERE bookings.date = ? ORDER BY bookings.time`).all(date);
  const totals = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(services.price), 0) AS revenue
    FROM bookings JOIN services ON services.id = bookings.service_id WHERE bookings.date = ?`).get(date);
  res.json({ date, open: rules.isOpen(date), bookings, ...totals, busy: takenTimes(date).size, slots: rules.allSlots(date).length });
});

app.use('/api', (req, res) => fail(res, 404, 'Unknown API route.'));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`BookIt running on http://localhost:${PORT}`);
    if (!process.env.ADMIN_TOKEN) console.log(`Admin password for this run: ${ADMIN_TOKEN}  (set ADMIN_TOKEN to choose your own)`);
  });
}
module.exports = { app };
