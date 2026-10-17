// Run with: node cron-run-window.test.js
// cron/lib/run-window.mjs: when a cron job may run (not at night, not more than once an hour for the agenda). Reads cost quota on the free plan.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { amsterdamHour, inQuietWindow, tooSoon, skipReason, lastRunAt, markRun } from '../cron/lib/run-window.mjs';
import { PUSH_QUIET } from '../cron/push.mjs';
import { AGENDA_QUIET, AGENDA_MIN_GAP_MS } from '../cron/agenda.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const at = s => new Date(s).getTime();

console.log('=== the hour in Amsterdam ===');
await test('summer time (UTC+2), winter time (UTC+1) and midnight are read in Amsterdam time, not the host time', () => {
  assert.equal(amsterdamHour(at('2026-10-17T00:30:00+02:00')), 0);
  assert.equal(amsterdamHour(at('2026-10-16T22:30:00Z')), 0);     // 00:30 in summer time
  assert.equal(amsterdamHour(at('2026-12-01T23:30:00Z')), 0);     // 00:30 in winter time
  assert.equal(amsterdamHour(at('2026-12-01T12:00:00+01:00')), 12);
  assert.equal(amsterdamHour(at('2026-10-17T23:59:00+02:00')), 23);
});

console.log('\n=== the quiet window ===');
await test('[from, to): from is inside, to is outside; a window across midnight works too', () => {
  assert.equal(inQuietWindow(at('2026-10-17T00:00:00+02:00'), { fromHour: 0, toHour: 5 }), true);
  assert.equal(inQuietWindow(at('2026-10-17T04:59:00+02:00'), { fromHour: 0, toHour: 5 }), true);
  assert.equal(inQuietWindow(at('2026-10-17T05:00:00+02:00'), { fromHour: 0, toHour: 5 }), false);
  assert.equal(inQuietWindow(at('2026-10-16T23:59:00+02:00'), { fromHour: 0, toHour: 5 }), false);
  assert.equal(inQuietWindow(at('2026-10-16T23:00:00+02:00'), { fromHour: 22, toHour: 6 }), true);
  assert.equal(inQuietWindow(at('2026-10-17T05:59:00+02:00'), { fromHour: 22, toHour: 6 }), true);
  assert.equal(inQuietWindow(at('2026-10-17T06:00:00+02:00'), { fromHour: 22, toHour: 6 }), false);
});
await test('the push job rests from 00:00 to 05:00 and the agenda job until 06:00 (Amsterdam time)', () => {
  assert.deepEqual(PUSH_QUIET, { fromHour: 0, toHour: 5 });
  assert.deepEqual(AGENDA_QUIET, { fromHour: 0, toHour: 6 });
  assert.equal(skipReason({ nowMs: at('2026-10-17T03:00:00+02:00'), quiet: PUSH_QUIET }), 'quiet hours');
  assert.equal(skipReason({ nowMs: at('2026-10-17T05:00:00+02:00'), quiet: PUSH_QUIET }), '');
  assert.equal(skipReason({ nowMs: at('2026-10-17T05:30:00+02:00'), quiet: AGENDA_QUIET }), 'quiet hours');
  assert.equal(skipReason({ nowMs: at('2026-10-17T06:00:00+02:00'), quiet: AGENDA_QUIET }), '');
});

console.log('\n=== not more than once an hour ===');
await test('cron every 30 minutes with a gap of 50 minutes = one real run an hour', () => {
  assert.equal(AGENDA_MIN_GAP_MS, 50 * 60 * 1000);
  const run = [];   // simulate a day: a cron tick every 30 minutes, the job takes 10 seconds
  let last = null;
  for (let t = at('2026-10-17T00:00:00+02:00'); t < at('2026-10-18T00:00:00+02:00'); t += 30 * 60000) {
    if (!skipReason({ nowMs: t + 3000, quiet: AGENDA_QUIET, lastMs: last, minGapMs: AGENDA_MIN_GAP_MS })) { run.push(t); last = t + 10000; }
  }
  assert.equal(run.length, 18);   // 06:00 ... 23:00, once an hour
  assert.equal(amsterdamHour(run[0]), 6); assert.equal(amsterdamHour(run[run.length - 1]), 23);
});
await test('tooSoon: no last run, a broken one and one in the future never block a run', () => {
  assert.equal(tooSoon(null, 1000, 500), false);
  assert.equal(tooSoon(NaN, 1000, 500), false);
  assert.equal(tooSoon('x', 1000, 500), false);
  assert.equal(tooSoon(2000, 1000, 500), false);
  assert.equal(tooSoon(900, 1000, 500), true);
  assert.equal(tooSoon(500, 1000, 500), false);
  assert.equal(skipReason({ nowMs: 1000 }), '');
});

console.log('\n=== the last-run file ===');
await test('markRun writes it, lastRunAt reads it; a missing or broken file reads as "never"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-window-'));
  const f = join(dir, 'sub', 'agenda.lastrun');
  assert.equal(lastRunAt(f), null);
  markRun(f, 1234567);
  assert.equal(lastRunAt(f), 1234567); assert.equal(readFileSync(f, 'utf8'), '1234567');
  markRun(f, 'abc'); assert.equal(lastRunAt(f), null);
  markRun(join(f, 'inside-a-file', 'x'), 1);   // a path that cannot be made: must not throw
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
