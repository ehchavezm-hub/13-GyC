import { query } from './_lib/db.js';
import { verificarAuth, AuthError } from './_lib/auth.js';
import { validarTabla, validarColumna, validarOrden, OPERADORES } from './_lib/whitelist.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Auth
  let perfil;
  try {
    perfil = await verificarAuth(req);
  } catch (e) {
    const st = e instanceof AuthError ? e.status : 401;
    return res.status(st).json({ error: e.message });
  }

  let body = {};
  if (req.method !== 'GET') {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    } catch {
      return res.status(400).json({ error: 'JSON inválido' });
    }
  }

  const { accion, tabla: rawTabla, ...params } = req.method === 'GET'
    ? Object.fromEntries(new URL(req.url, 'http://x').searchParams)
    : body;

  try {
    const tabla = validarTabla(rawTabla);
    const result = await ejecutarAccion(accion, tabla, params, perfil);
    res.status(200).json(result);
  } catch (e) {
    const st = e instanceof AuthError ? e.status : 400;
    res.status(st).json({ error: e.message });
  }
}

// ── Acciones ────────────────────────────────────────────────────────────────

async function ejecutarAccion(accion, tabla, params, perfil) {
  switch (accion) {
    case 'list':    return accionList(tabla, params, perfil);
    case 'insert':  return accionInsert(tabla, params, perfil);
    case 'upsert':  return accionUpsert(tabla, params, perfil);
    case 'update':  return accionUpdate(tabla, params, perfil);
    case 'updateWhere': return accionUpdateWhere(tabla, params, perfil);
    case 'remove':  return accionRemove(tabla, params, perfil);
    case 'removeWhere': return accionRemoveWhere(tabla, params, perfil);
    case 'rpc':     return accionRpc(params, perfil);
    default:        throw new Error(`Acción desconocida: ${accion}`);
  }
}

// ── list ────────────────────────────────────────────────────────────────────

function buildWhere(filtros, offset = 0) {
  const clauses = [], vals = [];
  let idx = offset + 1;
  for (const [op, pairs] of Object.entries(filtros || {})) {
    if (!OPERADORES.has(op)) continue;
    for (const [col, val] of Object.entries(pairs || {})) {
      validarColumna(col);
      if (op === 'is') {
        clauses.push(`${col} IS ${val === null ? 'NULL' : val ? 'TRUE' : 'FALSE'}`);
      } else if (op === 'in') {
        const arr = Array.isArray(val) ? val : [val];
        const ph = arr.map(() => `$${idx++}`).join(',');
        vals.push(...arr);
        clauses.push(`${col} IN (${ph})`);
      } else {
        const SQL_OP = { eq:'=', neq:'<>', gt:'>', gte:'>=', lt:'<', lte:'<=', like:'LIKE', ilike:'ILIKE' };
        clauses.push(`${col} ${SQL_OP[op]} $${idx++}`);
        vals.push(val);
      }
    }
  }
  return { clauses, vals };
}

async function accionList(tabla, { select, eq, neq, gt, gte, lt, lte, is, in: inParam, like, ilike, order, limit }, perfil) {
  void perfil;
  const cols = select ? select.split(',').map(c => validarColumna(c.trim())).join(', ') : '*';
  const filtros = { eq, neq, gt, gte, lt, lte, is, in: inParam, like, ilike };
  const { clauses, vals } = buildWhere(filtros);
  let sql = `SELECT ${cols} FROM ${tabla}`;
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  const ordenado = validarOrden(order);
  if (ordenado.length) sql += ` ORDER BY ${ordenado.map(([c, a]) => `${c} ${a ? 'ASC' : 'DESC'}`).join(', ')}`;
  if (limit) sql += ` LIMIT ${parseInt(limit, 10) || 100}`;
  return query(sql, vals);
}

// ── insert ───────────────────────────────────────────────────────────────────

async function accionInsert(tabla, { data }, perfil) {
  void perfil;
  if (!data || typeof data !== 'object') throw new Error('data requerido');
  const filas = Array.isArray(data) ? data : [data];
  if (!filas.length) return [];
  const cols = Object.keys(filas[0]).map(validarColumna);
  const ph = filas.map((_, fi) => `(${cols.map((_, ci) => `$${fi * cols.length + ci + 1}`).join(',')})`).join(',');
  const vals = filas.flatMap(f => cols.map(c => f[c]));
  return query(`INSERT INTO ${tabla} (${cols.join(',')}) VALUES ${ph} RETURNING *`, vals);
}

// ── upsert ───────────────────────────────────────────────────────────────────

async function accionUpsert(tabla, { data, onConflict }, perfil) {
  void perfil;
  if (!data || typeof data !== 'object') throw new Error('data requerido');
  const filas = Array.isArray(data) ? data : [data];
  if (!filas.length) return [];
  const conflict = (onConflict || 'id').split(',').map(validarColumna).join(',');
  const cols = Object.keys(filas[0]).map(validarColumna);
  const ph = filas.map((_, fi) => `(${cols.map((_, ci) => `$${fi * cols.length + ci + 1}`).join(',')})`).join(',');
  const vals = filas.flatMap(f => cols.map(c => f[c]));
  const setCols = cols.filter(c => !onConflict?.split(',').includes(c));
  const updateSet = setCols.length ? `UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(',')}` : 'NOTHING';
  return query(`INSERT INTO ${tabla} (${cols.join(',')}) VALUES ${ph} ON CONFLICT (${conflict}) DO ${updateSet} RETURNING *`, vals);
}

// ── update ───────────────────────────────────────────────────────────────────

async function accionUpdate(tabla, { id, data }, perfil) {
  void perfil;
  if (!id) throw new Error('id requerido');
  if (!data || !Object.keys(data).length) throw new Error('data requerido');
  const cols = Object.keys(data).map(validarColumna);
  const set = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const vals = [...cols.map(c => data[c]), id];
  const rows = await query(`UPDATE ${tabla} SET ${set} WHERE id=$${cols.length + 1} RETURNING *`, vals);
  return rows[0] ?? null;
}

// ── updateWhere ──────────────────────────────────────────────────────────────

async function accionUpdateWhere(tabla, { data, ...filtros }, perfil) {
  void perfil;
  if (!data || !Object.keys(data).length) throw new Error('data requerido');
  const dataCols = Object.keys(data).map(validarColumna);
  const set = dataCols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const dataVals = dataCols.map(c => data[c]);
  const { clauses, vals: wVals } = buildWhere(filtros, dataCols.length);
  if (!clauses.length) throw new Error('updateWhere requiere al menos un filtro');
  const sql = `UPDATE ${tabla} SET ${set} WHERE ${clauses.join(' AND ')} RETURNING *`;
  return query(sql, [...dataVals, ...wVals]);
}

// ── remove ───────────────────────────────────────────────────────────────────

async function accionRemove(tabla, { id }, perfil) {
  void perfil;
  if (!id) throw new Error('id requerido');
  await query(`DELETE FROM ${tabla} WHERE id=$1`, [id]);
  return { ok: true };
}

// ── removeWhere ──────────────────────────────────────────────────────────────

async function accionRemoveWhere(tabla, filtros, perfil) {
  void perfil;
  const { clauses, vals } = buildWhere(filtros);
  if (!clauses.length) throw new Error('removeWhere requiere al menos un filtro');
  await query(`DELETE FROM ${tabla} WHERE ${clauses.join(' AND ')}`, vals);
  return { ok: true };
}

// ── rpc ──────────────────────────────────────────────────────────────────────

const RPC_PERMITIDAS = new Set([
  'registro_abierto', 'can_cerrar_semana', 'indicadores_proyecto',
  'resumen_proyecto', 'kpi_ppc', 'kpi_cpi',
]);

async function accionRpc({ nombre, params: rpcParams }, perfil) {
  void perfil;
  if (!nombre || !RPC_PERMITIDAS.has(nombre)) throw new Error(`RPC no permitida: ${nombre}`);
  const args = rpcParams ? Object.entries(rpcParams) : [];
  const argNames = args.map(([k]) => validarColumna(k));
  const argPh = argNames.map((n, i) => `${n} => $${i + 1}`).join(', ');
  const argVals = args.map(([, v]) => v);
  const rows = await query(`SELECT * FROM ${nombre}(${argPh})`, argVals);
  return rows.length === 1 && Object.keys(rows[0]).length === 1 ? Object.values(rows[0])[0] : rows;
}
