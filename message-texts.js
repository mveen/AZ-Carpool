// message-texts.js — every WhatsApp / share message the app can compose.
// The build*From(ctx) functions are PURE: all data comes in through `ctx`, nothing reads the browser or the
// database, so they are tested without a browser (message-texts.test.js). The build*WhatsApp() wrappers below
// only collect the current app state into a ctx and call them.
import { APP_URL, DAYS, DIR_TEXT } from './constants.js';
import { t, locale } from './i18n.js';
import { activeDeviation, baseCars, effectiveCars, fam, plainDriverName, plainGirlName, rideTime } from './rides.js';
import { dateForWeekday, dayUp, waDayDate } from './dates.js';
import { myFamilyId } from './coordinator.js';
import { analyzeMatch, matchLabel, myMatchRides } from './matches.js';
import { dayChanges } from './day-changes.js';
import { ovGirlsFor } from './rides.js';

// "MA 28" — used for the day headings in the WhatsApp messages.
export function dayHeading(dayKey, date){ return dayUp(dayKey)+' '+date.getDate(); }

// ---------- pure builders ----------

// Which days have a deviation this week: "Maandag en Dinsdag", or "deze week" when none.
// ctx: { hasDeviation(day, direction) -> bool }
export function activeDeviationDayLabelFrom(ctx){
  const labels = DAYS.filter(([k])=>['heen','terug'].some(dir=>ctx.hasDeviation(k,dir))).map(([,label])=>label);
  return labels.length? labels.join(t('wa.and')) : t('wa.thisWeek');
}

// Generic fallback (used only when no specific day/family context is available).
// WhatsApp messages are plain text — there is no way to make "Mijn week" itself a hidden hyperlink.
// The raw link is placed right after it and WhatsApp auto-linkifies it.
export function buildWhatsAppMessageFrom(ctx){
  return t('wa.generic', { days: activeDeviationDayLabelFrom(ctx), url: APP_URL+'#myweek' });
}

// Mijn week: one line per day for THIS family's daughter —
// "Ma 28 — heen: 07:15 met Jan | terug: 17:30 met Piet"
// ctx: { myId, myFam, cars(day,direction), hasDeviation(day,direction), dateFor(day)->Date,
//        matchRides: [{doc,car}], driverName(id), matchLabel(doc) }
export function buildMyWeekMessageFrom(ctx){
  const { myId, myFam } = ctx;
  // ctx.rideTime: the handed-in time where the temporary rooster applies; without it (or in tests) the standard schedule.
  const timeOf = (day,direction) => ctx.rideTime? ctx.rideTime(myId,day,direction) : (myFam.schedule && myFam.schedule[day] && myFam.schedule[day][direction]);
  function part(day,direction){
    const s = timeOf(day,direction);
    if(!s) return '–';
    if(ctx.isOv && ctx.isOv(day,myId,direction)) return t('wa.my.ov');
    const car = ctx.cars(day,direction).find(c=>c.girlIds.includes(myId));
    if(!car) return t('wa.my.notPlanned', { time: s });
    return t('wa.my.with', { time: car.departureTime||s, driver: ctx.driverName(car.driverFamilyId) });
  }
  // Each line gets a sort key (its calendar date) so match rides land right under their own
  // day instead of in a block at the end; weekend matches naturally follow Friday.
  const entries = [];
  DAYS.forEach(([k])=>{
    if(!timeOf(k,'heen') && !timeOf(k,'terug')) return;
    const changed = (ctx.hasDeviation(k,'heen')||ctx.hasDeviation(k,'terug'))? t('wa.my.changed') : '';
    const d = ctx.dateFor(k); d.setHours(0,0,0,0);
    entries.push({sort:d.getTime(), order:0, text:t('wa.my.line', { day: dayHeading(k, ctx.dateFor(k)), changed, heen: part(k,'heen'), terug: part(k,'terug') })});
  });
  ctx.matchRides.forEach(r=>{
    const d = new Date(r.doc.startMs);
    const wd = d.toLocaleDateString(locale(),{weekday:'short'}).replace('.','');
    const dl = wd.slice(0,2).toUpperCase()+' '+d.getDate();
    const a = analyzeMatch(r.doc.summary||'');
    const dayStart = new Date(d); dayStart.setHours(0,0,0,0);
    // Plain text only (no emoji): WhatsApp's share link doesn't reliably carry them.
    entries.push({sort:dayStart.getTime(), order:1+r.doc.startMs/1e13,
      text:t('wa.my.match', { day: dl, team: ctx.matchLabel(r.doc), opponent: a.opponent, time: r.car.departureTime||'?', driver: ctx.driverName(r.car.driverFamilyId) })});
  });
  entries.sort((x,y)=>x.sort-y.sort || x.order-y.order);
  const lines = entries.map(e=>e.text);
  const header = t('wa.my.header', { name: myFam.girlName||myFam.parentName||'' });
  return [header, ...(lines.length? lines : [t('wa.my.none')]), '', `${APP_URL}#myweek`].join('\n');
}

// Dagafwijking: the full (effective) schedule of one day — every car, its driver and passengers.
// ctx: { cars(day,direction), hasDeviation(day,direction), dateFor(day)->Date, driverName(id), girlName(id) }
export function buildDayMessageFrom(ctx, day){
  const dayLabel = DAYS.find(([k])=>k===day)[1];
  const dateLabel = ctx.dateFor(day).toLocaleDateString(locale(),{day:'numeric',month:'short'});
  function block(direction,title){
    const cars = ctx.cars(day,direction).filter(c=>c.girlIds && c.girlIds.length);
    const carLines = cars.length
      ? [...cars].sort((a,b)=>(a.departureTime||'').localeCompare(b.departureTime||'')).map(c=>
          t('wa.day.car', { time: c.departureTime||'--:--', driver: ctx.driverName(c.driverFamilyId), girls: c.girlIds.map(id=>ctx.girlName(id)).join(', ') }))
      : [t('wa.day.noRides')];
    return [`${title}${ctx.hasDeviation(day,direction)? t('wa.day.adapted') : ''}:`, ...carLines].join('\n');
  }
  return [
    t('wa.day.title', { dayLabel, date: dateLabel }),
    '',
    block('heen',DIR_TEXT.heen),
    '',
    block('terug',DIR_TEXT.terug),
    '',
    `${APP_URL}#myweek`
  ].join('\n');
}

// Conclusie-appje (US-03): the text the day coordinator sends to the group after changes on one day.
// No changes: "<Dag>: volgens schema. Zie Mijn week: <link>". Otherwise: first what changed (one line per kind,
// a kind without entries is left out), then the full schedule of the day, then the link.
// ctx: { baseCars(day,direction), cars(day,direction), dateFor(day)->Date, driverName(id), girlName(id) }
export function buildConclusieFrom(ctx, day){
  const dayLabel = DAYS.find(([k])=>k===day)[1];
  const link = APP_URL+'#myweek';
  const dirs = ['heen','terug'];
  const word = d=> d==='heen'? t('wa.dir.heen') : t('wa.dir.terug');
  const changes = {};
  dirs.forEach(d=>{ changes[d] = dayChanges(ctx.baseCars(day,d), ctx.cars(day,d)); });
  const ovBy = {}; dirs.forEach(d=>{ ovBy[d] = ctx.ovGirls? ctx.ovGirls(day,d) : []; });   // girls marked "Rijdt niet mee" (US-06)
  if(!dirs.some(d=>changes[d].length || ovBy[d].length)) return t('wa.conclusie.onSchedule', { dayLabel, url: link });

  const names = (d,type)=>{
    const ids = [];
    changes[d].forEach(it=>{
      if(it.type===type && !ids.includes(it.girlId) && !(type==='out' && ovBy[d].includes(it.girlId))) ids.push(it.girlId);
      if(type==='extra' && it.type==='newcar') it.extraGirlIds.forEach(g=>{ if(!ids.includes(g)) ids.push(g); });
    });
    return ids.map(id=>ctx.girlName(id)).join(', ');
  };
  const entries = [];
  dirs.forEach(d=>changes[d].forEach(it=>{
    if(!['driver','newcar','time','moved'].includes(it.type)) return;
    const e = t('wa.conclusie.changedEntry', { direction: word(d), driver: ctx.driverName(it.driverId), time: it.time||'' }).trim();
    if(!entries.includes(e)) entries.push(e);
  }));
  const summary = [];
  dirs.forEach(d=>{ const n = [names(d,'out'), ...ovBy[d].map(id=>ctx.girlName(id))].filter(Boolean).join(', '); if(n) summary.push(t('wa.conclusie.out', { direction: word(d), names: n })); });
  if(entries.length) summary.push(t('wa.conclusie.changed', { entries: entries.join('; ') }));
  dirs.forEach(d=>{ const n = names(d,'extra'); if(n) summary.push(t('wa.conclusie.extra', { direction: word(d), names: n })); });

  const dateLabel = ctx.dateFor(day).toLocaleDateString(locale(),{day:'numeric',month:'short'});
  function block(d){
    const cars = ctx.cars(day,d).filter(c=>c.girlIds && c.girlIds.length);
    const carLines = cars.length
      ? [...cars].sort((x,y)=>(x.departureTime||'').localeCompare(y.departureTime||'')).map(c=>
          t('wa.day.car', { time: c.departureTime||'--:--', driver: ctx.driverName(c.driverFamilyId), girls: c.girlIds.map(id=>ctx.girlName(id)).join(', ') }))
      : [t('wa.day.noRides')];
    return [`${DIR_TEXT[d]}${changes[d].length? t('wa.day.adapted') : ''}:`, ...carLines].join('\n');
  }
  return [
    ...summary,
    '',
    t('wa.conclusie.title', { day: dayLabel.toLowerCase(), date: dateLabel }),
    block('heen'),
    block('terug'),
    '',
    link
  ].join('\n');
}

// "Can you drive?" ask sent to a reserve driver. dateText is already formatted (e.g. "maandag 28 september").
export function reserveAskTextFrom(dateText, direction, time){
  return t('wa.ask.reserve', { direction: t(direction==='heen'?'wa.ask.reserve.heen':'wa.ask.reserve.terug'), date: dateText, time: time||t('ask.unknownTime') });
}
export function driverAskTextFrom(dateText, time){
  return t('wa.ask.driver', { date: dateText, time: time||t('ask.unknownTime') });
}

// ---------- wrappers: collect the current app state, then call the pure builders ----------
function stateCtx(){
  return {
    cars: (day,direction)=>effectiveCars(day,direction),
    hasDeviation: (day,direction)=>!!activeDeviation(day,direction),
    dateFor: (day)=>dateForWeekday(day),
    baseCars: (day,direction)=>baseCars(day,direction),
    rideTime: (id,day,direction)=>rideTime(id,day,direction),
    driverName: (id)=>plainDriverName(id),
    girlName: (id)=>plainGirlName(id),
    matchLabel,
    ovGirls: (day,direction)=>ovGirlsFor(day,undefined,direction),
  };
}
export function buildWhatsAppMessage(){ return buildWhatsAppMessageFrom(stateCtx()); }
export function buildMyWeekWhatsAppMessage(){
  const myId = myFamilyId();
  return buildMyWeekMessageFrom({ ...stateCtx(), myId, myFam: fam(myId), matchRides: myMatchRides(myId), isOv: (day,id,direction)=>ovGirlsFor(day,undefined,direction).includes(id) });
}
export function buildConclusieMessage(day){ return buildConclusieFrom(stateCtx(), day); }
export function buildDayWhatsAppMessage(day){ return buildDayMessageFrom(stateCtx(), day); }
export function activeDeviationDayLabel(){ return activeDeviationDayLabelFrom(stateCtx()); }
export function waDayLabel(k){ return dayHeading(k, dateForWeekday(k)); }
export function reserveAskText(day,direction,time){ return reserveAskTextFrom(waDayDate(day), direction, time); }
export function driverAskText(day,time){ return driverAskTextFrom(waDayDate(day), time); }
