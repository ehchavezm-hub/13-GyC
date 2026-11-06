// Estado de la sesión y catálogo en memoria (listas, parámetros, permisos, usuarios, proyectos).
import { api } from '../data/api.js';
import { PARAMETROS_INICIALES, PLANIFICADORES, AYUDA_ESTADOS } from '../data/catalogos.js';
import { lunes, sumarSemanas, DIAS_NOMBRE } from './util.js';

const bus = new EventTarget();

export const store = {
  usuario: null,         // perfil del usuario conectado
  area: null,
  listas: {},            // clave → { lista, valores[] }
  valores: new Map(),    // id → valor
  parametros: { ...PARAMETROS_INICIALES },
  permisos: {},          // rol → { accion → bool }
  perfiles: [],
  proyectos: [],
  portafolios: [],
  programas: [],
  proyectoLideres: [],
  supervisiones: [],     // { supervisor_id, subordinado_id, proyecto_id } por Grupo LPS
  favoritos: new Set(),
  columnas: [],
  proyectoSel: localStorage.getItem('lpsgt-proyecto') || '',
  // Portafolio o programa elegido en el árbol ('f:<id>' / 'g:<id>'): suma todos sus proyectos y Grupos LPS (pedido Q5)
  nivelSel: localStorage.getItem('lpsgt-proyecto') ? '' : (localStorage.getItem('lpsgt-nivel') || ''),
  notificaciones: [],
};

export function on(evento, cb) {
  const f = e => cb(e.detail);
  bus.addEventListener(evento, f);
  return () => bus.removeEventListener(evento, f);
}
export function emit(evento, detalle) { bus.dispatchEvent(new CustomEvent(evento, { detail: detalle })); }

export async function cargarPerfil(userId) {
  const [p] = await api.list('profiles', { eq: { id: userId } });
  store.usuario = p || null;
  return store.usuario;
}

/** Cantidad de comentarios y enlaces por actividad (columna 💬): solo la columna entidad_id y solo de la empresa,
 *  en lugar del texto completo de todos los comentarios. Se pide en paralelo con las actividades. */
export async function conteoColaboracion() {
  const f = { eq: { entidad: 'actividad', area_id: store.area.id }, select: 'entidad_id' };
  const n = new Map();
  try {
    const [coms, enls] = await Promise.all([api.list('comentarios', f), api.list('enlaces', f)]);
    for (const c of [...coms, ...enls]) n.set(c.entidad_id, (n.get(c.entidad_id) || 0) + 1);
  } catch { /* opcional */ }
  return n;
}

export async function cargarCatalogo() {
  const u = store.usuario;
  const [areas, listas, valores, params, permisos, perfiles, proyectos, lideres, favs, columnas, portafolios, programas, miembros, supervisiones] = await Promise.all([
    api.list('areas', { eq: { id: u.area_id } }).catch(() => []),
    api.list('listas', {}).catch(() => []),
    api.list('lista_valores', { order: [['orden', true]] }).catch(() => []),
    api.list('parametros', { eq: { area_id: u.area_id } }).catch(() => []),
    api.list('permisos', { eq: { area_id: u.area_id } }).catch(() => []),
    // Sin filtrar por empresa: la base devuelve solo los visibles (la propia persona y los de su empresa, incluidos los
    // miembros que hoy trabajan en otra empresa, migración 030); abajo se dejan los de esta empresa
    api.list('profiles', { order: [['nombre', true]] }).catch(() => []),
    api.list('proyectos', { eq: { area_id: u.area_id }, order: [['codigo', true]] }).catch(() => []),
    u.rol === 'consulta' ? Promise.resolve([]) : api.list('proyecto_lideres', {}).catch(() => []),
    api.list('proyecto_favoritos', { eq: { usuario_id: u.id } }).catch(() => []),
    api.list('columnas_personalizadas', { eq: { area_id: u.area_id }, order: [['orden', true]] }).catch(() => []),
    // Jerarquía de la empresa (menú de proyectos en árbol): Portafolio → Programa → Proyecto
    api.list('portafolios', { eq: { area_id: u.area_id }, order: [['nombre', true]] }).catch(() => []),
    api.list('programas', { eq: { area_id: u.area_id }, order: [['nombre', true]] }).catch(() => []),
    // Usuarios de varias empresas (030): sin la migración aplicada, lista vacía y todo funciona como antes
    api.list('empresa_miembros', {}).catch(() => []),
    // Supervisiones por Grupo LPS (s40): supervisor puede ver y editar actividades del subordinado en ese Grupo LPS
    api.list('supervisiones', { eq: { area_id: u.area_id } }).catch(() => []),
  ]);
  store.area = areas[0] || null;
  api.fijarArea?.(store.area?.id);
  store.listas = {};
  const porLista = new Map();
  for (const l of listas.filter(l => !l.area_id || l.area_id === u.area_id)) {
    store.listas[l.clave] = { lista: l, valores: [] };
    porLista.set(l.id, store.listas[l.clave]);
  }
  store.valores = new Map();
  for (const v of valores) {
    store.valores.set(v.id, v);
    porLista.get(v.lista_id)?.valores.push(v);
  }
  store.parametros = { ...PARAMETROS_INICIALES };
  for (const p of params) store.parametros[p.clave] = p.valor;
  store.permisos = {};
  for (const p of permisos) (store.permisos[p.rol] ||= {})[p.accion] = p.permitido;
  // Equipo de la empresa: quienes la tienen como empresa activa y sus miembros que hoy trabajan en otra (con su rol aquí)
  const deAqui = new Map(miembros.filter(m => m.area_id === u.area_id && m.activo !== false).map(m => [m.usuario_id, m]));
  store.perfiles = perfiles.filter(p => p.area_id === u.area_id || deAqui.has(p.id)).map(p => {
    if (p.area_id === u.area_id) return p;
    const m = deAqui.get(p.id);
    return { ...p, rol: m.rol, activo: m.activo, es_admin_principal: m.es_admin_principal, _otraEmpresa: true };
  });
  // Empresas de la persona (si son varias, el menú ofrece cambiar de empresa)
  store.misEmpresas = [...new Set([u.area_id, ...miembros.filter(m => m.usuario_id === u.id && m.activo !== false).map(m => m.area_id)])];
  store.proyectos = u.rol === 'consulta'
    ? proyectos.filter(p => p.estado === 'activo' && (u.gerencia_ids || []).includes(p.gerencia_id)) : proyectos;
  store.proyectoLideres = lideres;
  store.supervisiones = supervisiones.filter(s => s.activo !== false);
  store.favoritos = new Set(favs.map(f => f.proyecto_id));
  store.columnas = columnas;
  store.portafolios = portafolios;
  store.programas = programas;
  if (store.proyectoSel && !proyectos.some(p => p.id === store.proyectoSel)) seleccionarProyecto('');
  if (store.nivelSel && !nombreSeleccion()) seleccionarProyecto('');
  emit('catalogo');
}

// ---------- Permisos ----------
export function rol() { return store.usuario?.rol || 'anonimo'; }
export function esSuperadmin() { return rol() === 'superadmin' || !!store.usuario?.es_admin_principal; }
export function esAdmin() { return ['superadmin', 'admin'].includes(rol()); }
export function esGestor() { return ['superadmin', 'admin', 'delegado'].includes(rol()); }
export function esStaff() { return ['superadmin', 'admin', 'delegado', ...PLANIFICADORES].includes(rol()); }
export function puede(accion) {
  if (esSuperadmin()) return true;
  // El administrador usa su columna de la matriz (la edita el super administrador); sin fila, permitido
  if (rol() === 'admin') return store.permisos.admin?.[accion] ?? true;
  const propio = store.permisos[rol()]?.[accion];
  // Igual que public.puede(): un rol de planificación sin fila propia usa los permisos de "lider"
  if (propio === undefined && PLANIFICADORES.includes(rol())) return !!store.permisos.lider?.[accion];
  return !!propio;
}
/** Agregar proyectos activos al menú (administración o permiso "agregar_proyecto", pedido 100). */
export function puedeAgregarProyecto() { return esGestor(); }
/** Editar un proyecto: quien administra proyectos, quien lo agregó (si tiene el permiso) o quien lo propuso. */
export function puedeEditarProyecto(p) {
  if (!p) return false;
  const yo = store.usuario?.id;
  return esGestor() || (p.estado === 'propuesto' && p.propuesto_por === yo);
}
export function puedeEditarActividad(a) {
  return a.responsable_id === store.usuario?.id || esGestor() || esSupervisorDe(a.responsable_id, a.proyecto_id);
}
/** ¿El usuario actual supervisa al subordinado en ese Grupo LPS? */
export function esSupervisorDe(subordinadoId, proyectoId) {
  if (!subordinadoId || !proyectoId) return false;
  const yo = store.usuario?.id;
  return store.supervisiones.some(s => s.supervisor_id === yo && s.subordinado_id === subordinadoId && s.proyecto_id === proyectoId);
}
/** ¿El usuario actual supervisa a alguien (en algún Grupo LPS)? */
export function esSupervisorAlguno() {
  const yo = store.usuario?.id;
  return store.supervisiones.some(s => s.supervisor_id === yo);
}
/** IDs de los subordinados del usuario actual en un Grupo LPS dado. */
export function subordinadosEn(proyectoId) {
  const yo = store.usuario?.id;
  return store.supervisiones.filter(s => s.supervisor_id === yo && s.proyecto_id === proyectoId).map(s => s.subordinado_id);
}

// ---------- Listas ----------
export function valoresLista(clave, { inactivos = false } = {}) {
  return (store.listas[clave]?.valores || []).filter(v => inactivos || v.activo);
}
export function opciones(clave, { inactivos = false, vacio = true } = {}) {
  const ops = valoresLista(clave, { inactivos }).map(v => ({ value: v.id, label: v.valor }));
  return vacio ? [{ value: null, label: '—' }, ...ops] : ops;
}
export function etiqueta(id) { return id ? (store.valores.get(id)?.valor ?? '') : ''; }
export function colorValor(id) { return id ? store.valores.get(id)?.color : null; }
export function idPorCodigo(clave, codigo) { return valoresLista(clave, { inactivos: true }).find(v => v.codigo === codigo)?.id || null; }
export function valorPorCodigo(clave, codigo) { return valoresLista(clave, { inactivos: true }).find(v => v.codigo === codigo); }
/** Texto visible de un estado protegido (renombrable desde listas configurables). */
export function textoEstado(clave, codigo) { return valorPorCodigo(clave, codigo)?.valor || codigo || ''; }
export function colorEstado(clave, codigo) { return valorPorCodigo(clave, codigo)?.color || '#BAB0AC'; }
export function opcionesEstado(clave) {
  return valoresLista(clave, { inactivos: true }).map(v => ({ value: v.codigo, label: v.valor, ayuda: v.descripcion || AYUDA_ESTADOS[clave]?.[v.codigo] || '' }));
}

export function param(clave) { return store.parametros[clave] ?? PARAMETROS_INICIALES[clave]; }

// ---------- Look Ahead (pedido 110) ----------
// Configuración → Parámetros: día en que se registra el Look Ahead y si planifica esa misma semana o la siguiente.
export function configLookAhead() {
  const c = { ...PARAMETROS_INICIALES.look_ahead, ...(param('look_ahead') || {}) };
  // Varios días (pedido 111); se acepta el formato anterior de un solo día ("dia")
  const lista = (Array.isArray(c.dias) && c.dias.length ? c.dias : [c.dia ?? 5]).map(Number).filter(d => d >= 1 && d <= 7);
  const dias = [...new Set(lista.length ? lista : [5])].sort((a, b) => a - b);
  return { dias, ultimo: dias.at(-1), semana: c.semana === 'actual' ? 'actual' : 'siguiente' };
}
/** Primera semana del Look Ahead: la que se planifica y se compromete (la actual o la siguiente). */
export function semanaInicioLA() { return configLookAhead().semana === 'actual' ? lunes() : sumarSemanas(lunes(), 1); }
/** Semanas del horizonte del Look Ahead, desde semanaInicioLA(). */
export function semanasLookAhead() {
  const n = Number(param('semanas_lookahead')) || 3;
  return Array.from({ length: n }, (_, i) => sumarSemanas(semanaInicioLA(), i));
}
/** ¿La semana todavía se está planificando? Lo que se agregue al Plan cuenta como programado (no como "no programado"). */
export function semanaEnPlanificacion(semana) {
  const actual = lunes();
  if (semana > actual) return true;
  if (semana < actual || configLookAhead().semana !== 'actual') return false;
  const diaHoy = ((new Date().getDay() + 6) % 7) + 1;   // 1 = lunes … 7 = domingo
  return diaHoy <= configLookAhead().ultimo;   // hasta el último día de registro
}
/** Días de la reunión de cumplimiento del plan semanal (pedido 112); acepta el formato anterior { dia }. */
export function diasReunion() {
  const r = { ...PARAMETROS_INICIALES.reunion, ...(param('reunion') || {}) };
  const lista = (Array.isArray(r.dias) && r.dias.length ? r.dias : [r.dia ?? 5]).map(Number).filter(d => d >= 1 && d <= 7);
  return [...new Set(lista.length ? lista : [5])].sort((a, b) => a - b);
}
const unirDias = ds => { const n = ds.map(d => DIAS_NOMBRE[d - 1].toLowerCase()); return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n.at(-1)}` : n[0]; };
/** "viernes", "viernes y sábado"… */
export function textoDiasReunion() { return unirDias(diasReunion()); }
/** Días de cierre semanal (casillas, como el Look Ahead). Los parámetros anteriores guardaban un solo "dia". */
export function diasCierre() {
  const c = { ...PARAMETROS_INICIALES.cierre, ...(param('cierre') || {}) };
  const lista = (Array.isArray(c.dias) && c.dias.length ? c.dias : [c.dia ?? 5]).map(Number).filter(d => d >= 1 && d <= 7);
  return [...new Set(lista.length ? lista : [5])].sort((a, b) => a - b);
}
export function textoDiasCierre() { return unirDias(diasCierre()); }
/** "lunes", "lunes y martes", "lunes, martes y miércoles"… */
export function diaLookAhead() {
  const n = configLookAhead().dias.map(d => DIAS_NOMBRE[d - 1].toLowerCase());
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n.at(-1)}` : n[0];
}

// ---------- Personas ----------
export function perfil(id) { return store.perfiles.find(p => p.id === id); }
export function nombre(id) { return perfil(id)?.nombre || ''; }
export function lideres({ inactivos = false } = {}) {
  return store.perfiles.filter(p => ['superadmin', 'admin', 'delegado', ...PLANIFICADORES].includes(p.rol) && !p.eliminado && (inactivos || p.activo));
}
/** Todas las personas del equipo: administradores, delegado y roles que planifican (no consulta ni pendientes), por nombre. */
export function equipo() {
  return lideres().slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
}
/** Restricción de visibilidad de consulta (en Supabase la aplica RLS; aquí también en modo demostración). */
export function visibleParaConsulta(proyectoId) {
  if (rol() !== 'consulta') return true;
  const p = store.proyectos.find(x => x.id === proyectoId);
  return !!p && (store.usuario.gerencia_ids || []).includes(p.gerencia_id);
}
export function opcionesLideres() { return lideres().map(p => ({ value: p.id, label: p.nombre })); }
export function horasDia(id) { return Number(perfil(id)?.horas_dia ?? param('horas_dia')) || 0; }

// ---------- Proyectos ----------
export function proyecto(id) { return store.proyectos.find(p => p.id === id); }
/** CET / Servicio asociado a un proyecto (columna Proyecto de la lista "CET / Servicio"), si hay uno solo. */
/** ¿El CET / Servicio del proyecto «deServicio» sirve al proyecto «proyectoId»? Los Grupos LPS heredan los de su
 *  proyecto (pedido 14: los CET/Servicios de GT_OT sirven a Gestion y ConstruIA). */
export function servicioSirve(deServicio, proyectoId) {
  return !!deServicio && !!proyectoId && (deServicio === proyectoId || proyecto(proyectoId)?.padre_id === deServicio);
}
export function servicioDeProyecto(p) {
  if (!p) return null;
  const asociados = valoresLista('servicios').filter(v => servicioSirve(v.extra?.proyecto_id, p.id));
  return asociados.length === 1 ? asociados[0].id : null;
}
/** Proyecto al que pertenece un CET / Servicio (columna Proyecto de la lista), o null. */
export function proyectoDeServicio(id) { return (id && store.valores.get(id)?.extra?.proyecto_id) || null; }
/**
 * Opciones de CET / Servicio para elegir: si se indica un proyecto, solo los de ese proyecto y los que no tienen proyecto
 * (si el proyecto no tiene ninguno asociado, se ofrecen todos). etiqueta(v) arma el texto de cada opción.
 */
export function opcionesServicio({ proyectoId: _pId = null, etiqueta: etq = v => (v.codigo ? `${v.codigo} · ${v.valor}` : v.valor), vacio = true } = {}) {
  // s17: un Grupo LPS puede atender a un CET/Servicio de cualquier proyecto de la empresa
  const vs = valoresLista('servicios');
  const ops = vs.map(v => ({ value: v.id, label: etq(v) }));
  return vacio ? [{ value: null, label: '—' }, ...ops] : ops;
}
/**
 * Auditoría 3: dónde se guarda una actividad que viene de otro lado (cartera, Excel) con un proyecto «origen».
 * Si en el menú hay un Grupo LPS elegido y el origen es un proyecto (no un grupo), la actividad va al grupo
 * (proyecto_id) y el proyecto queda como «Proyecto atendido» (extra.proyecto_id), como al crearla en la grilla.
 * Sin grupo elegido se mantiene el comportamiento anterior (la actividad va al proyecto de origen).
 */
export function destinoActividad(origenId, extra = {}) {
  const sel = proyecto(store.proyectoSel);
  const o = proyecto(origenId);
  if (sel?.padre_id && o && !o.padre_id) return { proyecto_id: sel.id, extra: { ...extra, proyecto_id: o.id } };
  return { proyecto_id: origenId || (sel?.padre_id ? sel.id : null), extra };
}
export function nombreProyecto(id) { const p = proyecto(id); return p ? `${p.codigo} · ${nombreConPadre(p)}` : ''; }
export function proyectosActivos() { return store.proyectos.filter(p => p.estado === 'activo' || p.estado === 'propuesto'); }
// ---------- Grupos LPS (pedido a7) ----------
/** Grupos LPS de un proyecto. */
export function subproyectos(id) { return id ? store.proyectos.filter(p => p.padre_id === id) : []; }
/** Un proyecto con Grupos LPS es un contenedor: el LPS se registra en sus Grupos LPS. */
export function esContenedor(p) { return !!p && store.proyectos.some(x => x.padre_id === p.id); }
/** ¿La actividad / restricción / registro del proyecto «id» entra en el proyecto elegido en el menú?
 *  Elegir un proyecto incluye sus Grupos LPS. */
export function enProyectoSel(id) {
  const sel = store.proyectoSel;
  if (sel) {
    // proyecto_id nulo: la actividad no tiene proyecto asignado → visible en proyectos contenedor
    if (!id) return esContenedor(proyecto(sel));
    return id === sel || proyecto(id)?.padre_id === sel;
  }
  if (!store.nivelSel) return true;
  // Agregación de abajo hacia arriba: Grupo LPS → proyecto → programa → portafolio → empresa
  const p = id && proyecto(id);
  if (!p) return false;
  const [t, clave] = store.nivelSel.split(':');
  const campo = t === 'f' ? 'portafolio_id' : 'programa_id';
  const padre = p.padre_id && proyecto(p.padre_id);
  return p[campo] === clave || (!!padre && padre[campo] === clave);
}
/** ¿Hay un proyecto, programa o portafolio elegido? (sin elección: toda la empresa) */
export function haySeleccion() { return !!(store.proyectoSel || store.nivelSel); }
/** Nombre de lo elegido en el árbol, para filtros, encabezados y PDF. */
export function nombreSeleccion() {
  if (store.proyectoSel) return proyecto(store.proyectoSel)?.nombre_corto || '';
  if (!store.nivelSel) return '';
  const [t, clave] = store.nivelSel.split(':');
  const x = (t === 'f' ? store.portafolios : store.programas).find(z => z.id === clave);
  return x ? `${t === 'f' ? 'Portafolio' : 'Programa'} ${x.nombre}` : '';
}
const nombreConPadre = p => { const padre = p.padre_id && proyecto(p.padre_id); return padre ? `${padre.nombre_corto} › ${p.nombre_corto}` : p.nombre_corto; };
export function opcionesProyectos({ contenedores = false } = {}) {
  // Solo proyectos sin Grupos LPS y Grupos LPS: es donde se registra el LPS.
  // contenedores: también los proyectos con Grupos LPS (p. ej. para asociarles CET / Servicios que heredan sus Grupos LPS)
  return [{ value: null, label: '—' }, ...proyectosActivos().filter(p => contenedores || !esContenedor(p)).map(p => ({
    value: p.id, label: `${p.codigo} · ${nombreConPadre(p)}${p.estado === 'propuesto' ? ' (por aprobar)' : ''}` }))];
}
export function misProyectos() {
  // Proyectos donde la persona es líder y los que ella misma agregó (pedido 100).
  // Los usuarios se registran en la empresa y los niveles de abajo los heredan (pedido a8): el líder de un proyecto
  // lo es también de sus Grupos LPS.
  const yo = store.usuario?.id;
  const ids = new Set(store.proyectoLideres.filter(l => l.usuario_id === yo).map(l => l.proyecto_id));
  return store.proyectos.filter(p => ids.has(p.id) || ids.has(p.padre_id) || (p.created_by && p.created_by === yo));
}
/** Líderes de un proyecto: los propios o, en un Grupo LPS sin líderes propios, los heredados de su proyecto. */
export function lideresHeredados(id) {
  const propios = store.proyectoLideres.filter(l => l.proyecto_id === id).map(l => l.usuario_id);
  const p = proyecto(id);
  return propios.length || !p?.padre_id ? propios : store.proyectoLideres.filter(l => l.proyecto_id === p.padre_id).map(l => l.usuario_id);
}
export function seleccionarProyecto(id) {
  store.proyectoSel = id || '';
  store.nivelSel = '';
  localStorage.setItem('lpsgt-proyecto', store.proyectoSel);
  localStorage.removeItem('lpsgt-nivel');
  emit('proyecto', store.proyectoSel);
}
/** Elige un portafolio ('f:<id>') o programa ('g:<id>'): los módulos suman todo lo que tiene debajo. */
export function seleccionarNivel(clave) {
  store.proyectoSel = '';
  store.nivelSel = clave || '';
  localStorage.setItem('lpsgt-proyecto', '');
  if (store.nivelSel) localStorage.setItem('lpsgt-nivel', store.nivelSel); else localStorage.removeItem('lpsgt-nivel');
  emit('proyecto', '');
}
