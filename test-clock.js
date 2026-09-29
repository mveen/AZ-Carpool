// test-clock.js — imported FIRST by test-support.js. Pins "now" to Wednesday 30 September 2026, 10:00
// (Amsterdam) for the whole test run, because some values (like which weekday is "today") are fixed the
// moment a module is loaded. withFakeNow() in test-support.js can still move the clock temporarily.
process.env.TZ = 'Europe/Amsterdam';
const RealDate = Date;
const PINNED = new RealDate('2026-09-30T10:00:00+02:00').getTime();
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return PINNED; }
}
globalThis.__RealDate = RealDate;
globalThis.Date = PinnedDate;
