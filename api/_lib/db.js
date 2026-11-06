import { neon, types } from '@neondatabase/serverless';

/**
 * Tipos como los devolvía Supabase (PostgREST), que es lo que espera el aplicativo:
 * date → 'AAAA-MM-DD' (no un Date con hora), numeric y bigint → número (no texto).
 * Se exporta para aplicar lo mismo al cliente de pruebas (node-postgres).
 */
export function configurarTipos(t) {
  t.setTypeParser(1082, v => v);                                   // date
  t.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));  // numeric
  t.setTypeParser(20, v => (v === null ? null : Number(v)));        // bigint (count, bigserial)
}
configurarTipos(types);

let _sql = null;
let _ejecutor = null;   // solo pruebas: reemplaza a Neon por otro cliente (ver pruebas/api)

export function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no configurada');
    _sql = neon(process.env.DATABASE_URL, { types });
  }
  return _sql;
}

/**
 * Solo para pruebas: ejecutor(sentencias, uid) → Promise<filas[][]>, donde sentencias = [[texto, params], …]
 * se ejecutan en una transacción con app.current_user_id = uid.
 */
export function usarEjecutor(fn) { _ejecutor = fn; }

/**
 * Ejecuta varias sentencias en UNA transacción con el usuario actual fijado en app.current_user_id
 * (lo lee public.mi_uid() en la auditoría y en las reglas de cierre). Devuelve las filas de cada sentencia.
 * @param {string|null} uid
 * @param {Array<[string, any[]]>} sentencias
 * @returns {Promise<any[][]>}
 */
export async function transaccion(uid, sentencias) {
  if (_ejecutor) return _ejecutor(sentencias, uid);
  const sql = getSql();
  const consultas = [
    sql('SELECT set_config($1, $2, true)', ['app.current_user_id', uid || '']),
    ...sentencias.map(([texto, params = []]) => sql(texto, params)),
  ];
  const res = await sql.transaction(consultas);
  return res.slice(1);
}

/**
 * Ejecuta una consulta parametrizada y devuelve las filas.
 * @param {string} text  SQL con placeholders $1, $2, …
 * @param {any[]}  params
 * @param {string|null} uid  usuario actual (opcional)
 * @returns {Promise<any[]>}
 */
export async function query(text, params = [], uid = null) {
  const [filas] = await transaccion(uid, [[text, params]]);
  return filas;
}
