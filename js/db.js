/* =====================================================================
   db.js  ·  Guardado de datos
   Usa Supabase si config.js tiene la URL y la clave; si no, guarda en
   este navegador (localStorage) para poder probar sin base de datos.
   ===================================================================== */
(function () {
'use strict';
const CFG = window.APP_CONFIG || {};
const useSB = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const sb = useSB ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const fail = e => {
  console.error(e);
  if (window.MH_toast) window.MH_toast('Error al guardar: ' + (e.message || e));
  throw e;
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

/* Supabase devuelve máximo 1000 filas por consulta: se pide por páginas */
async function fetchAll(build) {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) fail(error);
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

/* ---------------- almacenamiento local ---------------- */
const KEY = 'malla_horaria_v2';
const blank = () => ({ users: [], employees: [], shifts: null, entries: [], decisions: [], adjustments: [], log: [], logSeq: 0 });
function load() { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) return Object.assign(blank(), d); } catch (e) { /* vacío */ } return blank(); }
function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

/* ---------------- conversión de filas ---------------- */
const rowToEntry = r => ({
  emp: r.employee_id, date: r.work_date, start: r.start_time || '', end: r.end_time || '', code: r.code || '',
  shift: r.shift_code || null, net: r.extra_minutes || 0, counter: r.counter_min || 0, calc: r.calc || null,
  createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by, logId: r.last_log_id,
});
const entryToRow = e => ({
  employee_id: e.emp, work_date: e.date, start_time: e.start || null, end_time: e.end || null, code: e.code || null,
  shift_code: e.shift || null, extra_minutes: e.net || 0, counter_min: e.counter || 0, calc: e.calc || null,
  created_at: e.createdAt, updated_at: e.updatedAt, updated_by: e.updatedBy, last_log_id: e.logId || null,
});
const rowToDecision = r => ({ emp: r.employee_id, kind: r.kind, ref: r.ref, value: r.value || {}, by: r.created_by, ts: r.created_at });
const rowToAdj = r => ({
  id: r.id, emp: r.employee_id, period: r.period, minutes: r.minutes, reason: r.reason, kind: r.kind,
  cancels: r.cancels_id, userCode: r.user_code, userName: r.user_name, ts: r.ts,
});
const rowToLog = r => ({
  id: r.id, ts: r.ts, userCode: r.user_code, userName: r.user_name, action: r.action, emp: r.employee_id,
  empName: r.employee_name, refDate: r.ref_date, before: r.before_val || '', after: r.after_val || '',
  comment: r.comment || '', annuls: r.annuls_id, detail: r.detail || null,
});

const DB = {
  mode: useSB ? 'sb' : 'local',

  /* ---------- usuarios ---------- */
  async getUser(code) {
    if (useSB) { const { data, error } = await sb.from('app_users').select('*').eq('code', code).maybeSingle(); if (error) fail(error); return data ? { code: data.code, name: data.name, hash: data.pass_hash, is_admin: data.is_admin } : null; }
    const u = load().users.find(x => x.code === code); return u ? { ...u } : null;
  },
  async listUsers() {
    if (useSB) { const { data, error } = await sb.from('app_users').select('*').order('created_at'); if (error) fail(error); return data.map(d => ({ code: d.code, name: d.name, hash: d.pass_hash, is_admin: d.is_admin })); }
    return load().users.map(u => ({ ...u }));
  },
  async createUser(u) {
    if (useSB) { const { error } = await sb.from('app_users').insert({ code: u.code, name: u.name, pass_hash: u.hash, is_admin: !!u.is_admin }); if (error) fail(error); return; }
    const d = load(); d.users.push({ code: u.code, name: u.name, hash: u.hash, is_admin: !!u.is_admin }); save(d);
  },
  async updateUser(code, patch) {
    if (useSB) { const p = {}; if (patch.hash) p.pass_hash = patch.hash; if (patch.name) p.name = patch.name; const { error } = await sb.from('app_users').update(p).eq('code', code); if (error) fail(error); return; }
    const d = load(); Object.assign(d.users.find(x => x.code === code) || {}, patch); save(d);
  },

  /* ---------- personal ---------- */
  async employees() {
    if (useSB) { const { data, error } = await sb.from('employees').select('*').order('sort').order('created_at'); if (error) fail(error); return data; }
    return load().employees;
  },
  async addEmployee(name) {
    if (useSB) { const { data, error } = await sb.from('employees').insert({ name, active: true, sort: Date.now() % 2147483647 }).select().single(); if (error) fail(error); return data; }
    const d = load(); const e = { id: uuid(), name, active: true }; d.employees.push(e); save(d); return e;
  },
  async updateEmployee(id, patch) {
    if (useSB) { const { error } = await sb.from('employees').update(patch).eq('id', id); if (error) fail(error); return; }
    const d = load(); Object.assign(d.employees.find(e => e.id === id) || {}, patch); save(d);
  },

  /* ---------- turnos ---------- */
  async shifts() {
    if (useSB) { const { data, error } = await sb.from('shifts').select('*').order('sort'); if (error) fail(error); return data.map(s => ({ code: s.code, start: s.start_time, end: s.end_time })); }
    return load().shifts || null;
  },
  async saveShifts(list) {
    if (useSB) {
      let r = await sb.from('shifts').delete().neq('code', '__none__'); if (r.error) fail(r.error);
      if (list.length) { r = await sb.from('shifts').insert(list.map((s, i) => ({ code: s.code, start_time: s.start, end_time: s.end, sort: i }))); if (r.error) fail(r.error); }
      return;
    }
    const d = load(); d.shifts = list; save(d);
  },

  /* ---------- entradas y salidas ---------- */
  async entries(from, to) {
    if (useSB) {
      const rows = await fetchAll((a, b) => sb.from('entries').select('*').gte('work_date', from).lte('work_date', to).order('work_date').order('employee_id').range(a, b));
      return rows.map(rowToEntry);
    }
    return load().entries.filter(e => e.date >= from && e.date <= to);
  },
  /* Para el saldo: lo que sumó cada persona en todos los meses anteriores */
  async counterBefore(date) {
    const sums = {};
    if (useSB) {
      const rows = await fetchAll((a, b) => sb.from('entries').select('employee_id,work_date,counter_min').lt('work_date', date).order('work_date').order('employee_id').range(a, b));
      rows.forEach(r => { sums[r.employee_id] = (sums[r.employee_id] || 0) + (r.counter_min || 0); });
    } else {
      load().entries.filter(e => e.date < date).forEach(e => { sums[e.emp] = (sums[e.emp] || 0) + (e.counter || 0); });
    }
    return sums;
  },
  async upsertEntry(e) {
    if (useSB) { const { error } = await sb.from('entries').upsert(entryToRow(e), { onConflict: 'employee_id,work_date' }); if (error) fail(error); return; }
    const d = load(); d.entries = d.entries.filter(x => !(x.emp === e.emp && x.date === e.date)); d.entries.push(e); save(d);
  },
  async removeEntry(emp, date) {
    if (useSB) { const { error } = await sb.from('entries').delete().eq('employee_id', emp).eq('work_date', date); if (error) fail(error); return; }
    const d = load(); d.entries = d.entries.filter(x => !(x.emp === emp && x.date === date)); save(d);
  },

  /* ---------- respuestas a los avisos (descanso doble, semana partida) ---------- */
  async decisions() {
    if (useSB) { const { data, error } = await sb.from('decisions').select('*'); if (error) fail(error); return data.map(rowToDecision); }
    return load().decisions.map(x => ({ ...x }));
  },
  async saveDecision(x) {
    if (useSB) { const { error } = await sb.from('decisions').upsert({ employee_id: x.emp, kind: x.kind, ref: x.ref, value: x.value || {}, created_by: x.by || null }, { onConflict: 'employee_id,kind,ref' }); if (error) fail(error); return; }
    const d = load(); d.decisions = d.decisions.filter(y => !(y.emp === x.emp && y.kind === x.kind && y.ref === x.ref)); d.decisions.push({ emp: x.emp, kind: x.kind, ref: x.ref, value: x.value || {}, by: x.by, ts: new Date().toISOString() }); save(d);
  },
  async removeDecision(emp, kind, ref) {
    if (useSB) { const { error } = await sb.from('decisions').delete().eq('employee_id', emp).eq('kind', kind).eq('ref', ref); if (error) fail(error); return; }
    const d = load(); d.decisions = d.decisions.filter(y => !(y.emp === emp && y.kind === kind && y.ref === ref)); save(d);
  },

  /* ---------- horas manuales ---------- */
  async adjustments() {
    if (useSB) { const { data, error } = await sb.from('adjustments').select('*').order('ts'); if (error) fail(error); return data.map(rowToAdj); }
    return load().adjustments.map(x => ({ ...x }));
  },
  async addAdjustment(a) {
    const row = { id: uuid(), ...a, ts: new Date().toISOString() };
    if (useSB) {
      const { error } = await sb.from('adjustments').insert({ id: row.id, employee_id: row.emp, period: row.period, minutes: row.minutes, reason: row.reason, kind: row.kind, cancels_id: row.cancels || null, user_code: row.userCode, user_name: row.userName, ts: row.ts });
      if (error) fail(error); return row;
    }
    const d = load(); d.adjustments.push(row); save(d); return row;
  },

  /* ---------- registro (solo se agrega, nunca se borra) ---------- */
  async addLog(r) {
    const row = { ts: new Date().toISOString(), ...r };
    if (useSB) {
      const { data, error } = await sb.from('log').insert({
        ts: row.ts, user_code: row.userCode, user_name: row.userName, action: row.action, employee_id: row.emp || null,
        employee_name: row.empName || null, ref_date: row.refDate || null, before_val: row.before || null, after_val: row.after || null,
        comment: row.comment || null, annuls_id: row.annuls || null, detail: row.detail || null,
      }).select('id').single();
      if (error) fail(error); return data.id;
    }
    const d = load(); d.logSeq = (d.logSeq || 0) + 1; row.id = d.logSeq; d.log.push(row); save(d); return row.id;
  },
  async logs(fromIso, toIso) {
    if (useSB) {
      const rows = await fetchAll((a, b) => {
        let q = sb.from('log').select('*');
        if (fromIso) q = q.gte('ts', fromIso);
        if (toIso) q = q.lte('ts', toIso);
        return q.order('id').range(a, b);
      });
      return rows.map(rowToLog);
    }
    return load().log.filter(r => (!fromIso || r.ts >= fromIso) && (!toIso || r.ts <= toIso)).map(r => ({ ...r }));
  },
};
window.MH_DB = DB;
})();
