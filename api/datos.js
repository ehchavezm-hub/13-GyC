// CRUD genérico para el aplicativo (misma interfaz que el adaptador de demostración y que el antiguo Supabase).
// Toda lectura y escritura queda limitada a la empresa activa de la persona (ver _lib/whitelist.js) y a su rol.
import { query } from './_lib/db.js';
import { verificarAuth, AuthError, leerCuerpo, esGestor, esAdmin, esSuper, habilitado, GESTORES } from './_lib/auth.js';
import { puede, eliminarUsuario } from './_lib/usuarios.js';
import { validarTabla, validarColumna, validarOrden, OPERADORES, ESCRIBE_CONSULTA, alcance } from './_lib/whitelist.js';
import { columnas, limpiarFila, prepararValor } from './_lib/esquema.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });

  let perfil;
  try {
    perfil = await verificarAuth(req);
  } catch (e) {
    const st = e instanceof AuthError ? e.status : 401;
    return res.status(st).json({ error: e.message });
  }

  let body = {};
  if (req.method === 'POST') {
    try { body = await leerCuerpo(req); } catch { return res.status(400).json({ error: 'JSON inválido' }); }
  } else {
    body = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  }

  const { accion, tabla: rawTabla, ...params } = body;
  try {
    const result = accion === 'rpc'
      ? await accionRpc(params, perfil)
      : await ejecutarAccion(accion, validarTabla(rawTabla), params, perfil);
    res.status(200).json(result ?? null);
  } catch (e) {
    const st = e instanceof AuthError ? e.status : 400;
    res.status(st).json({ error: e.message });
  }
}

// ── Permisos ─────────────────────────────────────────────────────────────────

function verificarAcceso(accion, tabla, params, perfil) {
  if (habilitado(perfil)) {
    if (accion !== 'list' && perfil.rol === 'consulta' && !ESCRIBE_CONSULTA.has(tabla)) {
      throw new AuthError('Su rol es de solo consulta.', 403);
    }
    return;
  }
  // Pendiente, desactivado o eliminado: solo puede leer su propio perfil (para que el aplicativo le muestre el aviso)
  if (accion === 'list' && tabla === 'profiles' && params?.eq?.id === perfil.id) return;
  throw new AuthError(perfil.rol === 'pendiente'
    ? 'Su cuenta aún no tiene un rol asignado.' : 'Su cuenta está desactivada.', 403);
}

// Perfiles: columnas que cada quien puede cambiar por /api/datos (el resto, por /api/admin-usuarios)
const PERFIL_PROPIO = new Set(['nombre', 'codigo', 'horas_dia', 'tour_visto', 'debe_cambiar_clave']);
const PERFIL_GESTOR = new Set([...PERFIL_PROPIO, 'cargo_id', 'rol', 'gerencia_ids', 'activo']);

async function verificarCambioPerfil(perfil, id, data) {
  const propio = id === perfil.id;
  const permitidas = esGestor(perfil) ? PERFIL_GESTOR : PERFIL_PROPIO;
  if (!propio && !esGestor(perfil)) throw new AuthError('Solo los gestores modifican a otros usuarios.', 403);
  for (const k of Object.keys(data)) {
    if (!permitidas.has(k)) throw new AuthError(`No puede modificar "${k}" del perfil.`, 403);
  }
  if (propio && data.debe_cambiar_clave === true) throw new AuthError('No puede marcar su propia contraseña como temporal.', 403);
  const [obj] = await query(`SELECT id, rol, activo, es_admin_principal, area_id FROM profiles WHERE id = $1`, [id]);
  if (!obj) throw new Error('El registro ya no existe.');
  if ('rol' in data && data.rol !== obj.rol) {
    if (propio) throw new AuthError('No puede cambiar su propio rol.', 403);
    if (obj.es_admin_principal) throw new AuthError('El administrador principal no puede perder su rol.', 403);
    if ((GESTORES.includes(data.rol) || GESTORES.includes(obj.rol)) && !esSuper(perfil)) {
      throw new AuthError('Solo el super administrador asigna o retira los roles de super administrador, administrador y delegado.', 403);
    }
  }
  if ('activo' in data && !data.activo) {
    if (propio) throw new AuthError('No puede desactivarse a sí mismo.', 403);
    if (obj.es_admin_principal) throw new AuthError('El administrador principal no puede desactivarse.', 403);
  }
}

// ── Acciones ────────────────────────────────────────────────────────────────

async function ejecutarAccion(accion, tabla, params, perfil) {
  verificarAcceso(accion, tabla, params, perfil);
  const cols = await columnas(tabla);
  switch (accion) {
    case 'list':        return accionList(tabla, cols, params, perfil);
    case 'insert':      return accionInsert(tabla, cols, params, perfil);
    case 'upsert':      return accionUpsert(tabla, cols, params, perfil);
    case 'update':      return accionUpdate(tabla, cols, params, perfil);
    case 'updateWhere': return accionUpdateWhere(tabla, cols, params, perfil);
    case 'remove':      return accionRemove(tabla, params, perfil);
    case 'removeWhere': return accionRemoveWhere(tabla, cols, params, perfil);
    default:            throw new Error(`Acción desconocida: ${accion}`);
  }
}

function columnaExistente(cols, col) {
  validarColumna(col);
  if (!cols.has(col)) throw new Error(`La columna "${col}" no existe.`);
  return col;
}

const SQL_OP = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE' };

function buildWhere(cols, filtros, offset = 0) {
  const clauses = [], vals = [];
  let idx = offset + 1;
  for (const [op, pairs] of Object.entries(filtros || {})) {
    if (!OPERADORES.has(op) || !pairs || typeof pairs !== 'object') continue;
    for (const [col, val] of Object.entries(pairs)) {
      const c = cols.get(columnaExistente(cols, col));
      if (op === 'is') {
        clauses.push(`${col} IS ${val === null ? 'NULL' : val ? 'TRUE' : 'FALSE'}`);
      } else if (op === 'in') {
        const arr = Array.isArray(val) ? val : [val];
        if (!arr.length) { clauses.push('FALSE'); continue; }
        const ph = arr.map(() => `$${idx++}`).join(',');
        vals.push(...arr.map(v => prepararValor(c, v)));
        clauses.push(`${col} IN (${ph})`);
      } else if (op === 'eq' && val === null) {
        clauses.push(`${col} IS NULL`);
      } else if (op === 'neq' && val === null) {
        clauses.push(`${col} IS NOT NULL`);
      } else {
        clauses.push(`${col} ${SQL_OP[op]} $${idx++}`);
        vals.push(prepararValor(c, val));
      }
    }
  }
  return { clauses, vals };
}

function filtrosDe(params) {
  const { eq, neq, gt, gte, lt, lte, is, in: inParam, like, ilike } = params || {};
  return { eq, neq, gt, gte, lt, lte, is, in: inParam, like, ilike };
}

// Condición que rechaza la sentencia si alguna fila escrita queda fuera de la empresa
const rechazo = (cond) => `(${cond}) OR gyc_rechazar('El registro no pertenece a su empresa.')`;

// ── list ────────────────────────────────────────────────────────────────────

async function accionList(tabla, cols, params, perfil) {
  const { select, order, limit } = params;
  const lista = select ? String(select).split(',').map(c => columnaExistente(cols, c.trim())).join(', ') : '*';
  const { clauses, vals } = buildWhere(cols, filtrosDe(params));
  const a = alcance(tabla, 'leer', perfil, vals.length + 1);
  clauses.push(a.sql);
  vals.push(...a.vals);
  let sql = `SELECT ${lista} FROM ${tabla} WHERE ${clauses.join(' AND ')}`;
  const ordenado = validarOrden(order);
  if (ordenado.length) sql += ` ORDER BY ${ordenado.map(([c, asc]) => `${columnaExistente(cols, c)} ${asc ? 'ASC' : 'DESC'}`).join(', ')}`;
  if (limit) sql += ` LIMIT ${Math.max(1, Math.min(50000, parseInt(limit, 10) || 100))}`;
  return query(sql, vals, perfil.id);
}

// ── insert / upsert ─────────────────────────────────────────────────────────

function prepararFilas(tabla, cols, data, perfil) {
  if (!data || typeof data !== 'object') throw new Error('data requerido');
  const filas = (Array.isArray(data) ? data : [data]).map(f => limpiarFila(cols, f));
  for (const f of filas) {
    // La empresa la pone el servidor si falta; no se aceptan filas de otra empresa
    if (cols.has('area_id') && tabla !== 'listas' && (f.area_id === undefined || f.area_id === null)) f.area_id = perfil.area_id;
    if (tabla === 'listas' && f.area_id === undefined) f.area_id = perfil.area_id;
    if (cols.has('created_by') && f.created_by == null) f.created_by = perfil.id;
    if (cols.has('autor_id') && f.autor_id == null && ['comentarios', 'enlaces', 'solicitudes_cambio'].includes(tabla)) f.autor_id = perfil.id;
  }
  return filas;
}

function valuesSql(filas, desde = 1) {
  const colsUnion = [...new Set(filas.flatMap(f => Object.keys(f)))];
  if (!colsUnion.length) throw new Error('data requerido');
  const vals = [];
  let n = desde;
  const ph = filas.map(f => `(${colsUnion.map(c => {
    if (!(c in f)) return 'DEFAULT';
    vals.push(f[c]);
    return `$${n++}`;
  }).join(',')})`).join(',');
  return { colsUnion, ph, vals };
}

async function insertar(tabla, cols, filas, perfil, conflicto) {
  if (tabla === 'profiles') throw new AuthError('Los usuarios se crean desde Configuración → Usuarios.', 403);
  const { colsUnion, ph, vals } = valuesSql(filas);
  const a = alcance(tabla, 'escribir', perfil, vals.length + 1);
  let sql = `INSERT INTO ${tabla} (${colsUnion.join(',')}) VALUES ${ph}`;
  if (conflicto) {
    const claves = conflicto.split(',').map(c => columnaExistente(cols, c.trim()));
    const setCols = colsUnion.filter(c => !claves.includes(c) && c !== 'area_id');
    sql += ` ON CONFLICT (${claves.join(',')}) DO ${setCols.length
      ? `UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(',')}`
      : 'NOTHING'}`;
  }
  // Una fila existente de otra empresa que choque con la clave también queda rechazada (su area_id no se actualiza)
  sql = `WITH escritas AS (${sql} RETURNING *) SELECT * FROM escritas WHERE ${rechazo(a.sql)}`;
  return query(sql, [...vals, ...a.vals], perfil.id);
}

async function accionInsert(tabla, cols, { data }, perfil) {
  const filas = prepararFilas(tabla, cols, data, perfil);
  if (!filas.length) return [];
  return insertar(tabla, cols, filas, perfil, null);
}

async function accionUpsert(tabla, cols, { data, onConflict }, perfil) {
  const filas = prepararFilas(tabla, cols, data, perfil);
  if (!filas.length) return [];
  return insertar(tabla, cols, filas, perfil, onConflict || 'id');
}

// ── update ───────────────────────────────────────────────────────────────────

function setSql(cols, data) {
  const limpio = limpiarFila(cols, data);
  delete limpio.id;
  delete limpio.area_id;          // un registro no cambia de empresa por aquí
  const claves = Object.keys(limpio);
  if (!claves.length) throw new Error('data requerido');
  return { claves, set: claves.map((c, i) => `${c}=$${i + 1}`).join(','), vals: claves.map(c => limpio[c]) };
}

async function accionUpdate(tabla, cols, { id, data }, perfil) {
  if (!id) throw new Error('id requerido');
  if (!data || !Object.keys(data).length) throw new Error('data requerido');
  if (tabla === 'profiles') await verificarCambioPerfil(perfil, id, data);
  const { set, vals } = setSql(cols, data);
  const a = alcance(tabla, 'escribir', perfil, vals.length + 2);
  const sql = `WITH escritas AS (UPDATE ${tabla} SET ${set} WHERE id=$${vals.length + 1} AND ${a.sql} RETURNING *)
               SELECT * FROM escritas WHERE ${rechazo(a.sql)}`;
  const rows = await query(sql, [...vals, id, ...a.vals], perfil.id);
  if (!rows.length) throw new Error('El registro ya no existe.');
  return rows[0];
}

async function accionUpdateWhere(tabla, cols, { data, ...filtros }, perfil) {
  if (!data || !Object.keys(data).length) throw new Error('data requerido');
  if (tabla === 'profiles') throw new AuthError('Use la edición de usuarios.', 403);
  const { set, vals } = setSql(cols, data);
  const { clauses, vals: wVals } = buildWhere(cols, filtrosDe(filtros), vals.length);
  if (!clauses.length) throw new Error('updateWhere requiere al menos un filtro');
  const a = alcance(tabla, 'escribir', perfil, vals.length + wVals.length + 1);
  const sql = `WITH escritas AS (UPDATE ${tabla} SET ${set} WHERE ${clauses.join(' AND ')} AND ${a.sql} RETURNING *)
               SELECT * FROM escritas WHERE ${rechazo(a.sql)}`;
  return query(sql, [...vals, ...wVals, ...a.vals], perfil.id);
}

// ── remove ───────────────────────────────────────────────────────────────────

async function accionRemove(tabla, { id }, perfil) {
  if (!id) throw new Error('id requerido');
  if (tabla === 'profiles') throw new AuthError('Use «Eliminar usuario».', 403);
  const a = alcance(tabla, 'escribir', perfil, 2);
  await query(`DELETE FROM ${tabla} WHERE id=$1 AND ${a.sql}`, [id, ...a.vals], perfil.id);
  return { ok: true };
}

async function accionRemoveWhere(tabla, cols, filtros, perfil) {
  if (tabla === 'profiles') throw new AuthError('Use «Eliminar usuario».', 403);
  const { clauses, vals } = buildWhere(cols, filtrosDe(filtros));
  if (!clauses.length) throw new Error('removeWhere requiere al menos un filtro');
  const a = alcance(tabla, 'escribir', perfil, vals.length + 1);
  await query(`DELETE FROM ${tabla} WHERE ${clauses.join(' AND ')} AND ${a.sql}`, [...vals, ...a.vals], perfil.id);
  return { ok: true };
}

// ── rpc ──────────────────────────────────────────────────────────────────────
// Solo las funciones que usa el aplicativo, cada una con su verificación de permisos.

const RPC = {
  async registro_abierto() {
    const [r] = await query(`SELECT registro_abierto() AS v`);
    return r.v;
  },

  async exportar_respaldo(_args, perfil) {
    if (!esAdmin(perfil) && !(await puede(perfil, 'exportar_respaldo'))) throw new AuthError('No tiene permiso para exportar el respaldo.', 403);
    const [r] = await query(`SELECT exportar_respaldo_area($1) AS v`, [perfil.area_id], perfil.id);
    return r.v;
  },

  async cerrar_semanas_vencidas(_args, perfil) {
    if (!esGestor(perfil)) throw new AuthError('Solo los gestores ejecutan el cierre automático.', 403);
    const [r] = await query(`SELECT cerrar_semanas_vencidas() AS v`, [], perfil.id);
    return r.v;
  },

  async eliminar_proyecto_completo({ p_proyecto }, perfil) {
    if (!esAdmin(perfil)) throw new AuthError('Solo un administrador puede eliminar un proyecto con su historial.', 403);
    const [p] = await query(`SELECT id FROM proyectos WHERE id = $1 AND area_id = $2`, [p_proyecto, perfil.area_id]);
    if (!p) throw new Error('Proyecto no encontrado.');
    const [r] = await query(`SELECT eliminar_proyecto_completo($1) AS v`, [p_proyecto], perfil.id);
    return r.v;
  },

  async eliminar_usuario({ p_usuario }, perfil) {
    return eliminarUsuario(perfil, String(p_usuario || ''));
  },
};

async function accionRpc({ nombre, params: args }, perfil) {
  const f = Object.prototype.hasOwnProperty.call(RPC, nombre) ? RPC[nombre] : null;
  if (!f) throw new Error(`Función no disponible: ${nombre}`);
  if (nombre !== 'registro_abierto' && !habilitado(perfil)) throw new AuthError('No autorizado.', 403);
  return f(args || {}, perfil);
}
