// Run with: npm test   (uses a temporary in-memory database)
process.env.DB_FILE = ':memory:';
process.env.ADMIN_TOKEN = 'test-admin';
const test = require('node:test');
const assert = require('node:assert');
const { app } = require('./server');
const rules = require('./public/rules.js');

let server, base;
test.before(() => new Promise(done => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}/api`; done(); }); }));
test.after(() => server.close());

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json() };
}
// Next Wednesday at least a week away (always open), and the next Sunday (always closed)
function nextDay(weekday) {
  const d = new Date(); d.setDate(d.getDate() + 7);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return rules.toISO(d);
}
const WED = nextDay(3), SUN = nextDay(0);
const person = { name: 'Asma Kanwal', phone: '+92 300 1234567', email: 'asma@example.com' };
const CUT = 1, BLOWDRY = 2, COLOUR = 3;   // 60, 30 and 120 minutes

test('shared rules: slots and real dates', () => {
  assert.deepEqual(rules.slotsFor('10:00', 90), ['10:00', '10:30', '11:00']);
  assert.equal(rules.isDate('2026-02-30'), false);
  assert.equal(rules.isDate(WED), true);
});

test('services and availability', async () => {
  assert.equal((await call('GET', '/services')).data.services.length, 6);
  assert.deepEqual((await call('GET', `/availability?date=${SUN}&service=${CUT}`)).data, { open: false, times: [] });
  const colour = (await call('GET', `/availability?date=${WED}&service=${COLOUR}`)).data.times;
  assert.equal(colour.at(-1).time, '16:00', 'a 2-hour colour must end by 18:00');
  assert.ok(colour.every(t => t.free));
});

test('booking checks the input', async () => {
  assert.equal((await call('POST', '/bookings', { ...person, service_id: CUT, date: SUN, time: '10:00' })).status, 400);
  assert.equal((await call('POST', '/bookings', { ...person, service_id: CUT, date: WED, time: '10:15' })).status, 400);
  assert.equal((await call('POST', '/bookings', { ...person, service_id: COLOUR, date: WED, time: '17:00' })).status, 400, 'would end after closing');
  assert.equal((await call('POST', '/bookings', { ...person, email: 'bad', service_id: CUT, date: WED, time: '10:00' })).status, 400);
});

let code;
test('book, then the same and overlapping times are blocked', async () => {
  const r = await call('POST', '/bookings', { ...person, service_id: COLOUR, date: WED, time: '11:00' });   // 11:00-13:00
  assert.equal(r.status, 201);
  assert.match(r.data.booking.code, /^GLW-[A-Z2-9]{4}$/);
  code = r.data.booking.code;
  assert.equal((await call('POST', '/bookings', { ...person, service_id: BLOWDRY, date: WED, time: '11:00' })).status, 409, 'same start');
  assert.equal((await call('POST', '/bookings', { ...person, service_id: BLOWDRY, date: WED, time: '12:30' })).status, 409, 'inside the colour');
  assert.equal((await call('POST', '/bookings', { ...person, service_id: CUT, date: WED, time: '10:30' })).status, 409, '10:30-11:30 overlaps');
  assert.equal((await call('POST', '/bookings', { ...person, service_id: CUT, date: WED, time: '10:00' })).status, 201, '10:00-11:00 just fits');
  const times = (await call('GET', `/availability?date=${WED}&service=${BLOWDRY}`)).data.times;
  assert.deepEqual(times.filter(t => !t.free).map(t => t.time), ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
});

test('find and cancel need the right email', async () => {
  assert.equal((await call('POST', '/bookings/find', { code, email: 'other@example.com' })).status, 404);
  const found = await call('POST', '/bookings/find', { code: code.toLowerCase(), email: 'ASMA@example.com' });
  assert.equal(found.data.booking.service, 'Colour & Gloss');
  assert.equal((await call('POST', '/bookings/cancel', { code, email: 'other@example.com' })).status, 404);
  assert.equal((await call('POST', '/bookings/cancel', { code, email: person.email })).status, 200);
  assert.equal((await call('POST', '/bookings', { ...person, service_id: BLOWDRY, date: WED, time: '12:00' })).status, 201, 'cancelled time is free again');
});

test('admin day view needs the password and adds up', async () => {
  assert.equal((await call('GET', `/admin/day?date=${WED}`)).status, 401);
  const { data } = await call('GET', `/admin/day?date=${WED}`, null, 'test-admin');
  assert.equal(data.bookings.length, 2);
  assert.equal(data.count, 2);
  assert.equal(data.revenue, 35 + 20);
  assert.equal(data.busy, 3);
  assert.equal(data.slots, 16);
});
