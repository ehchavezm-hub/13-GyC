// Valores iniciales de listas, parámetros y permisos. Deben coincidir con
// db/migrations/003_datos_iniciales.sql (se usan en el modo demostración).

// Grupos de listas en Configuración → Listas (el grupo de cada lista se puede cambiar; este es el inicial)
export const GRUPOS_LISTAS = ['Gerencias, proyectos y servicios', 'Detalle de actividades y seguimiento', 'Configuración general del aplicativo', 'Otras listas'];
export const GRUPO_INICIAL = {
  gerencias: 0, servicios: 0, categorias_servicio: 0, cet: 0, tipos_proyecto: 0, fases: 0, paises: 0,
  cnc: 1, tipos_restriccion: 1, criticidad: 1, tipos_cartera: 1, ubicaciones: 1,
  estados_compromiso: 2, tipos_actividad: 2, estados_la: 2, estados_proyecto: 2, estados_restriccion: 2, estados_cartera: 2,
};
// Listas retiradas: no se muestran (sus datos se conservan por el historial). La lista CET se fusionó con "CET / Servicio".
export const LISTAS_RETIRADAS = ['cet'];
const GRUPO_PROPIO = { cargos: 'Equipo y organización' };
export const grupoDeLista = l => l.grupo || GRUPO_PROPIO[l.clave] || GRUPOS_LISTAS[GRUPO_INICIAL[l.clave] ?? 3];

// Significado de cada estado (se muestra al pasar el mouse por la opción o la celda).
// Si en Configuración → Listas el valor tiene descripción, se usa esa.
export const AYUDA_ESTADOS = {
  estados_la: {
    pendiente: 'Registrada, pero aún no se revisa si puede hacerse. Estado inicial de toda actividad nueva.',
    con_restriccion: 'Algo impide hacerla (información, planos, aprobaciones, recursos…). Se marca sola al registrar una restricción 🚧.',
    lista: 'Sin impedimentos: se puede comprometer. Se marca sola al levantar la última restricción. Solo las "Lista" pasan al Plan con «Comprometer semana».',
    trasladada: 'Ya pasó al Plan semanal como compromiso (se marca sola al comprometer la semana).',
    cancelada: 'Ya no se hará. No cuenta en la carga ni en la capacidad.',
  },
  estados_compromiso: {
    programado: 'Comprometido para la semana; falta indicar cómo terminó.',
    completado: 'Se cumplió en la semana. Suma al PAC.',
    no_completado: 'No se cumplió. Requiere la causa de no cumplimiento (CNC). Resta al PAC.',
    cancelado: 'Se dejó de hacer por decisión del equipo. No cuenta en el PAC.',
  },
  tipos_actividad: {
    programada: 'Planificada desde el Look Ahead o al inicio de la semana.',
    no_programada: 'Surgió durante la semana sin estar planificada (urgencia o pedido nuevo).',
  },
};

export const LISTAS_INICIALES = [
  ['cargos', 'Cargos', [[null, 'Gerente Técnico'], [null, 'Gerente Técnico en Geotecnia y Pavimentos'], [null, 'Líder BIM'], [null, 'Ingeniero BIM'],
    [null, 'Especialista en Métodos Constructivos - Encofrados y Andamios'], [null, 'Administrador de Información de Proyectos']]],
  ['gerencias', 'Gerencias (clientes internos)', [
    ['GI', 'Gerencia de Ingeniería'], ['GOI', 'Gerencia de Obras Industriales'], ['GOC', 'Gerencia de Obras Civiles'],
    ['GOF', 'Gerencia de Obras de Infraestructura'], ['PyL', 'Propuestas y Licitaciones'],
    ['GOI_CH', 'Gerencia de Obras Industriales Chile'], ['GOC_CH', 'Gerencia de Obras Civiles Chile'], ['GIPT', 'Gerencia de Innovación']]],
  ['servicios', 'CET / Servicio', [
    [null, 'Seguimiento implementación BIM'], [null, 'Envío y recepción de documentos técnicos'], [null, 'Monitoreo y control de RFI'],
    [null, 'Gestión de las comunicaciones'], [null, 'Consultas técnicas'], [null, 'Metrados'], [null, 'Mejora de procesos'],
    [null, 'Gestión del conocimiento'], [null, 'Planificación, monitoreo y control del área'], [null, 'Propuestas y licitaciones']]],
  ['categorias_servicio', 'Categorías de servicio', [[null, 'Proyecto'], [null, 'Mejora de procesos'], [null, 'Gestión del conocimiento'], [null, 'Gestión del área']]],
  ['tipos_proyecto', 'Tipos de proyecto', [[null, 'Proyecto'], [null, 'Proceso interno'], [null, 'Gestión del área'], [null, 'Capacitación / conocimiento']]],
  ['fases', 'Fases de proyecto', [[null, 'Diseño'], [null, 'Preconstrucción'], [null, 'Construcción'], [null, 'Cierre'], [null, 'Permanente']]],
  ['paises', 'Países', [[null, 'Perú'], [null, 'Chile'], [null, 'Colombia'], [null, 'Bolivia']]],
  ['estados_proyecto', 'Estados de proyecto', [
    ['propuesto', 'Propuesto', '#EDC948', 1], ['activo', 'Activo', '#59A14F', 1], ['en_pausa', 'En pausa', '#BAB0AC', 1],
    ['cerrado', 'Cerrado', '#4E79A7', 1], ['rechazado', 'Rechazado', '#E15759', 1]]],
  ['tipos_actividad', 'Tipos de compromiso', [['programada', 'Programada', null, 1], ['no_programada', 'No programada', null, 1]]],
  ['estados_la', 'Estados de Look Ahead', [
    ['pendiente', 'Pendiente', '#BAB0AC', 1], ['con_restriccion', 'Con restricción', '#E15759', 1], ['lista', 'Lista', '#59A14F', 1],
    ['trasladada', 'Trasladada al plan', '#4E79A7', 1], ['cancelada', 'Cancelada', '#9E9E9E', 1]]],
  ['estados_compromiso', 'Estados de compromiso', [
    ['programado', 'Programado', '#EDC948', 1], ['completado', 'Completado', '#59A14F', 1],
    ['no_completado', 'No completado', '#E15759', 1], ['cancelado', 'Cancelado', '#BAB0AC', 1]]],
  ['cnc', 'Causas de no cumplimiento (CNC)', [
    [null, 'Mala planificación / subestimación de HH'], [null, 'Trabajo previo no terminado (pre-requisito)'],
    [null, 'Sin información del cliente / información faltante'], [null, 'Indefinición técnica / problema de diseño o planos'],
    [null, 'Aprobación pendiente (interna o del cliente)'], [null, 'Decisión de cliente'], [null, 'Cambio de prioridad'],
    [null, 'Dependencia externa / de otra área'], [null, 'Falta de recursos (personal no disponible)'],
    [null, 'Herramientas, software o accesos no disponibles'], [null, 'Contratos / órdenes de cambio'],
    [null, 'Permisos / autorizaciones faltantes'], [null, 'Condición no prevista'], [null, 'Fuerza mayor (incluye clima)'],
    [null, 'Me olvidé'], [null, 'Otra causa (especificar en comentario)'], ['no_reportado', 'No reportado al cierre', null, 1]]],
  ['tipos_restriccion', 'Tipos de restricción', [[null, 'Información del cliente'], [null, 'Aprobación'], [null, 'Recursos'],
    [null, 'Dependencia de otra área'], [null, 'Accesos / software'], [null, 'Contractual'], [null, 'Otro']]],
  ['estados_restriccion', 'Estados de restricción', [
    ['pendiente', 'Pendiente', '#E15759', 1], ['en_gestion', 'En gestión', '#EDC948', 1], ['levantada', 'Levantada', '#59A14F', 1]]],
  ['criticidad', 'Criticidad', [[null, 'Alta', '#E15759'], [null, 'Media', '#EDC948'], [null, 'Baja', '#59A14F']]],
  ['tipos_cartera', 'Tipos de cartera', [[null, 'Proyecto'], [null, 'Permanente']]],
  ['estados_cartera', 'Estados de cartera', [
    ['nueva', 'Solicitud nueva', '#F28E2B', 1], ['abierta', 'Abierto', '#4E79A7', 1], ['en_proceso', 'En proceso', '#EDC948', 1],
    ['cerrada', 'Cerrado', '#59A14F', 1], ['rechazada', 'Rechazado', '#E15759', 1]]],
  ['ubicaciones', 'Ubicaciones', [
    ['oficina', 'Oficina', '#4E79A7', 0, { cuenta_capacidad: true }], ['proyecto', 'Proyecto (obra)', '#F28E2B', 0, { cuenta_capacidad: true }],
    ['remoto', 'Remoto', '#76B7B2', 0, { cuenta_capacidad: true }], ['vacaciones', 'Vacaciones / licencia', '#BAB0AC', 0, { cuenta_capacidad: false }],
    ['feriado', 'Feriado', '#B07AA1', 0, { cuenta_capacidad: false }]]],
];

export const PARAMETROS_INICIALES = {
  meta_pac: 0.8,
  umbral_ambar: 0.6,
  semanas_lookahead: 3,
  // Look Ahead (pedidos 110 y 111): días en que se registra y qué semana planifica ('actual' = esa misma semana, 'siguiente' = la próxima)
  look_ahead: { dias: [5], semana: 'siguiente' },
  horas_dia: 8,
  dias_laborables: [1, 2, 3, 4, 5],
  trabajo_fin_semana: false,   // muestra sábado y domingo para registrar trabajo esos días
  cierre: { dias: [5], dia: 5, hora: '17:00' },
  reunion: { dias: [5], hora: '08:00' },   // días de la reunión de cumplimiento del plan semanal (pedido 112)
  cierre_automatico: true,
  alerta_dias: 3,
  arrastre_alerta: 2,
  zona_horaria: 'America/Lima',
  version_app: 'GyC V1.00.00',
  firma_pdf: 'By EHCM',
  reunion_minutos: { cierre: 10, avance: 10, restricciones: 10, compromisos: 20, lookahead: 10 },
  reconocimientos: { mejor_pac: true, mayor_mejora: true },
};

export const ACCIONES = [
  ['ver_semana',          'Ver semanas del plan semanal'],
  ['crear_semana',        'Crear compromisos en el plan semanal'],
  ['editar_semana',       'Editar compromisos del plan semanal'],
  ['cerrar_semana',       'Cerrar semanas (propias y de otros líderes)'],
  ['ver_compromiso',      'Ver compromisos y detalle de actividades'],
  ['crear_compromiso',    'Crear nuevos compromisos'],
  ['editar_compromiso',   'Editar compromisos existentes'],
  ['cerrar_compromiso',   'Cerrar compromisos al final de semana'],
  ['ver_restriccion',     'Ver restricciones del Look Ahead'],
  ['crear_restriccion',   'Registrar nuevas restricciones'],
  ['editar_restriccion',  'Editar restricciones existentes'],
  ['resolver_restriccion','Marcar restricciones como levantadas'],
  ['ver_cartera',         'Ver la cartera de proyectos y servicios'],
  ['crear_cartera',       'Crear proyectos y solicitudes en cartera'],
  ['editar_cartera',      'Editar proyectos y solicitudes de cartera'],
  ['exportar_pdf',        'Exportar reportes a PDF / Excel'],
  ['ver_indicadores',     'Ver el tablero de indicadores y KPIs'],
  ['importar_datos',      'Importar histórico y datos desde Excel'],
  ['ver_solicitud',       'Ver solicitudes de servicio a la GT'],
  ['crear_solicitud',     'Registrar solicitudes de servicio a la GT'],
];

const conPermisos = lista => Object.fromEntries(ACCIONES.map(([a]) => [a, lista.includes(a)]));

// Valores por defecto (migración 003). El admin siempre tiene todo; delegado/lider/consulta son editables.
export const PERMISOS_INICIALES = {
  admin:    Object.fromEntries(ACCIONES.map(([a]) => [a, true])),
  delegado: Object.fromEntries(ACCIONES.map(([a]) => [a, true])),
  lider:    conPermisos(['ver_semana', 'crear_semana', 'editar_semana', 'ver_compromiso', 'crear_compromiso', 'editar_compromiso']),
  consulta: conPermisos(['ver_semana', 'ver_compromiso', 'ver_indicadores']),
};

// El orden define cómo se muestran en listas y en la matriz de permisos.
// "lider" conserva su código interno; desde la versión 1.1 se muestra como "Líder de especialidad".
export const ROLES = {
  superadmin: 'Super administrador',
  admin: 'Administrador',
  delegado: 'Administrador delegado',
  lider: 'Líder de especialidad',
  consulta: 'Consulta',
  pendiente: 'Pendiente de aprobación',
};

/** Roles que planifican: tienen plan semanal, Look Ahead y PAC (equivale a public.rol_planifica). */
export const PLANIFICADORES = ['lider'];
export const COLOR_ROL = { superadmin: '#1A365D', admin: '#E8762B', delegado: '#4E79A7', lider: '#59A14F', consulta: '#76B7B2', pendiente: '#BAB0AC' };

/**
 * Listas, parámetros y permisos iniciales de una empresa nueva (pedido 113). Salen de estos mismos catálogos;
 * las listas propias de cada empresa (gerencias, CET / Servicio y cargos) empiezan vacías.
 */
export function semillaEmpresa() {
  const PROPIAS = ['gerencias', 'servicios', 'cargos'];
  const listas = LISTAS_INICIALES.map(([clave, nombre, vals]) => ({
    clave, nombre, grupo: grupoDeLista({ clave }),
    valores: PROPIAS.includes(clave) ? [] : vals.map(([codigo, valor, color, protegido, extra]) =>
      ({ codigo: codigo ?? null, valor, color: color ?? null, protegido: !!protegido, extra: extra || {} })),
  }));
  const parametros = { ...PARAMETROS_INICIALES, version_app: 'GyC V1.00.00', firma_pdf: '' };
  const permisos = Object.entries(PERMISOS_INICIALES).flatMap(([rol, acciones]) =>
    Object.entries(acciones).map(([accion, permitido]) => ({ rol, accion, permitido })));
  return { listas, parametros, permisos };
}
