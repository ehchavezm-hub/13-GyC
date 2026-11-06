// Tablas y columnas permitidas para el endpoint genérico /api/datos.
// Ningún nombre de tabla/columna llegado del cliente pasa a SQL sin pasar por estas listas.

export const TABLAS = new Set([
  'profiles', 'areas', 'proyectos', 'portafolios', 'programas',
  'actividades', 'cierres', 'restricciones', 'comentarios',
  'plantillas', 'plantilla_items',
  'listas', 'lista_valores',
  'notificaciones', 'mejoras', 'mejora_votos',
  'proyecto_lideres', 'proyecto_favoritos',
  'proyecto_gerencias',
]);

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
