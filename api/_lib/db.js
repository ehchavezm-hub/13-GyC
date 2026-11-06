import { neon } from '@neondatabase/serverless';

let _sql = null;

export function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no configurada');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

/**
 * Ejecuta una consulta parametrizada y devuelve las filas.
 * @param {string} text  SQL con placeholders $1, $2, …
 * @param {any[]}  params
 * @returns {Promise<any[]>}
 */
export async function query(text, params = []) {
  const sql = getSql();
  return sql(text, params);
}
