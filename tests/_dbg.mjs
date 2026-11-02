import { buildKeepAdvice } from '../weekrooster-impact.js';
const fam = (time, cap = 4) => ({ capacity: cap, schedule: { Ma: { heen: time, terug: time } }, availability: { Ma: { heen: true, terug: true } } });
const kf = { saar: fam('17:00'), noor: fam('17:00'), lotte: fam('17:00'), eva: fam('17:00'), fenna: fam('17:00'), julia: fam('17:00'), sara: fam('17:00'), roos: fam('17:00') };
const kcars = [
  { driverFamilyId: 'saar', girlIds: ['eva', 'noor'], departureTime: '16:00' },
  { driverFamilyId: 'lotte', girlIds: ['lotte', 'fenna'], departureTime: '16:00' },
  { driverFamilyId: 'julia', girlIds: ['julia', 'sara'], departureTime: '16:00' },
  { driverFamilyId: 'roos', girlIds: ['roos'], departureTime: '16:00' },
];
const keep = (requests, extra = {}) => buildKeepAdvice({ day: 'Ma', direction: 'heen', cars: kcars, requests, timeOf: id => kf[id].schedule.Ma.heen, families: kf, settings: {}, prefs: { rules: [] }, priority: {}, ...extra });
const show = a => console.log(JSON.stringify({best:a.best&&{w:a.best.waitMinutes,x:a.best.extraWait,cars:a.best.cars.map(c=>c.driverFamilyId+':'+c.girlIds), moved:a.best.moved, fc:a.best.familiesChanged}, alt:a.alt&&{w:a.alt.waitMinutes,cars:a.alt.cars.map(c=>c.driverFamilyId+':'+c.girlIds)}, fb:!!a.fallback}));
show(keep([{ familyId: 'eva', rides: true, time: '17:30' }, { familyId: 'lotte', rides: true, time: '17:30' }]));
show(keep([{ familyId: 'noor', rides: true, time: '17:00' }]));
show(keep([{ familyId: 'noor', rides: false, time: '' }, { familyId: 'eva', rides: false, time: '' }]));
// 3 + 2 cars cap 4, one stays home
const f2 = { a: fam('08:00'), b: fam('08:00'), c: fam('08:00'), d: fam('08:00'), e: fam('08:00') };
show(buildKeepAdvice({ day:'Ma', direction:'heen', cars:[{driverFamilyId:'a',girlIds:['a','b','c'],departureTime:'07:00'},{driverFamilyId:'d',girlIds:['d','e'],departureTime:'07:00'}], requests:[{familyId:'e',rides:false,time:''}], timeOf:id=>f2[id].schedule.Ma.heen, families:f2, settings:{}, prefs:{rules:[]}, priority:{} }));
