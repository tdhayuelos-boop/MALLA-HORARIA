/* =====================================================================
   app.js  ·  Pantalla principal: ingreso, malla, avisos y correcciones
   (la nómina, el registro y los Excel están en pay.js)
   ===================================================================== */
(function () {
'use strict';
const C = window.MH_CORE, DB = window.MH_DB, CFG = window.APP_CONFIG || {};
const ADMIN_CODE = String(CFG.ADMIN_CODE || '9462');
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const DIAS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const key = (e, d) => e + '|' + d;
const DEFAULT_SHIFTS = [
  { code: 'APERTURA 2', start: '10:00', end: '18:00' },
  { code: 'APERTURA 3', start: '11:00', end: '19:00' },
  { code: 'CIERRE 2', start: '12:00', end: '20:00' },
  { code: 'CIERRE 3', start: '13:00', end: '21:00' },
];

const S = {
  user: null, y: 0, m: 0, tab: 'malla', hl: null,
  employees: [], shifts: [], entries: new Map(), decisions: [], adjustments: [], balPrev: {},
  queue: Promise.resolve(),
};
const A = window.MH_APP = { S, C, DB, $, esc, key, MESES, DIAS, DIAS_L, ADMIN_CODE };

/* ------------------------------------------------------------------ */
/* Utilidades de pantalla                                              */
/* ------------------------------------------------------------------ */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3400);
}
window.MH_toast = toast;
const fd = s => `${+s.slice(8)} ${MESES[+s.slice(5, 7) - 1].slice(0, 3)}`;
const fdl = s => `${DIAS_L[C.dow(s)]} ${+s.slice(8)} de ${MESES[+s.slice(5, 7) - 1]}`;
const signed = min => (min > 0 ? '+' : min < 0 ? '−' : '') + C.fmtDur(Math.abs(min));
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
Object.assign(A, { toast, fd, fdl, signed });

/* ---------------- ventanas ---------------- */
let cancelHandler = null;
function showOverlay(html, wide) {
  $('#modal').innerHTML = html;
  $('#modal').classList.toggle('wide', !!wide);
  $('#overlay').classList.add('show');
}
function hideOverlay() { $('#overlay').classList.remove('show'); $('#modal').innerHTML = ''; cancelHandler = null; }
$('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay' && cancelHandler) cancelHandler(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#overlay').classList.contains('show') && cancelHandler) cancelHandler(); });

/* dialog: muestra botones y devuelve el valor del que se pulse (o `cancel` con Esc) */
function dialog({ title, body = '', buttons = [{ label: 'Aceptar', value: true, cls: 'primary' }], cancel = null, stack = false, wide = false }) {
  return new Promise(res => {
    const finish = v => { hideOverlay(); res(v); };
    showOverlay(`<h3>${esc(title)}</h3><div class="mbody">${body}</div><div class="${stack ? 'opts' : 'foot'}">${buttons.map((b, i) => `<button class="${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div>`, wide);
    cancelHandler = () => finish(cancel);
    $('#modal').querySelectorAll('button[data-i]').forEach(btn => { btn.onclick = () => finish(buttons[+btn.dataset.i].value); });
  });
}
/* promptForm: formulario con campos; devuelve {campo: valor} o null si se cancela */
function promptForm({ title, body = '', fields, okLabel = 'Guardar', cancelLabel = 'Cancelar' }) {
  return new Promise(res => {
    const finish = v => { hideOverlay(); res(v); };
    const f = fields.map(x => {
      const common = `name="${x.id}" ${x.placeholder ? `placeholder="${esc(x.placeholder)}"` : ''}`;
      const inner = x.type === 'textarea'
        ? `<textarea ${common} rows="3">${esc(x.value || '')}</textarea>`
        : `<input ${common} type="${x.type || 'text'}" value="${esc(x.value || '')}" autocomplete="off">`;
      return `<label class="fl">${esc(x.label)}${inner}</label>`;
    }).join('');
    showOverlay(`<h3>${esc(title)}</h3><div class="mbody">${body}</div><form id="pf">${f}<div class="err" id="pfErr"></div><div class="foot"><button type="button" id="pfCancel">${esc(cancelLabel)}</button><button class="primary" type="submit">${esc(okLabel)}</button></div></form>`);
    cancelHandler = () => finish(null);
    const form = $('#pf');
    $('#pfCancel').onclick = () => finish(null);
    form.onsubmit = e => {
      e.preventDefault();
      const out = {};
      for (const x of fields) {
        const v = form.elements[x.id].value.trim();
        if (x.required && !v) { $('#pfErr').textContent = `Falta: ${x.label}.`; form.elements[x.id].focus(); return; }
        out[x.id] = v;
      }
      finish(out);
    };
    const first = form.querySelector('input,textarea'); if (first) first.focus();
  });
}
Object.assign(A, { dialog, promptForm, showOverlay, hideOverlay, setCancel: fn => { cancelHandler = fn; } });

/* ------------------------------------------------------------------ */
/* Claves y usuarios                                                   */
/* ------------------------------------------------------------------ */
async function hashPass(code, pass) {
  const text = `malla:${code}:${pass}`;
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;                       // respaldo si el navegador no tiene crypto.subtle
  for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'c53:' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
A.hashPass = hashPass;

function loginUI() {
  return new Promise(resolve => {
    const box = $('#login'); box.hidden = false;
    const el = id => $(id);
    let stage = 'code', existing = null;
    const err = m => { el('#lgErr').textContent = m || ''; };
    const reset = () => {
      stage = 'code'; existing = null;
      ['#lgNameRow', '#lgPassRow', '#lgPass2Row'].forEach(i => { el(i).hidden = true; });
      el('#lgGo').textContent = 'Continuar'; el('#loginHint').textContent = 'Escribe tu código para entrar.'; err('');
    };
    reset();
    el('#lgCode').value = ''; el('#lgName').value = ''; el('#lgPass').value = ''; el('#lgPass2').value = '';
    el('#lgCode').focus();
    el('#lgCode').oninput = () => { if (stage !== 'code') reset(); };
    $('#loginForm').onsubmit = async e => {
      e.preventDefault(); err('');
      const code = el('#lgCode').value.trim();
      try {
        if (stage === 'code') {
          if (!code) return err('Escribe tu código.');
          const u = await DB.getUser(code);
          if (u) {
            stage = 'pass'; existing = u; el('#lgPassRow').hidden = false;
            el('#loginHint').textContent = `Hola, ${u.name}. Escribe tu clave.`; el('#lgGo').textContent = 'Entrar'; el('#lgPass').focus();
          } else {
            stage = 'new'; ['#lgNameRow', '#lgPassRow', '#lgPass2Row'].forEach(i => { el(i).hidden = false; });
            el('#loginHint').textContent = code === ADMIN_CODE
              ? 'Código ADMIN nuevo: escribe tu nombre y elige tu clave. Debes ser tú quien la ponga.'
              : 'Código nuevo: escribe tu nombre y elige una clave.';
            el('#lgGo').textContent = 'Crear y entrar'; el('#lgName').focus();
          }
          return;
        }
        const pass = el('#lgPass').value;
        if (stage === 'pass') {
          if (await hashPass(existing.code, pass) !== existing.hash) return err('Clave incorrecta.');
          box.hidden = true; return resolve({ user: existing, fresh: true });
        }
        const name = el('#lgName').value.trim();
        if (!name) return err('Escribe tu nombre.');
        if (pass.length < 4) return err('La clave debe tener al menos 4 caracteres.');
        if (pass !== el('#lgPass2').value) return err('Las claves no coinciden.');
        const u = { code, name, hash: await hashPass(code, pass), is_admin: code === ADMIN_CODE };
        await DB.createUser(u);
        box.hidden = true; resolve({ user: u, fresh: true, created: true });
      } catch (x) { err('No se pudo continuar: ' + (x.message || x)); }
    };
  });
}

/* ------------------------------------------------------------------ */
/* Registro de movimientos                                             */
/* ------------------------------------------------------------------ */
async function logRow(r) {
  return DB.addLog({ userCode: S.user.code, userName: S.user.name, ...r });
}
A.logRow = logRow;
function describeEntry(en) {
  if (!en) return '';
  if (en.code) return `${en.code} · ${C.CODES[en.code]}`;
  if (!en.start && !en.end) return '';
  if (!en.start || !en.end) return `${en.start || '?'}–${en.end || '?'} (incompleto)`;
  let s = `${en.start}–${en.end}`;
  if (en.shift) { s += ` · ${en.shift}`; if (en.net) s += ` (${en.net > 0 ? '+' : '-'}${C.fmtDur(Math.abs(en.net))})`; }
  else s += ' · sin turno';
  return s;
}
A.describeEntry = describeEntry;

/* ------------------------------------------------------------------ */
/* Barra de mes y año                                                  */
/* ------------------------------------------------------------------ */
function buildPeriodBar() {
  $('#selMonth').innerHTML = MESES.map((m, i) => `<option value="${i + 1}">${m[0].toUpperCase() + m.slice(1)}</option>`).join('');
  $('#selMonth').onchange = () => { S.m = +$('#selMonth').value; S.hl = null; loadMonth(); };
  $('#selYear').onchange = () => { const y = +$('#selYear').value; if (y >= 2000 && y <= 2100) { S.y = y; S.hl = null; loadMonth(); } else renderBar(); };
  $('#prev').onclick = () => goMonth(-1);
  $('#next').onclick = () => goMonth(1);
  $('#dayPick').onchange = e => {
    const v = e.target.value; if (!v) return;
    const [y, m, d] = v.split('-').map(Number); S.y = y; S.m = m; S.hl = d; loadMonth();
  };
}
function goMonth(delta) {
  S.m += delta; if (S.m > 12) { S.m = 1; S.y++; } if (S.m < 1) { S.m = 12; S.y--; }
  S.hl = null; loadMonth();
}
function renderBar() {
  $('#selMonth').value = S.m; $('#selYear').value = S.y;
  const hs = C.monthHolidays(S.y, S.m);
  $('#holidays').innerHTML = hs.length
    ? '<span class="muted">Festivos:</span> ' + hs.map(h => `<span class="chip" title="${esc(h.name)}">${h.day} · ${esc(h.name)}</span>`).join('')
    : '<span class="none">Este mes no tiene festivos.</span>';
}

/* ------------------------------------------------------------------ */
/* Carga de datos del mes                                              */
/* ------------------------------------------------------------------ */
const monthFrom = () => C.ymd(S.y, S.m, 1);
const monthTo = () => C.ymd(S.y, S.m, C.daysInMonth(S.y, S.m));
async function loadMonth() {
  const list = await DB.entries(C.addDays(monthFrom(), -7), C.addDays(monthTo(), 7));
  S.entries = new Map(list.map(e => [key(e.emp, e.date), e]));
  S.decisions = await DB.decisions();
  S.adjustments = await DB.adjustments();
  await computeBalPrev();
  renderAll();
}
/* Saldo de horas acumulado hasta el mes anterior */
async function computeBalPrev() {
  const from = monthFrom(), per = C.monthOf(from);
  const malla = await DB.counterBefore(from);
  const out = {};
  S.employees.forEach(e => { out[e.id] = { malla: malla[e.id] || 0, adj: 0, disc: 0 }; });
  S.adjustments.forEach(a => { if (a.period < per) { (out[a.emp] = out[a.emp] || { malla: 0, adj: 0, disc: 0 }).adj += a.minutes; } });
  S.decisions.forEach(d => {
    if (d.kind === 'doble_descanso' && d.ref < from) { (out[d.emp] = out[d.emp] || { malla: 0, adj: 0, disc: 0 }).disc -= (d.value && d.value.minutes) || C.DAY_MIN; }
  });
  S.balPrev = out;
}
function empEntries(empId) { const out = []; for (const e of S.entries.values()) if (e.emp === empId) out.push(e); return out; }
function visibleEmployees() {
  const from = monthFrom(), to = monthTo();
  const withEntries = new Set([...S.entries.values()].filter(e => e.date >= from && e.date <= to).map(e => e.emp));
  return S.employees.filter(e => e.active || withEntries.has(e.id));
}
Object.assign(A, { loadMonth, empEntries, visibleEmployees, monthFrom, monthTo });

/* ------------------------------------------------------------------ */
/* Dibujo de las mallas                                                */
/* ------------------------------------------------------------------ */
const dcls = date => {
  const dw = C.dow(date);
  return (C.isHoliday(date) ? 'fest ' : dw === 0 ? 'sun ' : '') + (S.hl && date === C.ymd(S.y, S.m, S.hl) ? 'hl' : '');
};
const codeCls = code => (['C', 'D', 'F'].includes(code) ? 'code-rest' : ['INC', 'LIC', 'AUS', 'VAC'].includes(code) ? 'code-leave' : code === 'INV' ? 'code-inv' : '');
function headCells() {
  let h = '';
  for (let d = 1; d <= C.daysInMonth(S.y, S.m); d++) {
    const date = C.ymd(S.y, S.m, d), nm = C.holidayName(date);
    h += `<th class="${dcls(date)}" data-day="${d}" ${nm ? `title="${esc(nm)}"` : ''}>${d}<small>${DIAS[C.dow(date)]}</small></th>`;
  }
  return h;
}
function renderMain() {
  const emps = visibleEmployees();
  if (!emps.length) { $('#mainGrid').innerHTML = '<div class="empty">No hay personal. Usa el botón “Personal” para agregar.</div>'; return; }
  let html = `<table><thead><tr><th class="name">Persona</th><th class="lbl"></th>${headCells()}<th>Horas trabajadas</th></tr></thead><tbody>`;
  for (const emp of emps) {
    for (const k of ['s', 'e']) {
      html += '<tr>';
      if (k === 's') html += `<td class="name" rowspan="2">${esc(emp.name)}</td>`;
      html += `<td class="lbl">${k === 's' ? 'Entrada' : 'Salida'}</td>`;
      for (let d = 1; d <= C.daysInMonth(S.y, S.m); d++) {
        const date = C.ymd(S.y, S.m, d), en = S.entries.get(key(emp.id, date));
        const v = en ? (en.code || (k === 's' ? en.start : en.end)) : '';
        html += `<td class="${dcls(date)} ${en ? codeCls(en.code) : ''}"><input data-e="${emp.id}" data-d="${date}" data-k="${k}" value="${esc(v || '')}" autocomplete="off"></td>`;
      }
      if (k === 's') html += `<td class="total" rowspan="2" id="tot-${emp.id}"></td>`;
      html += '</tr>';
    }
  }
  $('#mainGrid').innerHTML = html + '</tbody></table>';
}
function cellView(en) {
  if (!en || (!en.code && !en.start && !en.end)) return { cls: '', html: '' };
  if (en.code) return { cls: 'code c-' + en.code, html: esc(C.CODES[en.code]) };
  if (!en.start || !en.end) return { cls: 'part', html: '…' };
  if (!en.shift) return { cls: 'bad', html: `<div>${en.start}</div><div>${en.end}</div>` };
  if (en.net) return { cls: 'adj', html: `${esc(en.shift)}<small>${signed(en.net)}</small>` };
  return { cls: 'ok', html: esc(en.shift) };
}
function renderShifts() {
  const emps = visibleEmployees();
  if (!emps.length) { $('#shiftGrid').innerHTML = ''; return; }
  let html = `<table><thead><tr><th class="name">Persona</th>${headCells()}<th>Contador del mes</th></tr></thead><tbody>`;
  for (const emp of emps) {
    html += `<tr><td class="name">${esc(emp.name)}</td>`;
    for (let d = 1; d <= C.daysInMonth(S.y, S.m); d++) {
      const date = C.ymd(S.y, S.m, d), c = cellView(S.entries.get(key(emp.id, date)));
      html += `<td class="s ${c.cls} ${dcls(date)}" data-e="${emp.id}" data-d="${date}">${c.html}</td>`;
    }
    html += `<td class="extra" id="ext-${emp.id}"></td></tr>`;
  }
  $('#shiftGrid').innerHTML = html + '</tbody></table>';
}
function updateTotals() {
  const from = monthFrom(), to = monthTo();
  for (const emp of visibleEmployees()) {
    let worked = 0, counter = 0;
    for (const en of empEntries(emp.id)) {
      if (en.date < from || en.date > to || !en.calc || !en.start || !en.end || en.code) continue;
      worked += en.calc.wk; counter += en.calc.counter;
    }
    const t = $('#tot-' + emp.id), x = $('#ext-' + emp.id);
    if (t) t.textContent = C.fmtDur(worked);
    if (x) { x.textContent = counter ? signed(counter) : '0 h'; x.className = 'extra ' + (counter > 0 ? 'pos' : counter < 0 ? 'neg' : ''); }
  }
}
function renderAll() {
  renderBar(); renderMain(); renderShifts(); updateTotals();
  if (S.tab === 'nomina' && A.renderNomina) A.renderNomina();
  if (S.tab === 'registro' && A.refreshLogFilters) A.refreshLogFilters();
  if (S.hl) {
    const th = document.querySelector(`#mainGrid th[data-day="${S.hl}"]`);
    if (th) th.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}
Object.assign(A, { renderAll, renderShifts, updateTotals, dcls });

/* ------------------------------------------------------------------ */
/* Plazos de edición                                                   */
/* ------------------------------------------------------------------ */
async function adminAuth() {
  let error = '';
  for (;;) {
    const r = await promptForm({
      title: 'Autorización del ADMIN',
      body: `Este mes ya cerró. Un ADMIN debe autorizar el cambio.${error ? `<div class="err">${esc(error)}</div>` : ''}`,
      fields: [{ id: 'code', label: 'Código ADMIN', required: true }, { id: 'pass', label: 'Clave del ADMIN', type: 'password', required: true }],
      okLabel: 'Autorizar',
    });
    if (!r) return null;
    const u = await DB.getUser(r.code);
    if (u && u.is_admin && u.hash === await hashPass(u.code, r.pass)) return u.code;
    error = 'Código o clave incorrectos.';
  }
}
/* Devuelve {ok, policy, comment, admin} */
async function gatherPolicy(prev, date) {
  const policy = C.editPolicy(prev, date, Date.now());
  if (policy === 'free') return { ok: true, policy, comment: '', admin: null };
  let admin = null;
  if (policy === 'admin') {
    if (S.user.is_admin) admin = S.user.code;
    else { admin = await adminAuth(); if (!admin) return { ok: false }; }
  }
  const [y, m] = date.split('-').map(Number);
  const nm = m === 12 ? 1 : m + 1;
  const r = await promptForm({
    title: policy === 'admin' ? 'Corrección fuera de plazo' : 'Corrección con comentario',
    body: policy === 'admin'
      ? `El plazo para modificar ${MESES[m - 1]} de ${y} terminó el 5 de ${MESES[nm - 1]}. Este cambio queda registrado con la autorización del ADMIN.`
      : 'Pasó más de 1 hora desde que se escribió este dato, así que debes explicar el cambio.',
    fields: [{ id: 'comment', label: 'Motivo del cambio', type: 'textarea', required: true }],
    okLabel: 'Guardar cambio',
  });
  if (!r) return { ok: false };
  return { ok: true, policy, comment: r.comment, admin };
}

/* ------------------------------------------------------------------ */
/* Elegir turno                                                        */
/* ------------------------------------------------------------------ */
/* Devuelve {shift: turno|null} o undefined si se cancela */
async function chooseShift(emp, date, st, en, sunFest, forceList) {
  const sug = forceList ? null : C.suggestCierre(S.shifts, en);
  const head = `${esc(emp.name)} · ${esc(fdl(date))}<br>Registraste <b>${st} – ${en}</b>.`;
  if (sug) {
    const cl = C.classify(st, en, sug, sunFest);
    const r = await dialog({
      title: 'Se detectó un horario no habitual',
      body: `${head}<br>Se sugiere <b>${esc(sug.code)}</b> (${sug.start}–${sug.end}): ${esc(C.describeExtra(cl))}.`,
      buttons: [{ label: `Aceptar ${esc(sug.code)}`, value: 'ok', cls: 'primary' }, { label: 'Elegir otro turno', value: 'other' }],
    });
    if (r === null) return undefined;
    if (r === 'ok') return { shift: sug };
  }
  const opts = S.shifts.map((t, i) => ({
    label: `<b>${esc(t.code)}</b> · ${t.start}–${t.end}<br><span class="small muted">${esc(C.describeExtra(C.classify(st, en, t, sunFest)))}</span>`, value: i,
  }));
  opts.push({ label: 'Dejar sin frase <span style="color:var(--bad)">(se muestran las horas en rojo)</span>', value: -1 });
  const r = await dialog({
    title: sug ? 'Elige el turno' : 'Se detectó un horario no habitual',
    body: `${head} ¿Qué horario deseas poner?`, buttons: opts, stack: true,
  });
  if (r === null) return undefined;
  return { shift: r >= 0 ? S.shifts[r] : null };
}

/* ------------------------------------------------------------------ */
/* Edición de una celda de la malla principal                          */
/* ------------------------------------------------------------------ */
function decisionsOf(empId, drop, add) {
  const disc = new Set(), partida = {};
  const all = S.decisions.filter(d => d.emp === empId && !drop.some(x => x.kind === d.kind && x.ref === d.ref)).concat(add.filter(a => a.emp === empId));
  for (const d of all) {
    if (d.kind === 'doble_descanso') disc.add(d.ref);
    if (d.kind === 'semana_partida') partida[d.ref] = !!(d.value && d.value.descanso);
  }
  return { disc, partida };
}
const EVT = { C: 'compensatorio (C)', D: 'descanso (D)', INV: 'inventario (INV)', PREV: 'descanso en la parte de la semana del mes anterior' };

async function processCell(empId, date) {
  const emp = S.employees.find(e => e.id === empId);
  const prev = S.entries.get(key(empId, date)) || null;
  const q = k => document.querySelector(`input[data-e="${empId}"][data-d="${date}"][data-k="${k}"]`);
  const sIn = q('s'), eIn = q('e');
  const paint = en => {
    const td = sIn && sIn.parentElement, td2 = eIn && eIn.parentElement;
    [td, td2].forEach(t => { if (t) t.className = dcls(date) + ' ' + (en ? codeCls(en.code) : ''); });
  };
  const setInputs = en => { if (sIn) sIn.value = en ? (en.code || en.start || '') : ''; if (eIn) eIn.value = en ? (en.code || en.end || '') : ''; paint(en); };
  const revert = () => setInputs(prev);
  const notices = [];                                         // respuestas a avisos para el registro

  /* 1. Leer lo que escribió el usuario */
  const rawS = sIn.value.trim(), rawE = eIn.value.trim();
  const c1 = C.parseCode(rawS), c2 = C.parseCode(rawE);
  let code = '', st = '', en = '';
  if (c1 || c2) {
    if (c1 && c2 && c1 !== c2) { toast('Los dos recuadros tienen códigos distintos.'); return revert(); }
    code = c1 || c2;
  } else {
    st = C.parseTime(rawS, 's'); en = C.parseTime(rawE, 'e');
    if (st === null || en === null) { toast('Hora no válida. Ejemplos: 8, 8:30, 1430 o un código (C, D, F, INV, INC, VAC, AUS, LIC).'); return revert(); }
    if (st && en && C.toMin(en) <= C.toMin(st)) { toast('La salida debe ser después de la entrada.'); return revert(); }
  }
  const isEmpty = !code && !st && !en;
  const newKey = code || (st || en ? st + '|' + en : '');
  const prevKey = prev ? (prev.code || (prev.start || prev.end ? prev.start + '|' + prev.end : '')) : '';
  if (newKey === prevKey) { setInputs(prev); return; }        // sin cambios

  /* 2. Plazo de edición (1 hora libre, luego comentario, mes cerrado: ADMIN) */
  const prevComplete = prev && (prev.code || (prev.start && prev.end)) ? prev : null;
  const pol = await gatherPolicy(prevComplete, date);
  if (!pol.ok) return revert();
  const detail = pol.policy === 'free' ? null : { plazo: pol.policy, admin: pol.admin };

  const dropDec = S.decisions.filter(d => d.emp === empId && ((d.kind === 'doble_descanso' && d.ref === date) || (d.kind === 'semana_partida' && d.value && d.value.cell === date)));
  const addDec = [];
  const applyDecisions = async () => {
    for (const d of dropDec) await DB.removeDecision(d.emp, d.kind, d.ref);
    for (const d of addDec) await DB.saveDecision({ ...d, by: S.user.code });
    if (dropDec.length || addDec.length) S.decisions = await DB.decisions();
  };
  const logNotices = async () => {
    for (const n of notices) await logRow({ action: 'AVISO', emp: empId, empName: emp.name, refDate: date, after: n });
  };

  /* 3. Borrar la celda */
  if (isEmpty) {
    const id = await logRow({ action: 'BORRADO', emp: empId, empName: emp.name, refDate: date, before: describeEntry(prev), after: '', comment: pol.comment, annuls: prev && prev.logId, detail });
    await DB.removeEntry(empId, date); S.entries.delete(key(empId, date));
    await applyDecisions(); await logNotices();
    setInputs(null); renderShifts(); updateTotals(); refreshOthers();
    return id;
  }

  /* 4. Semana partida (día 1 del mes) */
  if (+date.slice(8) === 1 && C.dow(date) !== 0) {
    const ws = C.weekStart(date);
    let hasPrev = false;
    for (let d = ws; d < date; d = C.addDays(d, 1)) if (S.entries.get(key(empId, d))) { hasPrev = true; break; }
    if (!hasPrev) {
      const r = await dialog({
        title: 'Semana partida',
        body: `El mes empieza a mitad de semana. ¿${esc(emp.name)} tuvo descanso (C, D o INV) entre el ${esc(fd(ws))} y el ${esc(fd(C.addDays(date, -1)))}, en el mes anterior?`,
        buttons: [{ label: 'Sí, ya tuvo descanso', value: true, cls: 'primary' }, { label: 'No', value: false }],
      });
      if (r === null) return revert();
      addDec.push({ emp: empId, kind: 'semana_partida', ref: ws, value: { descanso: r, cell: date } });
      notices.push(`Semana partida (${fd(ws)} a ${fd(C.addDays(date, -1))}): ${r ? 'sí' : 'no'} tuvo descanso en el mes anterior`);
    }
  }

  /* 5. Reglas de descansos */
  if (code === 'D' && C.dow(date) === 0) {
    const r = await dialog({
      title: 'Domingo con D', body: 'Los domingos va C (compensatorio de la semana). ¿Deseas corregir este dato?',
      buttons: [{ label: 'Sí, poner C', value: true, cls: 'primary' }, { label: 'No, dejar D', value: false }],
    });
    if (r === null) return revert();
    notices.push(`Domingo con D: ${r ? 'se corrigió a C' : 'se dejó D'}`);
    if (r) code = 'C';
  }
  const newCell = { code, start: code || st, end: code || en };
  const cellBefore = d => S.entries.get(key(empId, d)) || null;
  const cellAfter = d => (d === date ? newCell : cellBefore(d));
  for (let i = 0; i < 4; i++) {
    const res = C.restFlow(cellBefore, cellAfter, date, decisionsOf(empId, dropDec, addDec));
    if (res.status === 'ok') break;
    if (res.status === 'block') {
      notices.push('No permitido: ' + res.msg);
      await dialog({ title: 'No se puede guardar', body: esc(res.msg), buttons: [{ label: 'Entendido', value: true, cls: 'primary' }], cancel: true });
      await logNotices(); return revert();
    }
    const list = res.events.map(x => `${EVT[x.type]} del ${fd(x.date)}`).join(', ');
    const r = await dialog({
      title: 'Descanso doble',
      body: `La semana del ${esc(fdl(res.ws))} al ${esc(fdl(C.addDays(res.ws, 6)))} ya tiene descanso (${esc(list)}).<br>¿Quieres descontar <b>7 horas pendientes</b> de ${esc(emp.name)} por el descanso extra del ${esc(fdl(res.candidate))}?<br><span class="small muted">Si dices que no, el doble descanso no se guarda.</span>`,
      buttons: [{ label: 'Sí, descontar 7 horas', value: true, cls: 'primary' }, { label: 'No', value: false }],
    });
    if (r === null) return revert();
    if (!r) {
      notices.push(`Doble descanso rechazado (${fd(res.candidate)}): no se guardó el cambio`);
      toast('Doble descanso no permitido: el cambio no se guardó.');
      await logNotices(); return revert();
    }
    addDec.push({ emp: empId, kind: 'doble_descanso', ref: res.candidate, value: { minutes: C.DAY_MIN } });
    notices.push(`Doble descanso: se descuentan 7 h pendientes por el D del ${fd(res.candidate)}`);
  }

  /* 6. Turno y clasificación de horas */
  let shift = null, calc = null;
  if (!code && st && en) {
    const sunFest = C.isSunFest(date);
    const exact = S.shifts.find(x => x.start === st && x.end === en);
    if (exact) shift = exact;
    else {
      const ch = await chooseShift(emp, date, st, en, sunFest, false);
      if (ch === undefined) return revert();
      shift = ch.shift;
    }
    calc = C.classify(st, en, shift, sunFest);
  }

  /* 7. Guardar */
  const nowIso = new Date().toISOString();
  const entry = {
    emp: empId, date, start: code || st, end: code || en, code, shift: shift ? shift.code : null,
    net: calc ? calc.net : 0, counter: calc ? calc.counter : 0, calc,
    createdAt: pol.policy === 'free' && prevComplete ? prevComplete.createdAt : nowIso,
    updatedAt: nowIso, updatedBy: S.user.code, logId: null,
  };
  const wasEmpty = !prevComplete;
  entry.logId = await logRow({
    action: wasEmpty ? 'CELDA' : 'CORRECCION', emp: empId, empName: emp.name, refDate: date,
    before: describeEntry(prev), after: describeEntry(entry), comment: pol.comment, annuls: prevComplete ? prev.logId : null, detail,
  });
  await DB.upsertEntry(entry);
  S.entries.set(key(empId, date), entry);
  await applyDecisions(); await logNotices();
  setInputs(entry); renderShifts(); updateTotals(); refreshOthers();
}
function refreshOthers() { if (S.tab === 'nomina' && A.renderNomina) A.renderNomina(); }

function enqueue(fn) {
  S.queue = S.queue.then(fn).catch(err => { console.error(err); toast('Error: ' + (err.message || err)); return loadMonth(); });
  return S.queue;
}
/* La celda se procesa cuando el cursor sale de ella (así se puede pasar de la entrada a la salida sin avisos a medias) */
$('#mainGrid').addEventListener('focusout', e => {
  const i = e.target; if (i.tagName !== 'INPUT') return;
  const rt = e.relatedTarget;
  if (rt && rt.tagName === 'INPUT' && rt.dataset.e === i.dataset.e && rt.dataset.d === i.dataset.d) return;
  enqueue(() => processCell(i.dataset.e, i.dataset.d));
});
$('#mainGrid').addEventListener('focusin', e => { if (e.target.tagName === 'INPUT') e.target.select(); });
$('#mainGrid').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
A.enqueue = enqueue;

/* ------------------------------------------------------------------ */
/* Detalle de un día y cambio de turno                                 */
/* ------------------------------------------------------------------ */
$('#shiftGrid').addEventListener('click', e => {
  const td = e.target.closest('td.s'); if (!td) return;
  enqueue(() => showDetail(td.dataset.e, td.dataset.d));
});
async function showDetail(empId, date) {
  const emp = S.employees.find(x => x.id === empId), en = S.entries.get(key(empId, date));
  if (!en || (!en.code && !en.start && !en.end)) { toast('Ese día no tiene datos.'); return; }
  const who = `Registrado por ${esc(en.updatedBy || '—')} el ${en.updatedAt ? esc(new Date(en.updatedAt).toLocaleString('es-CO')) : '—'}`;
  const tipo = C.holidayName(date) ? `Festivo (${esc(C.holidayName(date))})` : C.dow(date) === 0 ? 'Domingo' : 'Día normal';
  let rows, buttons = [{ label: 'Cerrar', value: 'x', cls: 'primary' }];
  if (en.code) {
    rows = `<b>Código</b><span>${esc(en.code)} · ${esc(C.CODES[en.code])}</span><b>Tipo de día</b><span>${tipo}</span>`;
  } else if (!en.start || !en.end) {
    rows = `<b>Estado</b><span>Incompleto: falta ${en.start ? 'la salida' : 'la entrada'}</span>`;
  } else {
    const c = en.calc, p = C.pay(c), sh = S.shifts.find(x => x.code === en.shift);
    const paylist = Object.entries(p).filter(([k, v]) => v && k !== 'FEST').map(([k, v]) => `${esc(k)} ${esc(C.fmtDur(v))}`).join(' · ') || '—';
    rows = `
      <b>Horario real</b><span>${en.start} – ${en.end}</span>
      <b>Tipo de día</b><span>${tipo}</span>
      <b>Turno</b><span>${en.shift ? esc(en.shift) + (sh ? ` (${sh.start}–${sh.end})` : '') : '<span style="color:var(--bad)">Sin frase</span>'}</span>
      <b>Trabajadas</b><span>${esc(C.fmtDur(c.wk))} (sin 1 h de almuerzo)</span>
      <b>Fuera del turno</b><span>${esc(C.describeExtra(c))}</span>
      <b>Contador de horas</b><span>${c.counter ? esc(signed(c.counter)) : '0 h'}</span>
      <b>En la nómina</b><span>${paylist}${c.sf ? ` · jornada dom/festivo ${esc(C.fmtDur(c.tw))}` : ''}</span>`;
    buttons.unshift({ label: 'Cambiar turno', value: 'chg' });
  }
  const r = await dialog({
    title: `${emp.name} · ${fdl(date)}`, wide: true,
    body: `<div class="kv">${rows}<b>Último cambio</b><span class="small">${who}</span></div>`, buttons, cancel: 'x',
  });
  if (r === 'chg') await changeShift(empId, date);
}
async function changeShift(empId, date) {
  const emp = S.employees.find(x => x.id === empId), prev = S.entries.get(key(empId, date));
  const pol = await gatherPolicy(prev, date); if (!pol.ok) return;
  const sunFest = C.isSunFest(date);
  const ch = await chooseShift(emp, date, prev.start, prev.end, sunFest, true);
  if (ch === undefined) return;
  const calc = C.classify(prev.start, prev.end, ch.shift, sunFest);
  const nowIso = new Date().toISOString();
  const entry = { ...prev, shift: ch.shift ? ch.shift.code : null, calc, net: calc.net, counter: calc.counter, updatedAt: nowIso, updatedBy: S.user.code, createdAt: pol.policy === 'free' ? prev.createdAt : nowIso };
  if (entry.shift === prev.shift) return;
  entry.logId = await logRow({
    action: 'CORRECCION', emp: empId, empName: emp.name, refDate: date, before: describeEntry(prev), after: describeEntry(entry),
    comment: pol.comment || 'Cambio de turno', annuls: prev.logId, detail: pol.policy === 'free' ? null : { plazo: pol.policy, admin: pol.admin },
  });
  await DB.upsertEntry(entry); S.entries.set(key(empId, date), entry);
  renderShifts(); updateTotals(); refreshOthers();
}

/* ------------------------------------------------------------------ */
/* Personal                                                            */
/* ------------------------------------------------------------------ */
function openStaff() {
  const rows = S.employees.map(e => `
    <div class="row">
      <input value="${esc(e.name)}" data-rename="${e.id}" ${e.active ? '' : 'disabled'}>
      ${e.active ? `<button class="danger" data-off="${e.id}">Quitar</button>` : `<button data-on="${e.id}">Reactivar</button>`}
    </div>`).join('');
  showOverlay(`
    <h3>Personal</h3>
    <div class="mbody">Al quitar a alguien se conserva su historial en los meses donde ya tenía horarios.</div>
    ${rows || '<p>Aún no hay personal.</p>'}
    <div class="row"><input id="newName" placeholder="Nombre de la nueva persona"><button class="primary" id="addEmp">Agregar</button></div>
    <div class="foot"><button id="cls">Cerrar</button></div>`);
  cancelHandler = hideOverlay;
  const pl = (action, e, before, after) => logRow({ action: 'PERSONAL', emp: e.id, empName: e.name, before, after, detail: { accion: action } });
  $('#cls').onclick = hideOverlay;
  $('#addEmp').onclick = async () => {
    const name = $('#newName').value.trim(); if (!name) return;
    const e = await DB.addEmployee(name); S.employees.push(e);
    await pl('agregar', e, '', `Agregó a ${name}`); renderAll(); openStaff();
  };
  $('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#addEmp').click(); });
  $('#modal').querySelectorAll('[data-rename]').forEach(i => { i.onchange = async () => {
    const e = S.employees.find(x => x.id === i.dataset.rename), name = i.value.trim();
    if (!name || name === e.name) { return openStaff(); }
    const old = e.name; await DB.updateEmployee(e.id, { name }); e.name = name;
    await pl('renombrar', e, old, name); renderAll();
  }; });
  $('#modal').querySelectorAll('[data-off]').forEach(b => { b.onclick = async () => {
    const e = S.employees.find(x => x.id === b.dataset.off);
    if (!confirm(`¿Quitar a ${e.name} de la malla?`)) return;
    await DB.updateEmployee(e.id, { active: false }); e.active = false;
    await pl('quitar', e, 'Activo', 'Quitado'); renderAll(); openStaff();
  }; });
  $('#modal').querySelectorAll('[data-on]').forEach(b => { b.onclick = async () => {
    const e = S.employees.find(x => x.id === b.dataset.on);
    await DB.updateEmployee(e.id, { active: true }); e.active = true;
    await pl('reactivar', e, 'Quitado', 'Activo'); renderAll(); openStaff();
  }; });
}

/* ------------------------------------------------------------------ */
/* Turnos habilitados                                                  */
/* ------------------------------------------------------------------ */
function openShifts(draft) {
  draft = draft || S.shifts.map(s => ({ ...s }));
  const rows = draft.map((s, i) => `
    <div class="row">
      <input value="${esc(s.code)}" data-f="code" data-i="${i}" style="flex:2">
      <input value="${esc(s.start)}" data-f="start" data-i="${i}" style="flex:1" placeholder="10:00">
      <input value="${esc(s.end)}" data-f="end" data-i="${i}" style="flex:1" placeholder="18:00">
      <button class="danger" data-del="${i}">✕</button>
    </div>`).join('');
  showOverlay(`
    <h3>Turnos habilitados</h3>
    <div class="mbody">Nombre, entrada y salida (24 h). Cuando un horario coincide con uno de estos, la malla de abajo muestra su nombre. Los cambios aplican de aquí en adelante; lo ya registrado no se recalcula.</div>
    ${rows}
    <div class="row"><button id="addShift">+ Agregar turno</button></div>
    <div class="foot"><button id="cls">Cancelar</button><button class="primary" id="save">Guardar</button></div>`);
  cancelHandler = hideOverlay;
  const sync = () => $('#modal').querySelectorAll('input[data-f]').forEach(i => { draft[i.dataset.i][i.dataset.f] = i.value; });
  $('#cls').onclick = hideOverlay;
  $('#addShift').onclick = () => { sync(); draft.push({ code: 'NUEVO', start: '09:00', end: '17:00' }); openShifts(draft); };
  $('#modal').querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { sync(); draft.splice(+b.dataset.del, 1); openShifts(draft); }; });
  $('#save').onclick = async () => {
    sync();
    const clean = [];
    for (const s of draft) {
      const a = C.parseTime(s.start, 's'), b = C.parseTime(s.end, 's');
      if (!s.code.trim() || !a || !b || C.toMin(b) <= C.toMin(a)) { toast('Revisa los turnos: nombre y horas válidas (la salida después de la entrada).'); return; }
      clean.push({ code: s.code.trim().toUpperCase(), start: a, end: b });
    }
    if (new Set(clean.map(x => x.code)).size !== clean.length) { toast('Hay nombres de turno repetidos.'); return; }
    const txt = l => l.map(s => `${s.code} ${s.start}-${s.end}`).join(' | ');
    const before = txt(S.shifts);
    await DB.saveShifts(clean); S.shifts = clean;
    await logRow({ action: 'TURNOS', before, after: txt(clean) });
    hideOverlay(); renderAll(); toast('Turnos guardados');
  };
}

/* ------------------------------------------------------------------ */
/* Mi cuenta y usuarios                                                */
/* ------------------------------------------------------------------ */
async function openAccount() {
  const users = S.user.is_admin ? await DB.listUsers() : [];
  const rows = users.map(u => `<div class="row"><span style="flex:1"><b>${esc(u.name)}</b> <span class="muted small">código ${esc(u.code)}${u.is_admin ? ' · ADMIN' : ''}</span></span><button data-reset="${esc(u.code)}">Restablecer clave</button></div>`).join('');
  showOverlay(`
    <h3>${esc(S.user.name)} <span class="muted small">código ${esc(S.user.code)}${S.user.is_admin ? ' · ADMIN' : ''}</span></h3>
    <div class="foot" style="justify-content:flex-start"><button id="chgPass">Cambiar mi clave</button><button id="logout" class="danger">Salir</button></div>
    ${S.user.is_admin ? `<h3 style="margin-top:16px">Usuarios</h3><div class="mbody small muted">Si alguien olvida su clave, restablécela aquí.</div>${rows}` : ''}
    <div class="foot"><button id="cls" class="primary">Cerrar</button></div>`);
  cancelHandler = hideOverlay;
  $('#cls').onclick = hideOverlay;
  $('#logout').onclick = async () => { await logRow({ action: 'SESION', after: 'Cerró sesión' }); lsSet('malla_session', null); location.reload(); };
  $('#chgPass').onclick = async () => {
    hideOverlay();
    let error = '';
    for (;;) {
      const r = await promptForm({
        title: 'Cambiar mi clave', body: error ? `<div class="err">${esc(error)}</div>` : '',
        fields: [{ id: 'cur', label: 'Clave actual', type: 'password', required: true }, { id: 'n1', label: 'Clave nueva', type: 'password', required: true }, { id: 'n2', label: 'Repite la clave nueva', type: 'password', required: true }],
      });
      if (!r) return;
      const me = await DB.getUser(S.user.code);
      if (me.hash !== await hashPass(me.code, r.cur)) { error = 'La clave actual no es correcta.'; continue; }
      if (r.n1.length < 4) { error = 'La clave nueva debe tener al menos 4 caracteres.'; continue; }
      if (r.n1 !== r.n2) { error = 'Las claves nuevas no coinciden.'; continue; }
      await DB.updateUser(me.code, { hash: await hashPass(me.code, r.n1) });
      await logRow({ action: 'USUARIO', after: 'Cambió su clave' }); toast('Clave cambiada.'); return;
    }
  };
  $('#modal').querySelectorAll('[data-reset]').forEach(b => { b.onclick = async () => {
    const code = b.dataset.reset; hideOverlay();
    const r = await promptForm({ title: `Restablecer clave (código ${code})`, fields: [{ id: 'n1', label: 'Clave nueva', type: 'password', required: true }] });
    if (!r) return;
    if (r.n1.length < 4) { toast('La clave debe tener al menos 4 caracteres.'); return; }
    await DB.updateUser(code, { hash: await hashPass(code, r.n1) });
    await logRow({ action: 'USUARIO', after: `Restableció la clave del código ${code}` }); toast('Clave restablecida.');
  }; });
}

/* ------------------------------------------------------------------ */
/* Pestañas e inicio                                                   */
/* ------------------------------------------------------------------ */
function switchTab(name) {
  S.tab = name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  ['malla', 'nomina', 'registro'].forEach(t => { $('#tab-' + t).hidden = t !== name; });
  if (name === 'nomina' && A.renderNomina) A.renderNomina();
  if (name === 'registro' && A.openLogTab) A.openLogTab();
}

async function init() {
  $('#modeBadge').textContent = DB.mode === 'sb' ? 'Guardado en Supabase' : 'Guardado solo en este navegador';
  $('#modeBadge').classList.toggle('on', DB.mode === 'sb');
  const now = new Date(); S.y = now.getFullYear(); S.m = now.getMonth() + 1;
  buildPeriodBar();
  document.querySelectorAll('#tabs button').forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });
  $('#btnStaff').onclick = openStaff;
  $('#btnShifts').onclick = () => openShifts();
  $('#btnUser').onclick = () => enqueue(openAccount);

  try {
    let user = null;
    const saved = lsGet('malla_session');
    if (saved) { const u = await DB.getUser(saved); if (u) user = u; }
    if (!user) {
      const r = await loginUI(); user = r.user;
      S.user = { code: user.code, name: user.name, is_admin: !!user.is_admin };
      await logRow({ action: r.created ? 'USUARIO' : 'SESION', after: r.created ? `Creó el usuario ${user.name} (código ${user.code})` : 'Inició sesión' });
    }
    S.user = { code: user.code, name: user.name, is_admin: !!user.is_admin };
    lsSet('malla_session', user.code);
    $('#btnUser').textContent = S.user.is_admin && S.user.name.toUpperCase() !== 'ADMIN' ? `${S.user.name} · ADMIN` : S.user.name;

    S.employees = await DB.employees();
    if (!S.employees.length) {
      S.employees.push(await DB.addEmployee('Persona 1'));
      S.employees.push(await DB.addEmployee('Persona 2'));
    }
    S.shifts = await DB.shifts() || [];
    if (!S.shifts.length) { S.shifts = DEFAULT_SHIFTS.map(s => ({ ...s })); await DB.saveShifts(S.shifts); }
    await loadMonth();
  } catch (e) { console.error(e); toast('Error al iniciar: ' + (e.message || e)); }
}
window.addEventListener('load', init);
})();
