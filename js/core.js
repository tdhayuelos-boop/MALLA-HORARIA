/* =====================================================================
   core.js  ·  Lógica pura de la malla horaria (sin pantalla ni base de datos)
   Se usa en el navegador (window.MH_CORE) y en pruebas con Node.
   ===================================================================== */
(function (root) {
'use strict';

const pad = n => String(n).padStart(2, '0');

const LUNCH = 60;            // 1 hora de almuerzo todos los días
const NIGHT = 19 * 60;       // desde las 19:00 las horas son nocturnas
const CLOSE_FROM = 20 * 60;  // salida desde las 20:00 => se sugiere un cierre
const DAY_MIN = 420;         // una jornada = 7 horas
const EDIT_FREE_MS = 60 * 60 * 1000; // 1 hora para corregir libremente

/* ------------------------------------------------------------------ */
/* Fechas ('YYYY-MM-DD')                                               */
/* ------------------------------------------------------------------ */
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtDate = dt => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
const addDays = (s, n) => { const dt = parseDate(s); dt.setUTCDate(dt.getUTCDate() + n); return fmtDate(dt); };
const dow = s => parseDate(s).getUTCDay();                 // 0 = domingo
const weekStart = s => addDays(s, -dow(s));                // las semanas empiezan en domingo
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthOf = s => s.slice(0, 7);

/* ------------------------------------------------------------------ */
/* Festivos de Colombia (se calculan solos para cualquier año)         */
/* ------------------------------------------------------------------ */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}
const toMonday = s => addDays(s, (8 - dow(s)) % 7);        // Ley Emiliani: pasa al lunes siguiente
const _hc = {};
function holidays(y) {
  if (_hc[y]) return _hc[y];
  const map = {};
  const add = (date, name) => { map[date] = map[date] ? map[date] + ' / ' + name : name; };
  [[1, 1, 'Año Nuevo'], [5, 1, 'Día del Trabajo'], [7, 20, 'Día de la Independencia'],
   [8, 7, 'Batalla de Boyacá'], [12, 8, 'Inmaculada Concepción'], [12, 25, 'Navidad']]
    .forEach(([m, d, n]) => add(ymd(y, m, d), n));
  [[1, 6, 'Reyes Magos'], [3, 19, 'San José'], [6, 29, 'San Pedro y San Pablo'],
   [8, 15, 'Asunción de la Virgen'], [10, 12, 'Día de la Raza'], [11, 1, 'Todos los Santos'],
   [11, 11, 'Independencia de Cartagena']]
    .forEach(([m, d, n]) => add(toMonday(ymd(y, m, d)), n));
  const E = easter(y);
  add(addDays(E, -3), 'Jueves Santo');
  add(addDays(E, -2), 'Viernes Santo');
  add(toMonday(addDays(E, 39)), 'Ascensión del Señor');
  add(toMonday(addDays(E, 60)), 'Corpus Christi');
  add(toMonday(addDays(E, 68)), 'Sagrado Corazón');
  return (_hc[y] = map);
}
const holidayName = s => holidays(Number(s.slice(0, 4)))[s] || '';
const isHoliday = s => !!holidayName(s);
const isSunFest = s => dow(s) === 0 || isHoliday(s);
function monthHolidays(y, m) {
  const out = [], n = daysInMonth(y, m);
  for (let d = 1; d <= n; d++) { const s = ymd(y, m, d); const nm = holidayName(s); if (nm) out.push({ date: s, day: d, name: nm }); }
  return out;
}

/* ------------------------------------------------------------------ */
/* Horas                                                               */
/* ------------------------------------------------------------------ */
/* kind 's' = entrada (8 -> 08:00)   kind 'e' = salida (8 -> 20:00)
   Devuelve 'HH:MM', '' (vacío) o null (inválido). */
function parseTime(raw, kind) {
  raw = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
  if (raw === '') return '';
  let h, m = 0, x;
  if ((x = raw.match(/^(\d{1,2})$/))) { h = +x[1]; }
  else if ((x = raw.match(/^(\d{1,2})[:.](\d{2})$/))) { h = +x[1]; m = +x[2]; }
  else if ((x = raw.match(/^(\d{3,4})$/))) { const s = x[1].padStart(4, '0'); h = +s.slice(0, 2); m = +s.slice(2); }
  else return null;
  if (h > 23 || m > 59) return null;
  if (kind === 'e' && h >= 1 && h <= 11) h += 12;          // salida: 8 -> 20:00
  return `${pad(h)}:${pad(m)}`;
}
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function fmtDur(min) {
  const sign = min < 0 ? '-' : '';
  min = Math.abs(Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${sign}${h} h ${m} min`;
  if (h) return `${sign}${h} h`;
  return m ? `${sign}${m} min` : '0 h';
}
const hoursDec = min => Math.round(min / 60 * 100) / 100;
/* "2", "-1,5", "1:30", "-0:45"  ->  minutos (o null) */
function parseHours(raw) {
  raw = String(raw == null ? '' : raw).trim().replace(',', '.').replace(/\s+/g, '');
  let x;
  if ((x = raw.match(/^([+-]?)(\d+):(\d{1,2})$/))) {
    const mins = (+x[2]) * 60 + (+x[3]);
    return (x[1] === '-' ? -1 : 1) * mins || null;
  }
  if ((x = raw.match(/^[+-]?\d+(\.\d+)?$/))) return Math.round(parseFloat(raw) * 60) || null;
  return null;
}

/* ------------------------------------------------------------------ */
/* Códigos especiales de la malla                                      */
/* ------------------------------------------------------------------ */
const CODES = {
  C: 'COMPENSATORIO', D: 'DESCANSO', F: 'FESTIVO', INV: 'INVENTARIO',
  INC: 'INCAPACIDAD', VAC: 'VACACIONES', AUS: 'AUSENCIA', LIC: 'LICENCIA',
};
const NONWORK = ['INC', 'VAC', 'AUS', 'LIC'];
function parseCode(raw) {
  const c = String(raw == null ? '' : raw).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CODES, c) ? c : null;
}

/* ------------------------------------------------------------------ */
/* Clasificación de las horas de un día                                */
/* turno = {start,end} o null.  Todo en minutos.                       */
/* ------------------------------------------------------------------ */
function classify(start, end, turno, sunFest) {
  const s = toMin(start), e = toMin(end);
  const T = turno ? { s: toMin(turno.start), e: toMin(turno.end) } : { s, e };
  const ov = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const wk = Math.max(0, e - s - LUNCH);                              // trabajadas (sin almuerzo)
  const tw = Math.max(0, T.e - T.s - LUNCH);                          // jornada del turno
  const covered = ov(s, e, T.s, T.e);
  const sh = (T.e - T.s) - covered;                                   // faltante dentro del turno
  const xb = Math.max(0, Math.min(e, T.s) - s);                       // antes del turno
  const xa = Math.max(0, e - Math.max(s, T.e));                       // después del turno
  const ni = ov(Math.max(s, T.s), Math.min(e, T.e), NIGHT, 1440);     // nocturnas dentro del turno
  const na = ov(Math.max(s, T.e), e, NIGHT, 1440);                    // nocturnas pasado el turno
  const xdiurnal = xb + (xa - na);                                    // extra diurna
  const hef = sunFest ? xdiurnal : 0;                                 // solo dom/festivo va a nómina
  const counter = sunFest ? 0 - sh : xdiurnal - sh;                      // lo que suma al contador de horas
  return { wk, tw, sf: sunFest ? 1 : 0, ni, na, xb, xa, sh, hef, net: xb + xa - sh, counter };
}
/* Horas que una celda aporta a la nómina */
function pay(c) {
  const z = { 'HRN': 0, 'HRND&F': 0, 'HEND&F': 0, 'HEF': 0, 'FEST': 0 };
  if (!c) return z;
  if (c.sf) return { 'HRN': 0, 'HRND&F': c.ni, 'HEND&F': c.na, 'HEF': c.hef, 'FEST': c.tw };
  return { 'HRN': c.ni + c.na, 'HRND&F': 0, 'HEND&F': 0, 'HEF': 0, 'FEST': 0 };
}
/* Texto corto con lo que queda fuera del turno */
function describeExtra(c) {
  const p = [];
  if (c.xb) p.push(`+${fmtDur(c.xb)} antes`);
  if (c.xa) p.push(`+${fmtDur(c.xa)} después`);
  if (c.sh) p.push(`-${fmtDur(c.sh)} faltantes`);
  return p.length ? p.join(' · ') : 'sin horas fuera del turno';
}
/* Cierre sugerido: el turno que termina a las 20:00 o después y más cerca de la salida sin pasarse */
function suggestCierre(shifts, end) {
  const e = toMin(end);
  if (e < CLOSE_FROM) return null;
  const cands = shifts.filter(t => toMin(t.end) >= CLOSE_FROM && toMin(t.end) <= e);
  if (!cands.length) return null;
  return cands.reduce((a, b) => (toMin(b.end) > toMin(a.end) ? b : a));
}

/* ------------------------------------------------------------------ */
/* INV: dos días seguidos forman un inventario (7 HRN + 2 HEN)         */
/* ------------------------------------------------------------------ */
function invPairs(dates) {                       // fechas ordenadas -> primera fecha de cada pareja
  const out = []; let run = [];
  const flush = () => { for (let i = 0; i + 1 < run.length; i += 2) out.push(run[i]); run = []; };
  for (const d of dates) {
    if (run.length && addDays(run[run.length - 1], 1) === d) run.push(d);
    else { flush(); run = [d]; }
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* Descansos de la semana (domingo a sábado)                           */
/* cellAt(fecha) -> {code,start,end} | null                            */
/* dec = { disc:Set(fechas de D descontados), partida:{domingo:bool} } */
/* ------------------------------------------------------------------ */
function weekEvents(cellAt, ws, dec) {
  const evs = [], invs = [];
  for (let i = -1; i <= 7; i++) { const d = addDays(ws, i); const c = cellAt(d); if (c && c.code === 'INV') invs.push(d); }
  invPairs(invs).forEach(d => { if (d >= ws && d <= addDays(ws, 6)) evs.push({ type: 'INV', date: d }); });
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i), c = cellAt(d);
    if (!c) continue;
    if (c.code === 'C') evs.push({ type: 'C', date: d });
    if (c.code === 'D') evs.push({ type: 'D', date: d, disc: dec.disc.has(d) });
  }
  if (dec.partida && dec.partida[ws]) evs.push({ type: 'PREV', date: ws });
  return evs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
function sundayWorked(cellAt, ws) {
  const c = cellAt(ws);
  return !!c && (c.code === 'INV' || (!c.code && c.start && c.end));
}
/* Revisa lo que pasa al cambiar la celda de `date`.
   Devuelve {status:'ok'} | {status:'block',msg} | {status:'ask',candidate,events,ws} */
function restFlow(cellBefore, cellAfter, date, dec) {
  const ws = weekStart(date);
  const before = weekEvents(cellBefore, ws, dec);
  const after = weekEvents(cellAfter, ws, dec);
  const fresh = after.filter(a => !before.some(b => b.type === a.type && b.date === a.date));
  if (!fresh.length) return { status: 'ok' };

  // INC / LIC / AUS antes del descanso: no se permite
  const incs = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i), c = cellAfter(d);
    if (c && ['INC', 'LIC', 'AUS'].includes(c.code)) incs.push({ date: d, code: c.code });
  }
  for (const r of fresh) {
    const bad = incs.find(x => x.date < r.date);
    if (bad) return { status: 'block', msg: `No se puede registrar un descanso (${r.type === 'INV' ? 'INV' : r.type}) el ${r.date} porque antes, el ${bad.date}, hay una ${CODES[bad.code]} (${bad.code}) en la misma semana.` };
  }

  // Con un inventario (par de INV) la semana no puede tener ni C ni D
  if (after.some(x => x.type === 'INV') && after.some(x => x.type !== 'INV')) {
    return { status: 'block', msg: 'Si la semana tiene un inventario (dos INV seguidos), no puede tener ni C ni D: el inventario ya cuenta como el descanso de esa semana.' };
  }

  // Doble descanso
  const counted = after.filter(x => !(x.type === 'D' && x.disc));
  if (counted.length <= 1) return { status: 'ok' };
  const ds = counted.filter(x => x.type === 'D');
  const pick = ds.find(x => fresh.some(f => f.type === 'D' && f.date === x.date)) || ds[0];
  if (!pick) {
    return { status: 'block', msg: 'Esta semana ya tiene su descanso (' + counted.map(x => `${x.type} ${x.date}`).join(', ') + '). Solo un D adicional se puede descontar como horas pendientes; una C o un INV extra no se permiten.' };
  }
  return { status: 'ask', candidate: pick.date, events: counted, ws };
}

/* ------------------------------------------------------------------ */
/* Plazos de edición                                                   */
/* ------------------------------------------------------------------ */
function closingDeadline(dateStr) {                 // hasta el día 5 del mes siguiente (inclusive)
  const [y, m] = dateStr.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return new Date(ny, nm - 1, 5, 23, 59, 59, 999).getTime();
}
/* 'free' | 'comment' | 'admin' */
function editPolicy(prev, dateStr, now) {
  if (now > closingDeadline(dateStr)) return 'admin';
  if (!prev) return 'free';
  if (now - new Date(prev.createdAt).getTime() > EDIT_FREE_MS) return 'comment';
  return 'free';
}

/* ------------------------------------------------------------------ */
/* Resumen de un periodo (Q1, Q2 o mes) de una persona                 */
/* list: todas sus entradas disponibles (con contexto de otros meses)  */
/* ------------------------------------------------------------------ */
function summarize(list, from, to, base) {
  const r = {
    days: base, INC: 0, VAC: 0, AUS: 0, LIC: 0, C: 0, D: 0, F: 0, invDays: 0, invPairs: 0,
    sfDays: 0, sfMin: 0, HFC: 0, HF: 0, HRN: 0, 'HRND&F': 0, 'HEND&F': 0, HEN: 0, HEF: 0,
    workedDays: 0, workedMin: 0, counter: 0, net: 0,
  };
  const all = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const invAll = all.filter(e => e.code === 'INV').map(e => e.date);
  const pairs = invPairs(invAll).filter(d => d >= from && d <= to);
  r.invPairs = pairs.length;
  r.HRN += pairs.length * 7 * 60;
  r.HEN += pairs.length * 2 * 60;
  for (const en of all) {
    if (en.date < from || en.date > to) continue;
    if (en.code) {
      if (NONWORK.includes(en.code)) r[en.code]++;
      else if (en.code === 'INV') { r.invDays++; r.workedDays++; }
      else r[en.code]++;                                  // C, D, F
      continue;
    }
    if (en.start && en.end && en.calc) {
      const c = en.calc, p = pay(c);
      r.workedDays++; r.workedMin += c.wk; r.counter += c.counter; r.net += c.net;
      r.HRN += p.HRN; r['HRND&F'] += p['HRND&F']; r['HEND&F'] += p['HEND&F']; r.HEF += p.HEF;
      if (c.sf) { r.sfDays++; r.sfMin += c.tw; }
    }
  }
  r.days = base - (r.INC + r.VAC + r.AUS + r.LIC);
  if (r.sfDays >= 3) r.HF = r.sfMin; else r.HFC = r.sfMin;
  return r;
}


/* ------------------------------------------------------------------ */
/* Semáforo del saldo de horas                                         */
/* negativo o más de 7 h: rojo · más de 4 h: amarillo · hasta 4 h: verde */
/* ------------------------------------------------------------------ */
function semaforo(min) {
  if (min < 0 || min > 7 * 60) return 'red';
  if (min > 4 * 60) return 'yellow';
  return 'green';
}

/* ------------------------------------------------------------------ */
/* Comentario de nómina (mensual)                                      */
/* DOM: 6-20-27 // FEST: 12 // 8 HRN - 2 HEN INV O. AMERICAS 21SEP     */
/* ------------------------------------------------------------------ */
const MON3 = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const fmtInvDate = s => `${+s.slice(8)}${MON3[+s.slice(5, 7) - 1]}`;
/* Fecha de la primera de cada pareja de INV dentro del periodo */
function invPairDates(list, from, to) {
  return invPairs(list.filter(e => e.code === 'INV').map(e => e.date).sort()).filter(d => d >= from && d <= to);
}
function buildComment(list, from, to, sum, stores) {
  const dom = [], fest = [];
  list.forEach(e => {
    if (e.date < from || e.date > to || e.code || !e.start || !e.end || !e.calc) return;
    if (isHoliday(e.date)) fest.push(+e.date.slice(8));            // domingo y festivo a la vez = festivo
    else if (dow(e.date) === 0) dom.push(+e.date.slice(8));
  });
  dom.sort((a, b) => a - b); fest.sort((a, b) => a - b);
  const segs = [];
  if (dom.length) segs.push('DOM: ' + dom.join('-'));
  if (fest.length) segs.push('FEST: ' + fest.join('-'));
  const hrs = ['HRN', 'HRND&F', 'HEND&F', 'HEN', 'HEF'].filter(k => sum[k])
    .map(k => `${String(hoursDec(sum[k])).replace('.', ',')} ${k}`).join(' - ');
  const inv = invPairDates(list, from, to).map(d => `INV ${(stores && stores[d]) || '(falta la tienda)'} ${fmtInvDate(d)}`).join(' - ');
  const tail = [hrs, inv].filter(Boolean).join(' ');
  if (tail) segs.push(tail);
  return segs.join(' // ') || 'Sin novedades';
}

const api = {
  LUNCH, NIGHT, CLOSE_FROM, DAY_MIN, EDIT_FREE_MS, CODES, NONWORK,
  ymd, parseDate, addDays, dow, weekStart, daysInMonth, monthOf,
  easter, holidays, holidayName, isHoliday, isSunFest, monthHolidays,
  parseTime, toMin, fmtDur, hoursDec, parseHours, parseCode,
  classify, pay, describeExtra, suggestCierre, invPairs,
  weekEvents, sundayWorked, restFlow, closingDeadline, editPolicy, summarize,
  semaforo, fmtInvDate, invPairDates, buildComment,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.MH_CORE = api;
})(typeof window !== 'undefined' ? window : globalThis);
