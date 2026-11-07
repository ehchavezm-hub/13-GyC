// Columnas reales de cada tabla (information_schema), leídas una vez por instancia del servidor.
// Sirve para: rechazar columnas inexistentes, omitir las generadas (actividades.hh_total), convertir los valores
// jsonb a JSON y las cadenas vacías de columnas no textuales a NULL (como hacía PostgREST en Supabase).
import { query } from './db.js';

let _cache = null;

async function cargar() {
  const filas = await query(
    `SELECT table_name, column_name, udt_name, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public'`);
  const mapa = new Map();
  for (const f of filas) {
    if (!mapa.has(f.table_name)) mapa.set(f.table_name, new Map());
    mapa.get(f.table_name).set(f.column_name, {
      tipo: f.udt_name,
      generada: f.is_generated === 'ALWAYS',
      json: f.udt_name === 'json' || f.udt_name === 'jsonb',
      texto: ['text', 'varchar', 'bpchar', 'name', 'citext'].includes(f.udt_name),
    });
  }
  return mapa;
}

// Migración que crea cada tabla agregada después de la 035 (para que el aviso diga cuál ejecutar)
const MIGRACION_DE = {
  actas: '041_actas.sql', acta_asistentes: '041_actas.sql', acta_acuerdos: '041_actas.sql',
  programa_arranque: '037_programa_arranque_r1.sql', programa_arranque_items: '037_programa_arranque_r1.sql',
  programa_arranque_detalle: '037_programa_arranque_r1.sql', programa_arranque_seguimiento: '037_programa_arranque_r1.sql',
  cuentas_preasignadas: '036_cuentas_preasignadas.sql',
};

export async function columnas(tabla) {
  if (!_cache) _cache = cargar().catch(e => { _cache = null; throw e; });
  const mapa = await _cache;
  const cols = mapa.get(tabla);
  if (!cols) throw new Error(`La tabla ${tabla} no existe en la base. Ejecute en el SQL Editor de Neon la migración ${MIGRACION_DE[tabla] || 'pendiente de db/migrations (en orden)'}.`);
  return cols;
}

/** Solo pruebas: olvida el esquema leído. */
export function olvidarEsquema() { _cache = null; }

/** Valor listo para enviar a Postgres según el tipo de la columna. */
export function prepararValor(col, v) {
  if (v === undefined || v === null) return null;
  if (col.json) return JSON.stringify(v);
  if (v === '' && !col.texto) return null;
  return v;
}

/**
 * Deja solo las columnas que existen y no son generadas, con sus valores preparados.
 * @returns {Object} fila limpia
 */
export function limpiarFila(cols, fila) {
  const out = {};
  for (const [k, v] of Object.entries(fila || {})) {
    const c = cols.get(k);
    if (!c || c.generada) continue;
    out[k] = prepararValor(c, v);
  }
  return out;
}
