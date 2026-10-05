/* =====================================================================
   pay.js  ·  Nómina (Q1, Q2 y mes), horas manuales, registro tipo
   consola y descargas en Excel.
   ===================================================================== */
(function () {
'use strict';
const A = window.MH_APP;
const { S, C, DB, $, esc, key, MESES, fd, signed, toast, dialog, promptForm } = A;

/* ------------------------------------------------------------------ */
/* Cálculo de la nómina                                                */
/* ------------------------------------------------------------------ */
function periods() {
  const y = S.y, m = S.m, n = C.daysInMonth(y, m);
  return [
    { id: 'q1', label: 'Q1', sub: '1–15', from: C.ymd(y, m, 1), to: C.ymd(y, m, 15), base: 15 },
    { id: 'q2', label: 'Q2', sub: `16–${n}`, from: C.ymd(y, m, 16), to: C.ymd(y, m, n), base: 15 },
    { id: 'm', label: 'Mes', sub: '', from: C.ymd(y, m, 1), to: C.ymd(y, m, n), base: 30 },
  ];
}
function payrollFor(empId) {
  const list = A.empEntries(empId), out = {};
  periods().forEach(p => { out[p.id] = C.summarize(list, p.from, p.to, p.base); });
  return out;
}
function balanceFor(empId) {
  const prev = S.balPrev[empId] || { malla: 0, adj: 0, disc: 0 };
  const from = A.monthFrom(), to = A.monthTo(), per = C.monthOf(from);
  const mallaM = payrollFor(empId).m.counter;
  const adjM = S.adjustments.filter(a => a.emp === empId && a.period === per).reduce((s, a) => s + a.minutes, 0);
  const discs = S.decisions.filter(d => d.emp === empId && d.kind === 'doble_descanso' && d.ref >= from && d.ref <= to);
  const discM = -discs.reduce((s, d) => s + ((d.value && d.value.minutes) || C.DAY_MIN), 0);
  const prevTotal = prev.malla + prev.adj + prev.disc;
  return { prev, prevTotal, mallaM, adjM, discM, discCount: discs.length, total: prevTotal + mallaM + adjM + discM };
}
const ROWS = [
  ['Días (15 / 30 menos INC, VAC, AUS, LIC)', 'days', 'd'],
  ['INC · Incapacidad', 'INC', 'n'], ['VAC · Vacaciones', 'VAC', 'n'], ['AUS · Ausencia', 'AUS', 'n'], ['LIC · Licencia', 'LIC', 'n'],
  ['Domingos y festivos'],
  ['Días dom/festivo trabajados', 'sfDays', 'n'], ['HFC · dom/festivo (1 o 2 días)', 'HFC', 'h'], ['HF · dom/festivo (3 días o más)', 'HF', 'h'],
  ['Recargos nocturnos y extras'],
  ['HRN · Recargo nocturno', 'HRN', 'h'], ['HRND&F · Nocturna dom/festivo', 'HRND&F', 'h'],
  ['HEND&F · Extra nocturna dom/festivo', 'HEND&F', 'h'], ['HEN · Extra nocturna (inventario)', 'HEN', 'h'],
  ['HEF · Extra diurna dom/festivo', 'HEF', 'h'],
];
const hh = min => (min ? String(C.hoursDec(min)).replace('.', ',') + ' h' : '—');
const cellTxt = (kind, v) => (kind === 'h' ? hh(v) : kind === 'd' ? String(v) : (v ? String(v) : '—'));
const sgn = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

/* ------------------------------------------------------------------ */
/* Pantalla de nómina                                                  */
/* ------------------------------------------------------------------ */
function adjustmentsOfMonth(empId) {
  const per = C.monthOf(A.monthFrom());
  return S.adjustments.filter(a => a.emp === empId && a.period === per);
}
function storesOf(empId) {
  const out = {};
  S.decisions.filter(d => d.emp === empId && d.kind === 'inventario_tienda').forEach(d => { out[d.ref] = d.value && d.value.store; });
  return out;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) { /* sin portapapeles */ } ta.remove(); }
  toast('Comentario copiado.');
}
async function changeStore(empId, first) {
  const emp = S.employees.find(e => e.id === empId);
  const cur = S.decisions.find(d => d.emp === empId && d.kind === 'inventario_tienda' && d.ref === first);
  const r = await promptForm({
    title: 'Tienda del inventario', body: `${esc(emp.name)} · inventario del ${esc(fd(first))}`,
    fields: [{ id: 'store', label: 'Tienda', required: true, value: cur && cur.value ? cur.value.store : '' }],
  });
  if (!r) return;
  const store = r.store.toUpperCase();
  await DB.saveDecision({ emp: empId, kind: 'inventario_tienda', ref: first, value: { store }, by: S.user.code });
  await A.logRow({ action: 'AVISO', emp: empId, empName: emp.name, refDate: first, before: cur && cur.value ? cur.value.store : '', after: `Tienda del inventario: ${store}` });
  S.decisions = await DB.decisions();
  renderNomina();
}
function renderNomina() {
  const emps = A.visibleEmployees(), ps = periods();
  if (!emps.length) { $('#payCards').innerHTML = '<div class="card empty">No hay personal.</div>'; return; }
  $('#payCards').innerHTML = emps.map(emp => {
    const pr = payrollFor(emp.id), b = balanceFor(emp.id);
    const eList = A.empEntries(emp.id), stores = storesOf(emp.id);
    const cmt = C.buildComment(eList, A.monthFrom(), A.monthTo(), pr.m, stores);
    const invHtml = C.invPairDates(eList, A.monthFrom(), A.monthTo()).map(d => `<div class="invlist"><div class="it"><span>Inventario del ${esc(fd(d))}: <b>${esc(stores[d] || '(falta la tienda)')}</b></span><button data-invstore="${emp.id}|${d}">Cambiar tienda</button></div></div>`).join('');
    const head = `<tr><th>Concepto</th>${ps.map(p => `<th>${p.label}${p.sub ? `<small> ${p.sub}</small>` : ''}</th>`).join('')}</tr>`;
    const body = ROWS.map(r => {
      if (r.length === 1) return `<tr class="sep"><td colspan="4">${esc(r[0])}</td></tr>`;
      return `<tr><td>${esc(r[0])}</td>${ps.map(p => { const v = pr[p.id][r[1]]; const t = cellTxt(r[2], v); return `<td class="num ${t === '—' ? 'zero' : ''}">${t}</td>`; }).join('')}</tr>`;
    }).join('');
    return `
    <section class="card paycard">
      <h2>${esc(emp.name)}</h2>
      <div class="paygrid">
        <table class="pay"><thead>${head}</thead><tbody>${body}</tbody></table>
        <div>
          <label class="fl">Comentario de nómina (mes)</label>
          <div class="cmtbox" id="cmt-${emp.id}">${esc(cmt)}</div>
          <div class="cmtrow"><button data-copy="${emp.id}">Copiar comentario</button></div>
          ${invHtml}
        </div>
      </div>
    </section>`;
  }).join('');
}
$('#payCards').addEventListener('click', e => {
  const cp = e.target.closest('[data-copy]');
  if (cp) { copyText(document.getElementById('cmt-' + cp.dataset.copy).textContent); return; }
  const st = e.target.closest('[data-invstore]');
  if (st) { const [emp, first] = st.dataset.invstore.split('|'); A.enqueue(() => changeStore(emp, first)); return; }
});

/* ------------------------------------------------------------------ */
/* Horas manuales (en la pantalla inicial, debajo de la malla)         */
/* ------------------------------------------------------------------ */
function renderAdjust() {
  const emps = A.visibleEmployees();
  if (!emps.length) { $('#adjBox').innerHTML = '<div class="empty">No hay personal.</div>'; return; }
  const cancelled = new Set(S.adjustments.filter(a => a.cancels).map(a => a.cancels));
  $('#adjBox').innerHTML = emps.map(emp => {
    const adjs = adjustmentsOfMonth(emp.id);
    const list = adjs.length ? adjs.map(a => {
      const off = a.kind === 'ajuste' && cancelled.has(a.id);
      const when = new Date(a.ts).toLocaleString('es-CO');
      return `<div class="it ${off ? 'off' : ''}"><span><b class="${sgn(a.minutes)}">${esc(signed(a.minutes))}</b> · ${esc(a.reason)}${a.kind === 'anulacion' ? ' <span class="tag">ANULACIÓN</span>' : ''}${off ? ' <span class="tag">ANULADO</span>' : ''}</span><span class="muted">${esc(a.userName || a.userCode || '')} · ${esc(when)}</span></div>`;
    }).join('') : '<div class="muted small">Sin ajustes este mes.</div>';
    return `
    <div class="adjperson">
      <div class="adjhead"><b>${esc(emp.name)}</b><span class="adjsal" id="adjsal-${emp.id}"></span></div>
      <div class="adjform"><input id="adj-${emp.id}" placeholder="Horas: 2, -1,5 o 1:30" data-adjin="${emp.id}"><button class="primary" data-adj="${emp.id}">Agregar</button></div>
      <div class="adjlist">${list}</div>
    </div>`;
  }).join('');
}
$('#adjBox').addEventListener('click', e => {
  const b = e.target.closest('[data-adj]'); if (!b) return;
  A.enqueue(() => addAdjustment(b.dataset.adj));
});
$('#adjBox').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.adjin) { e.preventDefault(); A.enqueue(() => addAdjustment(e.target.dataset.adjin)); }
});

/* ------------------------------------------------------------------ */
/* Alta de horas manuales                                                */
/* ------------------------------------------------------------------ */
async function addAdjustment(empId) {
  const input = document.getElementById('adj-' + empId);
  const mins = C.parseHours(input.value);
  if (mins === null) { toast('Escribe las horas: por ejemplo 2, -1,5 o 1:30.'); return; }
  const emp = S.employees.find(e => e.id === empId), per = C.monthOf(A.monthFrom());
  let cancels = null, kind = 'ajuste', reason = '';

  if (mins < 0) {
    const done = new Set(S.adjustments.filter(a => a.cancels).map(a => a.cancels));
    const cands = S.adjustments.filter(a => a.emp === empId && a.kind === 'ajuste' && a.minutes === -mins && !done.has(a.id));
    let chosen = null;
    const desc = a => `${signed(a.minutes)} · “${esc(a.reason)}” · ${esc(a.userName || '')} · ${esc(new Date(a.ts).toLocaleDateString('es-CO'))}`;
    if (cands.length === 1) {
      const r = await dialog({
        title: '¿Cancelas un registro anterior?',
        body: `${esc(emp.name)} tiene este ajuste: <br><b>${desc(cands[0])}</b><br>¿Esta cancelación de ${esc(signed(mins))} hace referencia a ese registro?`,
        buttons: [{ label: 'Sí, anular ese registro', value: true, cls: 'primary' }, { label: 'No, es un ajuste aparte', value: false }],
      });
      if (r === null) return;
      if (r) chosen = cands[0];
    } else if (cands.length > 1) {
      const opts = cands.map((a, i) => ({ label: desc(a), value: i }));
      opts.push({ label: 'Ninguno, es un ajuste aparte', value: -1 });
      const r = await dialog({
        title: '¿A cuál registro corresponde?',
        body: `${esc(emp.name)} tiene varios ajustes de ${esc(signed(-mins))}. ¿La cancelación de ${esc(signed(mins))} hace referencia a alguno?`,
        buttons: opts, stack: true, wide: true,
      });
      if (r === null) return;
      if (r >= 0) chosen = cands[r];
    }
    if (chosen) {
      const f = await promptForm({
        title: 'Motivo de la anulación', body: `Anulas: <b>${desc(chosen)}</b>`,
        fields: [{ id: 'reason', label: 'Motivo de la anulación', type: 'textarea', required: true }], okLabel: 'Anular horas',
      });
      if (!f) return;
      reason = f.reason; cancels = chosen.id; kind = 'anulacion';
    }
  }
  if (!cancels) {
    const f = await promptForm({
      title: 'Motivo de las horas', body: `${esc(emp.name)}: <b>${esc(signed(mins))}</b>`,
      fields: [{ id: 'reason', label: 'Motivo (ej. horas del mes anterior, apoyo en evento)', type: 'textarea', required: true }], okLabel: 'Agregar horas',
    });
    if (!f) return;
    reason = f.reason;
  }
  const row = await DB.addAdjustment({ emp: empId, period: per, minutes: mins, reason, kind, cancels, userCode: S.user.code, userName: S.user.name });
  await A.logRow({
    action: kind === 'anulacion' ? 'ANULACION' : 'AJUSTE', emp: empId, empName: emp.name, refDate: A.monthFrom(),
    before: '', after: signed(mins), comment: reason, detail: { periodo: per, cancela: cancels, ajuste: row.id },
  });
  S.adjustments = await DB.adjustments();
  renderAdjust(); A.updateTotals();
  if (S.tab === 'nomina') renderNomina();
}

/* ------------------------------------------------------------------ */
/* Registro tipo consola                                               */
/* ------------------------------------------------------------------ */
let logRows = [], logLimit = 400;
const pad = n => String(n).padStart(2, '0');
const fts = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

function fillSelect(id, first, options) {
  const sel = $(id), cur = sel.value;
  sel.innerHTML = `<option value="">${esc(first)}</option>` + options.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('');
  if (options.some(o => o[0] === cur)) sel.value = cur;
}
async function loadLog() {
  const from = $('#fFrom').value, to = $('#fTo').value;
  const fromIso = from ? new Date(from + 'T00:00:00').toISOString() : null;
  const toIso = to ? new Date(to + 'T23:59:59.999').toISOString() : null;
  logRows = await DB.logs(fromIso, toIso);
  const emps = new Map(), users = new Map(), types = new Set();
  logRows.forEach(r => { if (r.emp) emps.set(r.emp, r.empName || r.emp); users.set(r.userCode, r.userName || r.userCode); types.add(r.action); });
  fillSelect('#fEmp', 'Todas', [...emps.entries()]);
  fillSelect('#fUser', 'Todos', [...users.entries()].map(([c, n]) => [c, `${c} · ${n}`]));
  fillSelect('#fType', 'Todos', [...types].sort().map(t => [t, t]));
  logLimit = 400;
  renderLog();
}
function filteredLog() {
  const emp = $('#fEmp').value, user = $('#fUser').value, type = $('#fType').value, text = $('#fText').value.trim().toLowerCase();
  return logRows.filter(r => (!emp || r.emp === emp) && (!user || r.userCode === user) && (!type || r.action === type)
    && (!text || [r.empName, r.userName, r.userCode, r.action, r.before, r.after, r.comment, r.refDate].join(' ').toLowerCase().includes(text)));
}
function lineText(r) {
  const parts = [];
  if (r.empName) parts.push(esc(r.empName));
  if (r.refDate) parts.push(esc(fd(String(r.refDate).slice(0, 10))));
  let head = parts.join(' · ');
  let change = '';
  if (r.before && r.after) change = `${esc(r.before)}  →  <b>${esc(r.after)}</b>`;
  else if (r.after) change = `<b>${esc(r.after)}</b>`;
  else if (r.before) change = `${esc(r.before)}  →  <b>(vacío)</b>`;
  const adm = r.detail && r.detail.admin ? ` <span class="cm">[autorizó ADMIN ${esc(r.detail.admin)}]</span>` : '';
  const cm = r.comment ? ` <span class="cm">“${esc(r.comment)}”</span>` : '';
  return [head, change].filter(Boolean).join(' · ') + adm + cm;
}
function renderLog() {
  const annulled = new Set(logRows.filter(r => r.annuls).map(r => r.annuls));
  const rows = filteredLog().slice().sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.id - a.id));
  $('#logCount').textContent = `${rows.length} movimiento${rows.length === 1 ? '' : 's'}${logRows.length !== rows.length ? ` (de ${logRows.length} cargados)` : ''}. Los renglones tachados fueron anulados por una corrección posterior.`;
  const shown = rows.slice(0, logLimit);
  $('#console').innerHTML = shown.length
    ? shown.map(r => `<div class="ln ${annulled.has(r.id) ? 'anu' : ''}"><span class="ts">#${r.id} ${fts(r.ts)}</span> <span class="us">${esc(r.userCode)}·${esc(r.userName || '')}</span> <span class="tg t-${esc(r.action)}">${esc(r.action)}</span> ${lineText(r)}</div>`).join('')
      + (rows.length > shown.length ? `<div class="ln"><span class="more" id="logMore">Mostrar más (${rows.length - shown.length} restantes)</span></div>` : '')
    : '<div class="ln ts">Sin movimientos para estos filtros.</div>';
  const more = $('#logMore'); if (more) more.onclick = () => { logLimit += 400; renderLog(); };
}
async function openLogTab() {
  if (!$('#fFrom').value && !$('#fTo').value) $('#fFrom').value = A.monthFrom();
  await loadLog();
}
['#fFrom', '#fTo'].forEach(id => $(id).addEventListener('change', () => loadLog()));
['#fEmp', '#fUser', '#fType'].forEach(id => $(id).addEventListener('change', () => { logLimit = 400; renderLog(); }));
$('#fText').addEventListener('input', () => { logLimit = 400; renderLog(); });
$('#fAll').addEventListener('click', () => { $('#fFrom').value = ''; $('#fTo').value = ''; loadLog(); });

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */
function needExcel() {
  if (window.ExcelJS) return true;
  toast('No se pudo cargar la librería de Excel. Revisa tu conexión a internet e intenta de nuevo.');
  return false;
}
function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 30;
}
function addSheet(wb, name, headers, rows, widths) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers); styleHeader(ws.getRow(1));
  rows.forEach(r => ws.addRow(r));
  ws.columns.forEach((c, i) => { c.width = (widths && widths[i]) || 14; });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return ws;
}
async function download(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const dec = min => C.hoursDec(min);

async function exportPayroll() {
  if (!needExcel()) return;
  const wb = new window.ExcelJS.Workbook();
  wb.creator = S.user.name; wb.created = new Date();
  const per = C.monthOf(A.monthFrom()), emps = A.visibleEmployees(), ps = periods();
  const label = `${MESES[S.m - 1]} ${S.y}`;

  /* Nómina por persona y concepto */
  const rows = [];
  emps.forEach(emp => {
    const pr = payrollFor(emp.id);
    ROWS.forEach(r => {
      if (r.length === 1) return;
      rows.push([emp.name, r[0], ...ps.map(p => (r[2] === 'h' ? dec(pr[p.id][r[1]]) : pr[p.id][r[1]]))]);
    });
  });
  addSheet(wb, 'Nómina', ['Persona', 'Concepto', 'Q1 (1–15)', `Q2 (16–${C.daysInMonth(S.y, S.m)})`, 'Mes'], rows, [22, 42, 14, 14, 14]);

  /* Comentario de nómina */
  const cm = emps.map(emp => [emp.name, C.buildComment(A.empEntries(emp.id), A.monthFrom(), A.monthTo(), payrollFor(emp.id).m, storesOf(emp.id))]);
  addSheet(wb, 'Comentarios', ['Persona', 'Comentario de nómina (mes)'], cm, [22, 90]);

  /* Detalle diario */
  const det = [];
  emps.forEach(emp => {
    const list = A.empEntries(emp.id);
    const pairs = new Set(C.invPairs(list.filter(e => e.code === 'INV').map(e => e.date).sort()));
    for (let d = 1; d <= C.daysInMonth(S.y, S.m); d++) {
      const date = C.ymd(S.y, S.m, d), en = S.entries.get(key(emp.id, date));
      if (!en || (!en.code && !en.start && !en.end)) continue;
      const tipo = C.holidayName(date) ? `Festivo · ${C.holidayName(date)}` : C.dow(date) === 0 ? 'Domingo' : 'Normal';
      const c = en.calc, p = C.pay(c), pair = pairs.has(date);
      det.push([
        emp.name, date, A.DIAS_L[C.dow(date)], d <= 15 ? 'Q1' : 'Q2', tipo, en.code ? en.code : en.start, en.code ? en.code : en.end,
        en.shift || (en.code ? '' : (en.start && en.end ? 'SIN TURNO' : '')), en.code ? C.CODES[en.code] : '',
        c ? dec(c.wk) : '', c ? dec(c.xb) : '', c ? dec(c.xa) : '', c ? dec(c.sh) : '', c ? dec(c.counter) : '',
        c ? dec(p.HRN) : (pair ? 7 : ''), c ? dec(p['HRND&F']) : '', c ? dec(p['HEND&F']) : '', pair ? 2 : '', c ? dec(p.HEF) : '',
        c && c.sf ? dec(c.tw) : '', en.updatedBy || '', en.updatedAt ? fts(en.updatedAt) : '',
      ]);
    }
  });
  addSheet(wb, 'Detalle diario', ['Persona', 'Fecha', 'Día', 'Quincena', 'Tipo de día', 'Entrada', 'Salida', 'Turno', 'Código', 'Horas trabajadas', 'Horas antes del turno', 'Horas después del turno', 'Horas faltantes', 'Contador (h)', 'HRN', 'HRND&F', 'HEND&F', 'HEN', 'HEF', 'Jornada dom/festivo', 'Registró', 'Última modificación'],
    det, [20, 12, 11, 9, 24, 9, 9, 13, 16, 11, 11, 11, 10, 11, 8, 9, 9, 7, 7, 12, 10, 19]);

  /* Saldos */
  const sal = emps.map(emp => { const b = balanceFor(emp.id); return [emp.name, dec(b.prevTotal), dec(b.mallaM), dec(b.discM), dec(b.adjM), dec(b.total)]; });
  addSheet(wb, 'Saldos de horas', ['Persona', 'Saldo anterior (h)', 'Contador de la malla (h)', 'Descanso doble descontado (h)', 'Horas manuales del mes (h)', 'Saldo final (h)'], sal, [22, 16, 18, 20, 18, 16]);

  /* Ajustes */
  const cancelled = new Set(S.adjustments.filter(a => a.cancels).map(a => a.cancels));
  const adj = [];
  emps.forEach(emp => adjustmentsOfMonth(emp.id).forEach(a => adj.push([fts(a.ts), emp.name, a.userCode, a.userName, dec(a.minutes), a.kind === 'anulacion' ? 'Anulación' : 'Ajuste', a.reason, a.kind === 'ajuste' && cancelled.has(a.id) ? 'ANULADO' : ''])));
  addSheet(wb, 'Horas manuales', ['Fecha y hora', 'Persona', 'Código', 'Usuario', 'Horas', 'Tipo', 'Motivo', 'Estado'], adj, [19, 20, 9, 16, 9, 12, 50, 11]);

  await download(wb, `nomina-${per}.xlsx`);
  await A.logRow({ action: 'EXCEL', after: `Descargó el Excel de nómina de ${label}` });
}

async function exportLog() {
  if (!needExcel()) return;
  const wb = new window.ExcelJS.Workbook();
  wb.creator = S.user.name; wb.created = new Date();
  const annulledBy = {};
  logRows.forEach(r => { if (r.annuls) annulledBy[r.annuls] = r.id; });
  const rows = filteredLog().slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id - b.id));
  const data = rows.map(r => {
    const d = new Date(r.ts);
    return [r.id, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      r.userCode, r.userName, r.action, r.empName || '', r.refDate ? String(r.refDate).slice(0, 10) : '', r.before, r.after, r.comment,
      r.annuls || '', annulledBy[r.id] || '', r.detail && r.detail.admin ? r.detail.admin : '', r.detail && r.detail.plazo ? r.detail.plazo : '',
      r.detail ? JSON.stringify(r.detail) : ''];
  });
  addSheet(wb, 'Registro', ['N°', 'Fecha', 'Hora', 'Código usuario', 'Usuario', 'Acción', 'Persona', 'Fecha afectada', 'Antes', 'Después', 'Comentario / motivo', 'Anula el N°', 'Anulado por el N°', 'Autorizó ADMIN', 'Plazo', 'Detalle técnico'],
    data, [7, 12, 10, 12, 16, 14, 18, 13, 34, 38, 46, 10, 12, 13, 10, 40]);

  const count = (fn) => { const m = new Map(); rows.forEach(r => { const k = fn(r) || '(sin dato)'; m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const res = [];
  count(r => r.action).forEach(([k, v]) => res.push(['Por acción', k, v]));
  count(r => `${r.userCode} · ${r.userName || ''}`).forEach(([k, v]) => res.push(['Por usuario', k, v]));
  count(r => r.empName).forEach(([k, v]) => res.push(['Por persona', k, v]));
  addSheet(wb, 'Resumen', ['Agrupado', 'Valor', 'Movimientos'], res, [16, 40, 14]);

  const t = new Date();
  await download(wb, `registro-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}.xlsx`);
  await A.logRow({ action: 'EXCEL', after: `Descargó el Excel del registro (${rows.length} movimientos)` });
}
$('#btnPayXlsx').addEventListener('click', () => A.enqueue(exportPayroll));
$('#btnLogXlsx').addEventListener('click', () => A.enqueue(exportLog));

Object.assign(A, { renderNomina, renderAdjust, openLogTab, refreshLogFilters: loadLog, payrollFor, balanceFor });
})();
