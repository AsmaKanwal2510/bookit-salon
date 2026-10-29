# BookIt: salon booking system (Glow Studio)

A full-stack app by **Asma Kanwal**. Customers book a hair appointment in four steps, then look up or cancel it with their code. Staff see each day as a timeline.

| Part | Technology |
|---|---|
| Frontend | HTML, CSS and JavaScript (`public/index.html`) |
| Backend | Node.js + Express (`server.js`) |
| Database | SQLite, built into Node 22.13 and newer: tables `services`, `bookings` and `slots` |
| Shared rules | `public/rules.js`: opening hours and slot maths, used by both the server and the browser |

## The interesting part: no double bookings

Each booking saves one row per 30-minute slot it uses in the `slots` table, which has `UNIQUE(date, time)`. The booking and its slots are saved inside one **transaction**. If two people book overlapping times at the same moment, the second insert breaks the UNIQUE rule, the transaction is rolled back, and that person gets `409 Conflict` with a friendly message. The database guarantees it, not just the page.

## Features

- A 4-step booking wizard: service, then day and time, then details, then a confirmation code (like `GLW-7K3Q`).
- Services of different lengths (30 to 120 minutes). A time is offered only if the whole appointment fits before closing.
- Closed days (Sunday and Monday) and past times can't be booked, and bookings need 1 hour's notice.
- "My booking": find or cancel with your code **and** email, so codes can't be guessed. Cancelling frees the slots (`ON DELETE CASCADE`).
- Salon admin (password protected): a day timeline, appointment count, expected revenue and how full the chair is.

## Run it on your computer

```bash
npm install
npm start        # open http://localhost:3000. The admin password is printed in the terminal.
npm test         # 6 automatic tests (including overlapping bookings)
```

## API

| Method | Route | What it does |
|---|---|---|
| GET | `/api/services` | all services |
| GET | `/api/availability?date=&service=` | start times, each marked free or not |
| POST | `/api/bookings` | `{service_id, date, time, name, phone, email}` → booking code |
| POST | `/api/bookings/find` | `{code, email}` |
| POST | `/api/bookings/cancel` | `{code, email}` |
| GET | `/api/admin/day?date=` | admin: the day's bookings and totals (`Authorization: Bearer <ADMIN_TOKEN>`) |

## Put it online (Render)

1. New → Web Service, then connect your GitHub repository.
2. Build command: `npm install`. Start command: `npm start`. Instance type: **Free**.
3. Environment variable: `ADMIN_TOKEN` set to a password of your choice.

On the free plan the database starts fresh whenever the server restarts (and the server sleeps after 15 minutes without visitors, so the first visit takes about a minute). That's fine for a portfolio demo. To keep data permanently, use a paid plan with a Disk at `/data` and `DB_FILE=/data/bookit.db`.
