/* =====================================================================
   share.js  ·  Navegación con Tab, selección de celdas tipo Excel y
   "Generar y compartir imagen de malla".
   ===================================================================== */
(function () {
'use strict';
const A = window.MH_APP;
const { S, C, $, esc, key, DIAS, MESES, toast, dialog } = A;
const grid = $('#mainGrid');

/* ---------------- Tab: entrada → salida (mismo día) → entrada del día siguiente ---------------- */
function nextDate(date, delta) { return C.ymd(S.y, S.m, +date.slice(8) + delta); }
grid.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
  const i = e.target; if (i.tagName !== 'INPUT') return;
  const k = i.dataset.k, emp = i.dataset.e, day = +i.dataset.d.slice(8), last = C.daysInMonth(S.y, S.m);
  let tk, td;
  if (!e.shiftKey) { if (k === 's') { tk = 'e'; td = day; } else { tk = 's'; td = day + 1; } }
  else { if (k === 'e') { tk = 's'; td = day; } else { tk = 'e'; td = day - 1; } }
  if (td < 1 || td > last) return;                       // en los bordes, Tab normal
  const t = grid.querySelector(`input[data-e="${emp}"][data-d="${C.ymd(S.y, S.m, td)}"][data-k="${tk}"]`);
  if (!t) return;
  e.preventDefault(); t.focus();
  t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
});

/* ---------------- Selección de celdas (en las dos mallas) ---------------- */
const gridS = $('#shiftGrid');
let sel = null, anchor = null, dragging = false, dragGrid = null, moved = false, lastGrid = grid;
const emps = () => A.visibleEmployees();
function pos(el) {
  if (!el || !el.closest) return null;
  const td = el.closest('td'), th = el.closest('th[data-day]');
  if (td && grid.contains(td)) {
    const inp = td.querySelector('input[data-e]');
    return inp ? { ei: emps().findIndex(x => x.id === inp.dataset.e), di: +inp.dataset.d.slice(8), k: (inp.parentElement === td && td.parentElement.querySelector('input[data-k]') === inp) ? inp.dataset.k : inp.dataset.k } : null;
  }
  if (td && gridS.contains(td) && td.dataset.e) return { ei: emps().findIndex(x => x.id === td.dataset.e), di: +td.dataset.d.slice(8) };
  if (th) return { ei: -1, di: +th.dataset.day };
  return null;
}
function setSel(a, b) {
  const n = emps().length;
  let e1 = a.ei, e2 = b.ei;
  if (e1 < 0 || e2 < 0) { e1 = 0; e2 = n - 1; }            // clic en el encabezado: todo el día
  sel = { e1: Math.min(e1, e2), e2: Math.max(e1, e2), d1: Math.min(a.di, b.di), d2: Math.max(a.di, b.di), k: (a.ei === b.ei && a.di === b.di && a.ei >= 0) ? a.k : null };
  paint();
}
function clearSel() { sel = null; anchor = null; paint(); }
function paint() {
  document.querySelectorAll('#mainGrid .selc,#shiftGrid .selc').forEach(x => x.classList.remove('selc'));
  const info = $('#selInfo'), info2 = $('#selInfo2');
  if (!sel) { if (info) info.textContent = ''; if (info2) info2.textContent = ''; return; }
  const list = emps(), inSel = (id, d) => { const ei = list.findIndex(x => x.id === id), di = +d.slice(8); return ei >= sel.e1 && ei <= sel.e2 && di >= sel.d1 && di <= sel.d2; };
  grid.querySelectorAll('input[data-e]').forEach(inp => { if (inSel(inp.dataset.e, inp.dataset.d) && (!sel.k || sel.k === inp.dataset.k)) inp.closest('td').classList.add('selc'); });
  gridS.querySelectorAll('td.s').forEach(td => { if (inSel(td.dataset.e, td.dataset.d)) td.classList.add('selc'); });
  const nd = sel.d2 - sel.d1 + 1, np = sel.e2 - sel.e1 + 1;
  const txt = `Selección: ${np} persona${np > 1 ? 's' : ''} × ${nd} día${nd > 1 ? 's' : ''}`;
  if (info) info.textContent = txt; if (info2) info2.textContent = txt;
}
function onDown(g, e) {
  if (e.button !== 0) return;
  if (e.target === document.activeElement) return;           // editando una celda: el clic coloca el cursor
  const p = pos(e.target); if (!p) return;
  lastGrid = g;
  // quitar el foco del recuadro que se estaba editando (así se guarda) y evitar que el clic "marque texto"
  if (document.activeElement && grid.contains(document.activeElement)) document.activeElement.blur();
  if (e.detail < 2) e.preventDefault();                       // con doble clic sí se deja editar
  else return;
  if (e.shiftKey && anchor) { setSel(anchor, p); return; }
  anchor = p; dragging = true; dragGrid = g; moved = false;
  if (p.ei < 0) { setSel(p, p); dragging = false; }
  else { sel = null; paint(); }
}
grid.addEventListener('dblclick', e => { const i = e.target; if (i.tagName === 'INPUT') { i.focus(); i.select(); } });
grid.addEventListener('mousedown', e => onDown(grid, e));
gridS.addEventListener('mousedown', e => onDown(gridS, e));
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY); if (!el) return;
  const p = pos(el); if (!p || p.ei < 0) return;
  if (p.ei === anchor.ei && p.di === anchor.di && !moved) return;
  moved = true; dragGrid.classList.add('selecting');
  if (document.activeElement && document.activeElement.blur && grid.contains(document.activeElement)) document.activeElement.blur();
  window.getSelection && window.getSelection().removeAllRanges();
  setSel(anchor, p);
});
document.addEventListener('mouseup', () => {
  // clic simple en la malla de entradas = una celda (en la de turnos el clic sigue abriendo el detalle)
  if (dragging && !sel && anchor && anchor.ei >= 0) setSel(anchor, anchor);
  dragging = false; grid.classList.remove('selecting'); gridS.classList.remove('selecting');
});
// Shift+clic en la malla de turnos solo selecciona, no abre el detalle
gridS.addEventListener('click', e => { if (e.detail < 2 || e.shiftKey || moved) { e.stopImmediatePropagation(); moved = false; } }, true);
function cellInput(ei, di, k) {
  const emp = emps()[ei]; if (!emp) return null;
  return grid.querySelector(`input[data-e="${emp.id}"][data-d="${C.ymd(S.y, S.m, di)}"][data-k="${k}"]`);
}
document.addEventListener('keydown', e => {
  const a = document.activeElement;
  if (!sel || lastGrid !== grid || !anchor || anchor.ei < 0 || $('#overlay').classList.contains('show')) return;
  if (a && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(a.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = anchor.k || 's', n = emps().length, last = C.daysInMonth(S.y, S.m);
  const go = (ei, di, kk) => {
    if (ei < 0 || ei >= n || di < 1 || di > last) return;
    anchor = { ei, di, k: kk }; setSel(anchor, anchor);
    const t = cellInput(ei, di, kk); if (t) t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  };
  if (e.key === 'ArrowRight') { e.preventDefault(); go(anchor.ei, anchor.di + 1, k); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(anchor.ei, anchor.di - 1, k); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); k === 's' ? go(anchor.ei, anchor.di, 'e') : go(anchor.ei + 1, anchor.di, 's'); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); k === 'e' ? go(anchor.ei, anchor.di, 's') : go(anchor.ei - 1, anchor.di, 'e'); }
  else if (sel.k && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); const t = cellInput(anchor.ei, anchor.di, k); if (t) { t.focus(); t.select(); } }
  else if (sel.k && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); const t = cellInput(anchor.ei, anchor.di, k); if (t) { t.focus(); t.value = ''; t.blur(); } }
  else if (sel.k && e.key.length === 1) {            // escribir sobre la celda marcada = empezar a editarla
    e.preventDefault(); const t = cellInput(anchor.ei, anchor.di, k);
    if (t) { t.focus(); t.value = e.key; try { t.setSelectionRange(t.value.length, t.value.length); } catch (x) { /* nada */ } }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sel && !$('#overlay').classList.contains('show')) clearSel();
});
const obs = new MutationObserver(() => { if (sel) { const n = emps().length; if (sel.e2 >= n) sel = null; paint(); } });
obs.observe(grid, { childList: true }); obs.observe(gridS, { childList: true });

/* ---------------- Copiar lo seleccionado (Ctrl+C) como en Excel ---------------- */
function shiftText(en) {
  if (!en || (!en.code && !en.start && !en.end)) return '';
  if (en.code) return en.code;
  if (!en.start || !en.end) return '';
  return en.shift || '';                                  // solo el nombre del turno: sin horas ni +/−
}
function selectionText(kind) {
  const list = emps().slice(sel.e1, sel.e2 + 1), days = [];
  for (let d = sel.d1; d <= sel.d2; d++) days.push(d);
  const main = kind === 'main';
  const rows = main ? [['Persona', '', ...days.map(d => `${d}/${S.m}/${S.y}`)]] : [];   // los turnos van solo con la fila de cada persona
  list.forEach(emp => {
    if (main) {
      ['s', 'e'].forEach(k => rows.push([emp.name, k === 's' ? 'Entrada' : 'Salida', ...days.map(d => { const en = S.entries.get(key(emp.id, C.ymd(S.y, S.m, d))); return en ? (en.code || (k === 's' ? en.start : en.end) || '') : ''; })]));
    } else rows.push([...days.map(d => shiftText(S.entries.get(key(emp.id, C.ymd(S.y, S.m, d)))))]);
  });
  return rows.map(r => r.join('\t')).join('\n');
}
document.addEventListener('copy', e => {
  if (!sel || $('#overlay').classList.contains('show')) return;
  const multi = sel.e1 !== sel.e2 || sel.d1 !== sel.d2 || lastGrid === gridS;
  const a = document.activeElement;
  if (!multi && a && a.tagName === 'INPUT') return;            // una sola celda con texto marcado: copia normal
  e.clipboardData.setData('text/plain', selectionText(lastGrid === grid ? 'main' : 'shifts')); e.preventDefault(); toast('Celdas copiadas.');
});

/* ---------------- Imagen de la malla ---------------- */
function cellText(emp, date, k) {
  const en = S.entries.get(key(emp.id, date)); if (!en) return { t: '', c: '' };
  if (en.code) return { t: en.code, c: '#1e3a8a', bg: '#dbeafe' };
  const t = k === 's' ? en.start : en.end;
  return { t: t || '', c: en.start && en.end && !en.shift ? '#dc2626' : '#111827', bg: en.shift && en.net ? '#fef3c7' : '' };
}
function drawMalla(list, d1, d2, withTotal) {
  const CW = 52, RH = 26, NW = 150, LW = 62, TW = 90, HH = 54, PAD = 14, TT = 36;
  const nd = d2 - d1 + 1, W = PAD * 2 + NW + LW + nd * CW + (withTotal ? TW : 0), H = PAD * 2 + TT + HH + list.length * RH * 2;
  const sc = 2, cv = document.createElement('canvas'); cv.width = W * sc; cv.height = H * sc;
  const g = cv.getContext('2d'); g.scale(sc, sc);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.font = '600 18px system-ui,Arial'; g.fillStyle = '#111827'; g.textBaseline = 'middle';
  g.fillText(`Malla horaria · ${MESES[S.m - 1]} ${S.y}`, PAD, PAD + TT / 2);
  const x0 = PAD, y0 = PAD + TT;
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  g.strokeStyle = '#d1d5db'; g.lineWidth = 1;
  // encabezado
  g.fillStyle = '#f3f4f6'; g.fillRect(x0, y0, W - PAD * 2, HH);
  g.textAlign = 'center'; g.font = '600 12px system-ui,Arial';
  g.fillStyle = '#111827'; g.fillText('Persona', x0 + NW / 2, y0 + HH / 2);
  for (let d = d1; d <= d2; d++) {
    const date = C.ymd(S.y, S.m, d), x = x0 + NW + LW + (d - d1) * CW, fest = C.holidayName(date) || C.dow(date) === 0;
    if (fest) { g.fillStyle = '#fee2e2'; g.fillRect(x, y0, CW, HH); }
    g.fillStyle = fest ? '#b91c1c' : '#111827';
    g.font = '600 14px system-ui,Arial'; g.fillText(String(d), x + CW / 2, y0 + 20);
    g.font = '11px system-ui,Arial'; g.fillText(DIAS[C.dow(date)], x + CW / 2, y0 + 38);
  }
  if (withTotal) { g.fillStyle = '#111827'; g.font = '600 12px system-ui,Arial'; g.fillText('Horas', x0 + NW + LW + nd * CW + TW / 2, y0 + HH / 2); }
  list.forEach((emp, i) => {
    ['s', 'e'].forEach((k, j) => {
      const y = y0 + HH + (i * 2 + j) * RH;
      if (j === 0) { g.fillStyle = '#111827'; g.font = '600 13px system-ui,Arial'; g.textAlign = 'left'; g.fillText(emp.name, x0 + 8, y + RH, NW - 12); }
      g.textAlign = 'center'; g.fillStyle = '#6b7280'; g.font = '11px system-ui,Arial'; g.fillText(k === 's' ? 'Entrada' : 'Salida', x0 + NW + LW / 2, y + RH / 2);
      for (let d = d1; d <= d2; d++) {
        const date = C.ymd(S.y, S.m, d), x = x0 + NW + LW + (d - d1) * CW, c = cellText(emp, date, k);
        if (c.bg) { g.fillStyle = c.bg; g.fillRect(x, y, CW, RH); }
        else if (C.holidayName(date) || C.dow(date) === 0) { g.fillStyle = '#fef2f2'; g.fillRect(x, y, CW, RH); }
        if (c.t) { g.fillStyle = c.c; g.font = '13px system-ui,Arial'; g.fillText(c.t, x + CW / 2, y + RH / 2); }
      }
      if (withTotal && j === 0) {
        let w = 0; for (const en of A.empEntries(emp.id)) { if (en.date >= A.monthFrom() && en.date <= A.monthTo() && en.calc && en.start && en.end && !en.code) w += en.calc.wk; }
        g.fillStyle = '#111827'; g.font = '600 13px system-ui,Arial'; g.fillText(C.fmtDur(w), x0 + NW + LW + nd * CW + TW / 2, y + RH);
      }
    });
  });
  // rejilla
  g.strokeStyle = '#d1d5db';
  const tw = W - PAD * 2, th = HH + list.length * RH * 2;
  for (let r = 0; r <= list.length * 2; r++) line(x0 + (r % 2 === 0 || true ? (r % 2 ? NW : 0) : 0), y0 + HH + r * RH, x0 + tw, y0 + HH + r * RH);
  line(x0, y0, x0 + tw, y0); line(x0, y0 + HH, x0 + tw, y0 + HH);
  [0, NW, NW + LW].forEach(dx => line(x0 + dx, y0, x0 + dx, y0 + th));
  for (let d = d1; d <= d2 + 1; d++) line(x0 + NW + LW + (d - d1) * CW, y0, x0 + NW + LW + (d - d1) * CW, y0 + th);
  if (withTotal) line(x0 + tw, y0, x0 + tw, y0 + th);
  return cv;
}
function drawShifts(list, d1, d2, withTotal) {
  const CW = 56, RH = 44, NW = 150, TW = 90, HH = 54, PAD = 14, TT = 36;
  const nd = d2 - d1 + 1, W = PAD * 2 + NW + nd * CW + (withTotal ? TW : 0), H = PAD * 2 + TT + HH + list.length * RH;
  const sc = 2, cv = document.createElement('canvas'); cv.width = W * sc; cv.height = H * sc;
  const g = cv.getContext('2d'); g.scale(sc, sc);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.font = '600 18px system-ui,Arial'; g.fillStyle = '#111827'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(`Turnos · ${MESES[S.m - 1]} ${S.y}`, PAD, PAD + TT / 2);
  const x0 = PAD, y0 = PAD + TT, tw = W - PAD * 2, th = HH + list.length * RH;
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  g.fillStyle = '#f3f4f6'; g.fillRect(x0, y0, tw, HH);
  g.textAlign = 'center'; g.fillStyle = '#111827'; g.font = '600 12px system-ui,Arial'; g.fillText('Persona', x0 + NW / 2, y0 + HH / 2);
  for (let d = d1; d <= d2; d++) {
    const date = C.ymd(S.y, S.m, d), x = x0 + NW + (d - d1) * CW, fest = C.holidayName(date) || C.dow(date) === 0;
    if (fest) { g.fillStyle = '#fee2e2'; g.fillRect(x, y0, CW, HH); }
    g.fillStyle = fest ? '#b91c1c' : '#111827'; g.font = '600 14px system-ui,Arial'; g.fillText(String(d), x + CW / 2, y0 + 20);
    g.font = '11px system-ui,Arial'; g.fillText(DIAS[C.dow(date)], x + CW / 2, y0 + 38);
  }
  if (withTotal) { g.fillStyle = '#111827'; g.font = '600 12px system-ui,Arial'; g.fillText('Saldo de horas', x0 + NW + nd * CW + TW / 2, y0 + HH / 2); }
  const wrap = (txt, x, y, maxW, color, font) => {
    g.fillStyle = color; g.font = font; const words = String(txt).split(' '), lines = []; let cur = '';
    words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    lines.push(cur); const lh = 11; let yy = y - ((lines.length - 1) * lh) / 2; lines.forEach(l => { g.fillText(l, x, yy); yy += lh; });
  };
  list.forEach((emp, i) => {
    const y = y0 + HH + i * RH;
    g.textAlign = 'left'; g.fillStyle = '#111827'; g.font = '600 13px system-ui,Arial'; g.fillText(emp.name, x0 + 8, y + RH / 2, NW - 12); g.textAlign = 'center';
    for (let d = d1; d <= d2; d++) {
      const date = C.ymd(S.y, S.m, d), x = x0 + NW + (d - d1) * CW, en = S.entries.get(key(emp.id, date)), cx = x + CW / 2, cy = y + RH / 2;
      if (!en || (!en.code && !en.start && !en.end)) { if (C.holidayName(date) || C.dow(date) === 0) { g.fillStyle = '#fef2f2'; g.fillRect(x, y, CW, RH); } continue; }
      if (en.code) { g.fillStyle = en.code === 'BASE' ? '#fef3c7' : '#dcfce7'; g.fillRect(x, y, CW, RH); wrap(C.CODES[en.code], cx, cy, CW - 6, en.code === 'BASE' ? '#92400e' : '#166534', '700 9px system-ui,Arial'); }
      else if (!en.start || !en.end) wrap('…', cx, cy, CW, '#6b7280', '12px system-ui,Arial');
      else if (!en.shift) { wrap(en.start, cx, cy - 7, CW, '#dc2626', '700 11px system-ui,Arial'); wrap(en.end, cx, cy + 7, CW, '#dc2626', '700 11px system-ui,Arial'); }
      else if (en.net) { g.fillStyle = '#fff1c2'; g.fillRect(x, y, CW, RH); wrap(en.shift, cx, cy - 6, CW - 6, '#7a5600', '700 9px system-ui,Arial'); wrap(A.signed(en.net), cx, cy + 12, CW, '#7a5600', '600 9px system-ui,Arial'); }
      else { g.fillStyle = '#e8f0ff'; g.fillRect(x, y, CW, RH); wrap(en.shift, cx, cy, CW - 6, '#1e3a8a', '700 9px system-ui,Arial'); }
    }
    if (withTotal && A.balanceFor) { const b = A.balanceFor(emp.id), col = C.semaforo(b.total); g.fillStyle = col === 'red' ? '#fee2e2' : col === 'yellow' ? '#fef3c7' : '#dcfce7'; g.fillRect(x0 + NW + nd * CW, y, TW, RH); g.fillStyle = col === 'red' ? '#b91c1c' : col === 'yellow' ? '#92400e' : '#166534'; g.font = '700 13px system-ui,Arial'; g.fillText(b.total ? A.signed(b.total) : '0 h', x0 + NW + nd * CW + TW / 2, y + RH / 2); }
  });
  g.strokeStyle = '#d1d5db'; g.lineWidth = 1;
  for (let r = 0; r <= list.length; r++) line(x0, y0 + HH + r * RH, x0 + tw, y0 + HH + r * RH);
  line(x0, y0, x0 + tw, y0); line(x0, y0, x0, y0 + th); line(x0 + NW, y0, x0 + NW, y0 + th);
  for (let d = d1; d <= d2 + 1; d++) line(x0 + NW + (d - d1) * CW, y0, x0 + NW + (d - d1) * CW, y0 + th);
  if (withTotal) line(x0 + tw, y0, x0 + tw, y0 + th);
  return cv;
}
function drawBoth(list, d1, d2, withTotal) {
  const c1 = drawMalla(list, d1, d2, withTotal), c2 = drawShifts(list, d1, d2, withTotal);
  const notes = [];
  list.forEach(emp => { for (let d = d1; d <= d2; d++) {
    const en = S.entries.get(key(emp.id, C.ymd(S.y, S.m, d)));
    if (en && en.code === 'BASE' && en.calc && en.calc.nota) notes.push(`${emp.name} · ${d} de ${MESES[S.m - 1]}: ${en.calc.nota}`);
  } });
  const sc = 2, W = Math.max(c1.width, c2.width) / sc, PAD = 14, LH = 18;
  const probe = document.createElement('canvas').getContext('2d'); probe.font = '13px system-ui,Arial';
  const lines = [];
  notes.forEach(t => { let cur = ''; t.split(' ').forEach(w => { const x = cur ? cur + ' ' + w : w; if (probe.measureText(x).width > W - PAD * 2 && cur) { lines.push(cur); cur = '  ' + w; } else cur = x; }); lines.push(cur); });
  const notesH = notes.length ? PAD + 24 + lines.length * LH : 0;
  const H = c1.height / sc + c2.height / sc + notesH;
  const cv = document.createElement('canvas'); cv.width = W * sc; cv.height = H * sc;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(c1, 0, 0); g.drawImage(c2, 0, c1.height);
  if (notes.length) {
    g.scale(sc, sc); let y = (c1.height + c2.height) / sc + PAD; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#92400e'; g.font = '700 14px system-ui,Arial'; g.fillText('Novedades (BASE)', PAD, y + 8); y += 26;
    g.fillStyle = '#111827'; g.font = '13px system-ui,Arial'; lines.forEach(l => { g.fillText(l, PAD, y + 8); y += LH; });
  }
  return cv;
}
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) { /* sin portapapeles */ } ta.remove(); }
  toast('Celdas copiadas.');
}
async function shareImage() {
  const all = emps(); if (!all.length) { toast('No hay personal.'); return; }
  const n = C.daysInMonth(S.y, S.m);
  let mode = 'full';
  if (sel) {
    const r = await dialog({
      title: 'Generar imagen de la malla',
      body: `¿Qué quieres compartir?<br><span class="muted small">Tienes seleccionado: ${esc(($('#selInfo').textContent || $('#selInfo2').textContent).replace('Selección: ', ''))}.</span>`,
      buttons: [{ label: 'Imagen: malla completa', value: 'full', cls: 'primary' }, { label: 'Imagen: solo días seleccionados', value: 'sel' },
        { label: 'Copiar texto de los turnos', value: 'copy-shifts' }, { label: 'Cancelar', value: null }],
      stack: true,
    });
    if (!r) return;
    if (r === 'copy-shifts') { await copyToClipboard(selectionText('shifts')); return; }
    mode = r;
  } else {
    const r = await dialog({
      title: 'Generar imagen de la malla',
      body: 'Se compartirá la malla completa del mes.<br><span class="muted small">Para compartir solo algunos días, cancela, selecciona las celdas (arrastra o Shift+clic; clic en el número del día selecciona todo el día) y vuelve a presionar el botón.</span>',
      buttons: [{ label: 'Malla completa', value: 'full', cls: 'primary' }, { label: 'Cancelar', value: null }],
    });
    if (!r) return;
  }
  const list = mode === 'sel' ? all.slice(sel.e1, sel.e2 + 1) : all;
  const d1 = mode === 'sel' ? sel.d1 : 1, d2 = mode === 'sel' ? sel.d2 : n;
  const cv = drawBoth(list, d1, d2, mode === 'full');
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  const name = `malla-${S.y}-${String(S.m).padStart(2, '0')}${mode === 'sel' ? `-dias-${d1}-${d2}` : ''}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  let done = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Malla ${MESES[S.m - 1]} ${S.y}` }); done = true; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  if (!done) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Imagen descargada.');
  }
  await A.logRow({ action: 'IMAGEN', after: (mode === 'sel' ? `Imagen de días ${d1}–${d2} (${list.length} persona${list.length > 1 ? 's' : ''})` : 'Imagen de la malla completa'), detail: { mes: `${S.y}-${String(S.m).padStart(2, '0')}` } });
}
[$('#btnShareImg'), $('#btnShareImg2')].forEach(b => { if (b) b.addEventListener('click', () => A.enqueue(shareImage)); });
})();
