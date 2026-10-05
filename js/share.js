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

/* ---------------- Selección de celdas ---------------- */
let sel = null, anchor = null, dragging = false;     // sel = {e1,e2,d1,d2} (índices de persona y días)
const emps = () => A.visibleEmployees();
function pos(el) {
  const inp = el.closest && el.closest('td') ? el.closest('td').querySelector('input[data-e]') : null;
  if (inp) return { ei: emps().findIndex(x => x.id === inp.dataset.e), di: +inp.dataset.d.slice(8) };
  const th = el.closest && el.closest('th[data-day]');
  if (th) return { ei: -1, di: +th.dataset.day };
  return null;
}
function setSel(a, b) {
  const n = emps().length;
  let e1 = a.ei, e2 = b.ei;
  if (e1 < 0 || e2 < 0) { e1 = 0; e2 = n - 1; }            // clic en el encabezado: todo el día
  sel = { e1: Math.min(e1, e2), e2: Math.max(e1, e2), d1: Math.min(a.di, b.di), d2: Math.max(a.di, b.di) };
  paint();
}
function clearSel() { sel = null; anchor = null; paint(); }
function paint() {
  grid.querySelectorAll('.selc').forEach(x => x.classList.remove('selc'));
  const info = $('#selInfo');
  if (!sel) { if (info) info.textContent = ''; return; }
  const list = emps();
  grid.querySelectorAll('input[data-e]').forEach(inp => {
    const ei = list.findIndex(x => x.id === inp.dataset.e), di = +inp.dataset.d.slice(8);
    if (ei >= sel.e1 && ei <= sel.e2 && di >= sel.d1 && di <= sel.d2) inp.closest('td').classList.add('selc');
  });
  const nd = sel.d2 - sel.d1 + 1, np = sel.e2 - sel.e1 + 1;
  if (info) info.textContent = `Selección: ${np} persona${np > 1 ? 's' : ''} × ${nd} día${nd > 1 ? 's' : ''}`;
}
grid.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const p = pos(e.target); if (!p) return;
  if (e.shiftKey && anchor) { setSel(anchor, p); e.preventDefault(); return; }
  anchor = p; dragging = true;
  if (p.ei < 0) { setSel(p, p); e.preventDefault(); dragging = false; }
  else { sel = null; paint(); }
});
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY); if (!el) return;
  const p = pos(el); if (!p || p.ei < 0) return;
  if (p.ei === anchor.ei && p.di === anchor.di && !sel) return;
  grid.classList.add('selecting');
  if (document.activeElement && document.activeElement.blur && grid.contains(document.activeElement)) document.activeElement.blur();
  setSel(anchor, p);
});
document.addEventListener('mouseup', () => {
  if (dragging && !sel && anchor && anchor.ei >= 0) setSel(anchor, anchor);   // clic simple = una celda
  dragging = false; grid.classList.remove('selecting');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sel && !$('#overlay').classList.contains('show')) clearSel();
});
new MutationObserver(() => { if (sel) { const n = emps().length; if (sel.e2 >= n) sel = null; paint(); } }).observe(grid, { childList: true });

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
  g.fillText(`Malla horaria · ${MESES[S.m]} ${S.y}`, PAD, PAD + TT / 2);
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
async function shareImage() {
  const all = emps(); if (!all.length) { toast('No hay personal.'); return; }
  const n = C.daysInMonth(S.y, S.m);
  let mode = 'full';
  if (sel) {
    const r = await dialog({
      title: 'Generar imagen de la malla',
      body: `¿Qué quieres compartir?<br><span class="muted small">Tienes seleccionado: ${esc($('#selInfo').textContent.replace('Selección: ', ''))}.</span>`,
      buttons: [{ label: 'Malla completa', value: 'full', cls: 'primary' }, { label: 'Solo días seleccionados', value: 'sel' }, { label: 'Cancelar', value: null }],
    });
    if (!r) return; mode = r;
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
  const cv = drawMalla(list, d1, d2, mode === 'full');
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  const name = `malla-${S.y}-${String(S.m + 1).padStart(2, '0')}${mode === 'sel' ? `-dias-${d1}-${d2}` : ''}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  let done = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Malla ${MESES[S.m]} ${S.y}` }); done = true; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  if (!done) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Imagen descargada.');
  }
  await A.logRow({ action: 'IMAGEN', after: mode === 'sel' ? `Imagen de días ${d1}–${d2} (${list.length} persona${list.length > 1 ? 's' : ''})` : 'Imagen de la malla completa', detail: { mes: `${S.y}-${String(S.m + 1).padStart(2, '0')}` } });
}
$('#btnShareImg').addEventListener('click', () => A.enqueue(shareImage));
})();
