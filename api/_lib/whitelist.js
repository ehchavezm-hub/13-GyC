// Tablas permitidas para el endpoint genérico /api/datos y su alcance por empresa.
// Ningún nombre de tabla/columna llegado del cliente pasa a SQL sin pasar por estas listas.
// En Supabase esto lo hacía la seguridad por filas (RLS); en Neon lo hace el API: cada lectura y escritura
// se limita a la empresa activa de la persona (:A) o a la propia persona (:U).

const EN_EMPRESA = 'area_id = :A';
const PROYECTO_DE_EMPRESA = 'proyecto_id IN (SELECT id FROM proyectos WHERE area_id = :A)';

// tabla → { leer, escribir } (condiciones SQL sobre las columnas de la tabla; escribir = null → solo lectura)
export const ALCANCE = {
  // Datos de la empresa
  actividades: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  acuerdos: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  cartera: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  cierres: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  columnas_personalizadas: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  comentarios: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  enlaces: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  hitos: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  organigrama_nodos: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  pac_historico: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  parametros: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  permisos: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  plantillas: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  portafolios: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  programas: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  proyectos: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  restricciones: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  reuniones: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  solicitudes_cambio: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  supervisiones: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  ubicaciones_dia: { leer: EN_EMPRESA, escribir: EN_EMPRESA },
  vistas: { leer: EN_EMPRESA, escribir: `${EN_EMPRESA} AND (usuario_id IS NULL OR usuario_id = :U)` },
  auditoria: { leer: EN_EMPRESA, escribir: null },
  delegado_historial: { leer: EN_EMPRESA, escribir: null },

  // Catálogos (las listas sin empresa son comunes a todas)
  listas: { leer: '(area_id = :A OR area_id IS NULL)', escribir: EN_EMPRESA },
  lista_valores: {
    leer: 'lista_id IN (SELECT id FROM listas WHERE area_id = :A OR area_id IS NULL)',
    escribir: 'lista_id IN (SELECT id FROM listas WHERE area_id = :A)',
  },

  // Dependen de un proyecto o plantilla de la empresa
  proyecto_lideres: { leer: PROYECTO_DE_EMPRESA, escribir: PROYECTO_DE_EMPRESA },
  proyecto_favoritos: { leer: `usuario_id = :U AND ${PROYECTO_DE_EMPRESA}`, escribir: `usuario_id = :U AND ${PROYECTO_DE_EMPRESA}` },
  plantilla_items: {
    leer: 'plantilla_id IN (SELECT id FROM plantillas WHERE area_id = :A)',
    escribir: 'plantilla_id IN (SELECT id FROM plantillas WHERE area_id = :A)',
  },
  programa_arranque: { leer: PROYECTO_DE_EMPRESA, escribir: PROYECTO_DE_EMPRESA },
  programa_arranque_detalle: {
    leer: 'programa_id IN (SELECT pa.id FROM programa_arranque pa JOIN proyectos p ON p.id = pa.proyecto_id WHERE p.area_id = :A)',
    escribir: 'programa_id IN (SELECT pa.id FROM programa_arranque pa JOIN proyectos p ON p.id = pa.proyecto_id WHERE p.area_id = :A)',
  },
  programa_arranque_items: { leer: 'TRUE', escribir: null },

  // Personas
  notificaciones: { leer: 'usuario_id = :U', escribir: 'usuario_id = :U' },
  profiles: {
    leer: '(id = :U OR area_id = :A OR id IN (SELECT usuario_id FROM empresa_miembros WHERE area_id = :A))',
    escribir: '(id = :U OR area_id = :A)',
  },
  empresa_miembros: { leer: '(area_id = :A OR usuario_id = :U)', escribir: null },
  areas: { leer: '(id = :A OR id IN (SELECT area_id FROM empresa_miembros WHERE usuario_id = :U AND activo))', escribir: null },
};

export const TABLAS = new Set(Object.keys(ALCANCE));

// Tablas que el rol "consulta" (solo lectura) sí puede escribir: lo propio de cada persona
export const ESCRIBE_CONSULTA = new Set(['notificaciones', 'proyecto_favoritos', 'vistas', 'solicitudes_cambio', 'comentarios', 'enlaces', 'profiles']);

export const OPERADORES = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'like', 'ilike']);

const ID_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export function validarTabla(nombre) {
  if (!nombre || !TABLAS.has(nombre)) throw new Error(`Tabla no permitida: ${nombre}`);
  return nombre;
}

export function validarColumna(col) {
  if (!col || !ID_RE.test(col)) throw new Error(`Nombre de columna inválido: ${col}`);
  return col;
}

export function validarOrden(order) {
  if (!Array.isArray(order)) return [];
  return order.map(([col, asc]) => {
    validarColumna(col);
    return [col, asc !== false];
  });
}

/**
 * Condición de alcance con sus parámetros numerados a partir de `desde` (1-based).
 * @returns {{ sql: string, vals: any[] }}
 */
export function alcance(tabla, modo, perfil, desde) {
  const cond = ALCANCE[tabla]?.[modo === 'leer' ? 'leer' : 'escribir'];
  if (cond == null) throw new Error(`La tabla ${tabla} es de solo lectura.`);
  const vals = [];
  let n = desde;
  const marcas = {};
  const sql = cond.replace(/:([AU])/g, (_, k) => {
    if (!marcas[k]) { marcas[k] = `$${n++}`; vals.push(k === 'A' ? perfil.area_id ?? null : perfil.id); }
    return marcas[k];
  });
  return { sql, vals };
}
