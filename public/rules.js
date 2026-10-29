// Salon rules, shared by the server (require) and the browser (<script>).
// Writing them once means the frontend and backend can never disagree.
const rules = (() => {
  const SERVICES = [
    { name: 'Haircut & Style',  minutes: 60,  price: 35, about: 'Wash, cut and blow-dry.' },
    { name: 'Blow-dry',         minutes: 30,  price: 20, about: 'Smooth, bouncy finish.' },
    { name: 'Colour & Gloss',   minutes: 120, price: 85, about: 'Full colour with a shine gloss.' },
    { name: 'Keratin Treatment', minutes: 90, price: 70, about: 'Frizz-free hair for weeks.' },
    { name: 'Bridal Trial',     minutes: 90,  price: 60, about: 'Try your wedding look.' },
    { name: 'Kids Cut',         minutes: 30,  price: 15, about: 'For under-12s.' }
  ];
  const OPEN_DAYS = [2, 3, 4, 5, 6];   // Tuesday to Saturday (0 = Sunday)
  const OPEN = 10 * 60, CLOSE = 18 * 60, STEP = 30;   // minutes after midnight
  const NOTICE = 60;                    // book at least 60 minutes ahead

  const pad = n => String(n).padStart(2, '0');
  const toTime = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);   // 630 -> "10:30"
  const toMinutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toDate = (date, time = '00:00') => new Date(date + 'T' + time + ':00');   // local time
  // A real calendar date? ("2026-02-30" fails because it becomes 2 March)
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(toDate(d)) && d === toISO(toDate(d));
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  const isOpen = date => OPEN_DAYS.includes(toDate(date).getDay());

  // Every 30-minute slot on a day: ["10:00", "10:30", ... "17:30"]
  function allSlots(date) {
    if (!isOpen(date)) return [];
    const list = [];
    for (let m = OPEN; m < CLOSE; m += STEP) list.push(toTime(m));
    return list;
  }
  // The slots a booking uses: 10:00 for 90 minutes -> ["10:00", "10:30", "11:00"]
  function slotsFor(time, minutes) {
    const list = [];
    for (let m = toMinutes(time); m < toMinutes(time) + minutes; m += STEP) list.push(toTime(m));
    return list;
  }
  // Possible start times for a service. "free" = every slot it needs is free,
  // it ends before closing, and it starts at least an hour from now.
  function startTimes(date, minutes, taken, now) {
    if (!isOpen(date)) return [];
    const earliest = new Date(now.getTime() + NOTICE * 60e3);
    return allSlots(date)
      .filter(t => toMinutes(t) + minutes <= CLOSE)
      .map(t => ({ time: t, free: toDate(date, t) >= earliest && slotsFor(t, minutes).every(s => !taken.has(s)) }));
  }
  return { SERVICES, OPEN_DAYS, OPEN, CLOSE, toTime, toDate, toISO, isDate, isOpen, allSlots, slotsFor, startTimes };
})();
if (typeof module !== 'undefined') module.exports = rules;
