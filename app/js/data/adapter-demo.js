// Adaptador de demostración: misma interfaz que el API (adapter-api.js), datos ficticios en localStorage.
// Replica las reglas de negocio de la base de datos (cierre de semana, bloqueo, valores protegidos,
// notificaciones) para que el aplicativo se comporte igual. No aplica seguridad real.
import { LISTAS_INICIALES } from './catalogos.js';
import { uuid, lunes, hoy } from '../core/util.js';
import { crearDatosDemo } from './demo-seed.js';

const CLAVE = 'gyc-demo-db';
const CLAVE_SESION = 'gyc-demo-usuario';

const DEFECTOS = {
  actividades: { resp2: null, hh_lu: 0, hh_ma: 0, hh_mi: 0, hh_ju: 0, hh_vi: 0, hh_sa: 0, hh_do: 0, hh_real: null,
    tipo: 'programada', comprometida: false, estado_la: 'pendiente', estado: 'programado', cnc_id: null, comentario: null,
    origen: 'manual', origen_id: null, cartera_id: null, semana_original: null, orden: 0, extra: {}, descripcion: '' },
  proyectos: { estado: 'activo', extra: {} },
  cartera: { estado: 'abierta', origen: 'interna', extra: {}, f_solicitud: null },
  restricciones: { estado: 'pendiente', extra: {} },
  cierres: { cerrada: true, automatico: false },
  lista_valores: { activo: true, protegido: false, orden: 0, extra: {} },
  profiles: { rol: 'pendiente', activo: true, gerencia_ids: [], es_admin_principal: false, tour_visto: false },
  notificaciones: { leida: false },
  solicitudes_cambio: { estado: 'recibida', prioridad: 'media' },
  acuerdos: { estado: 'pendiente' },
  hitos: { estado: 'pendiente' },
  columnas_personalizadas: { activa: true, orden: 0 },
  plantillas: { activa: true },
  reuniones: { asistentes: [] },
  comentarios: { menciones: [] },
};

const SIN_ID = new Set(['proyecto_lideres', 'proyecto_favoritos']);

function cargar() {
  try {
    const s = localStorage.getItem(CLAVE);
    if (s) {
      const db = JSON.parse(s);
      // Datos de demo creados antes de la versión con Super administrador (equivale a la migración 009)
      for (const p of db.profiles || []) if (p.es_admin_principal && p.rol === 'admin') p.rol = 'superadmin';
      // "Servicios / Entregables" pasó a llamarse "CET / Servicio" (migración 010)
      for (const l of db.listas || []) if (l.clave === 'servicios' && l.nombre === 'Servicios / Entregables') l.nombre = 'CET / Servicio';
      // Proyectos pegados sin estado (antes una celda vacía lo borraba): quedan activos
      for (const p of db.proyectos || []) if (!p.estado) p.estado = 'activo';
      // Lista "Cargos" (migración 013) en datos de demo creados antes
      if (db.listas && !db.listas.some(l => l.clave === 'cargos')) {
        const def = LISTAS_INICIALES.find(l => l[0] === 'cargos');
        const ahora = new Date().toISOString(), lid = crypto.randomUUID();
        db.listas.push({ id: lid, area_id: db.listas[0]?.area_id, clave: 'cargos', nombre: def[1], sistema: true, created_at: ahora, updated_at: ahora });
        def[2].forEach(([codigo, valor], i) => db.lista_valores.push({ id: crypto.randomUUID(), lista_id: lid, codigo, valor, orden: (i + 1) * 10,
          color: null, activo: true, protegido: false, extra: {}, created_at: ahora, updated_at: ahora }));
        localStorage.setItem(CLAVE, JSON.stringify(db));
      }
      return db;
    }
  } catch { /* datos corruptos: se regeneran */ }
  const db = crearDatosDemo();
  localStorage.setItem(CLAVE, JSON.stringify(db));
  return db;
}

function cumple(fila, f = {}) {
  for (const [k, v] of Object.entries(f.eq || {})) if (fila[k] !== v) return false;
  for (const [k, v] of Object.entries(f.neq || {})) if (fila[k] === v) return false;
  for (const [k, v] of Object.entries(f.in || {})) if (!v.includes(fila[k])) return false;
  for (const [k, v] of Object.entries(f.gte || {})) if (!(fila[k] >= v)) return false;
  for (const [k, v] of Object.entries(f.lte || {})) if (!(fila[k] <= v)) return false;
  for (const [k, v] of Object.entries(f.is || {})) if ((fila[k] ?? null) !== v) return false;
  return true;
}

const clon = x => JSON.parse(JSON.stringify(x));
const HH = ['hh_lu', 'hh_ma', 'hh_mi', 'hh_ju', 'hh_vi', 'hh_sa', 'hh_do'];

export function crearAdaptadorDemo() {
  let db = cargar();
  const oyentes = new Set();
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('gyc-demo') : null;

  function guardar() { localStorage.setItem(CLAVE, JSON.stringify(db)); }
  function tabla(t) { return (db[t] ||= []); }
  function usuarioId() { return localStorage.getItem(CLAVE_SESION); }
  function perfil(id = usuarioId()) { return tabla('profiles').find(p => p.id === id); }

  // Emula public.eliminar_usuario(): borra si no tiene historial; si tiene, conserva el perfil como eliminado
  const esSuper = p => p?.rol === 'superadmin' || !!p?.es_admin_principal;
  const GESTORES = ['superadmin', 'admin', 'delegado'];
  const SIN_HISTORIAL = new Set(['profiles', 'notificaciones', 'proyecto_favoritos', 'vistas', 'proyecto_lideres', 'auditoria']);
  // Emula las acciones de empresas de "admin-usuarios" (administrador de la plataforma, pedido 113)
  async function empresasDemo(accion, d, yo) {
    if (!yo.es_plataforma) throw new Error('Solo el administrador de la plataforma gestiona empresas.');
    const ahora = new Date().toISOString();
    if (accion === 'empresas') {
      return { empresas: tabla('areas').map(a => {
        const ps = tabla('profiles').filter(p => p.area_id === a.id && !p.eliminado);
        const pr = ps.find(p => p.es_admin_principal && !p.es_plataforma) || ps.find(p => p.es_admin_principal);
        return { ...clon(a), codigo: String(a.id).slice(0, 8), activa: a.activa !== false, usuarios: ps.filter(p => p.activo && p.rol !== 'pendiente').length,
          proyectos: tabla('proyectos').filter(p => p.area_id === a.id).length, administrador: pr ? `${pr.nombre} (${pr.email})` : '', mia: a.id === yo.area_id };
      }) };
    }
    if (accion === 'estado_empresa') {
      if (d.area_id === yo.area_id && d.activa === false) throw new Error('No puede desactivar su propia empresa.');
      const a = tabla('areas').find(x => x.id === d.area_id);
      if (a) { a.activa = !!d.activa; guardar(); }
      return { ok: true };
    }
    const nombreEmpresa = String(d.nombre_empresa || '').trim();
    if (!nombreEmpresa) throw new Error('Indique el nombre de la empresa.');
    if (tabla('areas').some(a => a.nombre.toLowerCase() === nombreEmpresa.toLowerCase())) throw new Error('Ya existe una empresa con ese nombre.');
    const area = { id: crypto.randomUUID(), nombre: nombreEmpresa, descripcion: d.descripcion || null, activa: true, created_at: ahora, updated_at: ahora };
    tabla('areas').push(area);
    for (const l of d.semilla?.listas || []) {
      const lid = crypto.randomUUID();
      tabla('listas').push({ id: lid, area_id: area.id, clave: l.clave, nombre: l.nombre, grupo: l.grupo || null, sistema: true, created_at: ahora, updated_at: ahora });
      (l.valores || []).forEach((v, i) => tabla('lista_valores').push({ id: crypto.randomUUID(), lista_id: lid, codigo: v.codigo ?? null, valor: v.valor,
        orden: (i + 1) * 10, color: v.color ?? null, activo: true, protegido: !!v.protegido, extra: v.extra || {}, created_at: ahora, updated_at: ahora }));
    }
    for (const [clave, valor] of Object.entries(d.semilla?.parametros || {})) tabla('parametros').push({ id: crypto.randomUUID(), area_id: area.id, clave, valor, updated_at: ahora });
    for (const x of d.semilla?.permisos || []) tabla('permisos').push({ id: crypto.randomUUID(), area_id: area.id, rol: x.rol, accion: x.accion, permitido: !!x.permitido });
    guardar();
    return { area_id: area.id };
  }
  // Emula las acciones de la consola de plataforma de "admin-usuarios"
  const CAMPOS_EST = {
    portafolios: ['codigo', 'nombre', 'descripcion', 'responsable_id', 'estado'],
    programas: ['codigo', 'nombre', 'descripcion', 'responsable_id', 'estado', 'portafolio_id'],
    proyectos: ['codigo', 'nombre_corto', 'nombre_completo', 'estado', 'portafolio_id', 'programa_id', 'padre_id', 'gerencia_id', 'fase_id', 'pais_id', 'fecha_inicio', 'fecha_fin', 'observaciones'],
  };
  async function plataformaDemo(accion, d, yo) {
    const ahora = new Date().toISOString();
    const area = String(d.area_id || '');
    const existe = id => tabla('areas').some(a => a.id === id);
    if (accion === 'plataforma') {
      return clon({ areas: tabla('areas').map(a => ({ ...a, activa: a.activa !== false })), perfiles: tabla('profiles').filter(p => !p.eliminado),
        portafolios: tabla('portafolios'), programas: tabla('programas'), proyectos: tabla('proyectos'), lideres: tabla('proyecto_lideres'),
        miembros: tabla('empresa_miembros'), mi_area: yo.area_id });
    }
    if (accion === 'editar_empresa') {
      const nombre = String(d.nombre || '').trim();
      if (!nombre) throw new Error('Indique el nombre de la empresa.');
      if (tabla('areas').some(a => a.id !== area && a.nombre.toLowerCase() === nombre.toLowerCase())) throw new Error('Ya existe una empresa con ese nombre.');
      Object.assign(tabla('areas').find(a => a.id === area) || {}, { nombre, descripcion: d.descripcion || null, updated_at: ahora });
      guardar(); return { ok: true };
    }
    if (accion === 'eliminar_empresa') {
      // Emula public.eliminar_empresa (025): cualquier empresa, con todos sus datos
      if (area === yo.area_id) throw new Error('No puede eliminar la empresa en la que está trabajando. Abra otra empresa primero.');
      if (tabla('profiles').some(p => p.area_id === area && p.es_plataforma)) throw new Error('Un propietario de la plataforma está trabajando en esa empresa. Que abra otra empresa primero.');
      const proys = new Set(tabla('proyectos').filter(p => p.area_id === area).map(p => p.id));
      for (const p of tabla('profiles').filter(x => x.area_id === area)) {
        const otra = tabla('empresa_miembros').find(m => m.usuario_id === p.id && m.area_id !== area && m.activo !== false);
        if (otra) Object.assign(p, { area_id: otra.area_id, rol: otra.rol, activo: otra.activo, es_admin_principal: otra.es_admin_principal });
      }
      db.empresa_miembros = tabla('empresa_miembros').filter(m => m.area_id !== area);
      const usuarios = new Set(tabla('profiles').filter(p => p.area_id === area).map(p => p.id));
      const listas = new Set(tabla('listas').filter(l => l.area_id === area).map(l => l.id));
      const plantillas = new Set(tabla('plantillas').filter(x => x.area_id === area).map(x => x.id));
      db.lista_valores = tabla('lista_valores').filter(v => !listas.has(v.lista_id));
      db.plantilla_items = tabla('plantilla_items').filter(x => !plantillas.has(x.plantilla_id) && !proys.has(x.proyecto_id));
      db.proyecto_lideres = tabla('proyecto_lideres').filter(x => !proys.has(x.proyecto_id));
      db.proyecto_favoritos = tabla('proyecto_favoritos').filter(x => !proys.has(x.proyecto_id) && !usuarios.has(x.usuario_id));
      db.notificaciones = tabla('notificaciones').filter(x => !usuarios.has(x.usuario_id));
      for (const t of Object.keys(db)) if (Array.isArray(db[t]) && t !== 'areas') db[t] = db[t].filter(x => x?.area_id !== area);
      db.areas = tabla('areas').filter(a => a.id !== area);
      guardar(); return { ok: true };
    }
    if (accion === 'usar_empresa') {
      if (!existe(area)) throw new Error('Empresa no encontrada.');
      perfil(yo.id).area_id = area; guardar(); return { ok: true };
    }
    if (accion === 'cambiar_principal') {
      const nuevo = perfil(String(d.usuario_id || ''));
      const miembro = tabla('empresa_miembros').find(m => m.usuario_id === nuevo?.id && m.area_id === area);
      if (!nuevo || (nuevo.area_id !== area && !miembro)) throw new Error('El usuario no pertenece a esa empresa.');
      tabla('profiles').filter(p => p.area_id === area && !p.es_plataforma && p.id !== nuevo.id).forEach(p => { p.es_admin_principal = false; });
      tabla('empresa_miembros').filter(m => m.area_id === area && m.usuario_id !== nuevo.id).forEach(m => { m.es_admin_principal = false; });
      if (nuevo.area_id === area) Object.assign(nuevo, { es_admin_principal: true, rol: 'superadmin', activo: true });
      else Object.assign(miembro, { es_admin_principal: true, rol: 'superadmin', activo: true });
      guardar(); return { ok: true };
    }
    if (accion === 'estructura') {
      const t = String(d.tabla || '');
      if (!CAMPOS_EST[t]) throw new Error('Tabla no válida.');
      if (d.op === 'eliminar') {
        if (t === 'proyectos' && d.completo) {
          // Emula public.eliminar_proyecto_plataforma (026): con historial y Grupos LPS
          const ids = new Set([d.id, ...tabla('proyectos').filter(r => r.padre_id === d.id).map(r => r.id)]);
          const acts = new Set(tabla('actividades').filter(a => ids.has(a.proyecto_id)).map(a => a.id));
          db.restricciones = tabla('restricciones').filter(r => !ids.has(r.proyecto_id) && !acts.has(r.actividad_id));
          db.actividades = tabla('actividades').filter(a => !acts.has(a.id));
          db.cartera = tabla('cartera').filter(c => !ids.has(c.proyecto_id));
          for (const tt of ['proyecto_lideres', 'proyecto_favoritos', 'plantilla_items', 'hitos']) db[tt] = tabla(tt).filter(r => !ids.has(r.proyecto_id));
          db.proyectos = tabla('proyectos').filter(r => !ids.has(r.id));
          guardar(); return { ok: true };
        }
        if (t === 'proyectos') {
          const hijos = tabla('proyectos').filter(x => x.padre_id === d.id).length;
          if (hijos) throw new Error(`El proyecto tiene ${hijos} Grupo(s) LPS: elimínelos o muévalos primero.`);
          const n = tabla('actividades').filter(a => a.proyecto_id === d.id).length;
          if (n) throw new Error(`El proyecto tiene ${n} actividades: ciérrelo en lugar de eliminarlo para conservar su historial.`);
          db.proyecto_lideres = tabla('proyecto_lideres').filter(l => l.proyecto_id !== d.id);
        }
        if (t === 'portafolios') { tabla('programas').forEach(g => { if (g.portafolio_id === d.id) g.portafolio_id = null; }); tabla('proyectos').forEach(p => { if (p.portafolio_id === d.id) p.portafolio_id = null; }); }
        if (t === 'programas') tabla('proyectos').forEach(p => { if (p.programa_id === d.id) p.programa_id = null; });
        db[t] = tabla(t).filter(x => x.id !== d.id);
        guardar(); return { ok: true };
      }
      const datos = {};
      for (const k of CAMPOS_EST[t]) if (k in (d.datos || {})) datos[k] = d.datos[k] === '' ? null : d.datos[k];
      if (t === 'proyectos' && datos.programa_id) { const g = tabla('programas').find(x => x.id === datos.programa_id); if (g?.portafolio_id) datos.portafolio_id = g.portafolio_id; }
      // Emula public.tg_subproyecto: un Grupo LPS hereda portafolio y programa; solo dos niveles
      if (t === 'proyectos' && datos.padre_id) {
        const padre = tabla('proyectos').find(x => x.id === datos.padre_id);
        if (!padre) throw new Error('El proyecto padre no pertenece a esta empresa.');
        if (padre.padre_id) throw new Error('Un Grupo LPS no puede tener Grupos LPS.');
        datos.portafolio_id = padre.portafolio_id ?? null; datos.programa_id = padre.programa_id ?? null;
      }
      if (d.id && t === 'proyectos' && area) {
        // Emula el traslado de un proyecto (y sus Grupos LPS) a otra empresa
        const actual = tabla('proyectos').find(r => r.id === d.id);
        if (actual && actual.area_id !== area) {
          if (actual.padre_id) throw new Error('Un Grupo LPS se mueve junto con su proyecto: mueva el proyecto.');
          const subs = tabla('proyectos').filter(r => r.padre_id === actual.id);
          const ids = new Set([actual.id, ...subs.map(r => r.id)]);
          for (const [tt, texto] of [['actividades', 'actividades'], ['restricciones', 'restricciones'], ['cartera', 'registros de cartera']]) {
            const n = tabla(tt).filter(r => ids.has(r.proyecto_id)).length;
            if (n) throw new Error(`No se puede mover: el proyecto${subs.length ? ' o sus Grupos LPS' : ''} ya tiene ${n} ${texto} en esta empresa. Mantenga su historial aquí o cree el proyecto en la otra empresa.`);
          }
          const rep = tabla('proyectos').filter(r => r.area_id === area && [actual, ...subs].some(x => x.codigo === r.codigo));
          if (rep.length) throw new Error(`En la empresa de destino ya existe el código ${rep.map(r => r.codigo).join(', ')}. Cámbielo antes de mover.`);
          db.proyecto_lideres = tabla('proyecto_lideres').filter(r => !ids.has(r.proyecto_id));
          db.proyecto_favoritos = tabla('proyecto_favoritos').filter(r => !ids.has(r.proyecto_id));
          const limpio = { area_id: area, gerencia_id: null, cet_id: null, fase_id: null, pais_id: null, tipo_id: null, updated_at: ahora };
          Object.assign(actual, datos, limpio);
          subs.forEach(r => Object.assign(r, limpio, { portafolio_id: actual.portafolio_id ?? null, programa_id: actual.programa_id ?? null }));
          guardar(); return { registro: clon(actual) };
        }
      }
      if (d.id) { const x = tabla(t).find(r => r.id === d.id); Object.assign(x, datos, { updated_at: ahora }); guardar(); return { registro: clon(x) }; }
      if (!existe(area)) throw new Error('Empresa no encontrada.');
      if (t === 'proyectos') {
        if (!datos.codigo || !datos.nombre_corto) throw new Error('Indique el código y el nombre del proyecto.');
        if (tabla('proyectos').some(p => p.area_id === area && p.codigo === datos.codigo)) throw new Error('Ya existe un proyecto con ese código en la empresa.');
        datos.estado ??= 'activo'; datos.created_by = yo.id; datos.extra = {};
      } else { if (!datos.nombre) throw new Error('Indique el nombre.'); datos.estado ??= 'activo'; }
      const x = { id: crypto.randomUUID(), area_id: area, ...datos, created_at: ahora, updated_at: ahora };
      tabla(t).push(x); guardar(); return { registro: clon(x) };
    }
    if (accion === 'lideres') {
      const p = tabla('proyectos').find(x => x.id === d.proyecto_id);
      if (!p) throw new Error('Proyecto no encontrado.');
      db.proyecto_lideres = tabla('proyecto_lideres').filter(l => l.proyecto_id !== p.id);
      for (const u of d.usuario_ids || []) if (perfil(u)?.area_id === p.area_id) db.proyecto_lideres.push({ id: crypto.randomUUID(), proyecto_id: p.id, usuario_id: u });
      guardar(); return { ok: true };
    }
    if (accion === 'propietario') {
      if (!d.es) {
        if (d.usuario_id === yo.id) throw new Error('No puede quitarse a sí mismo. Otro propietario debe hacerlo.');
        if (tabla('profiles').filter(p => p.es_plataforma).length <= 1) throw new Error('Debe quedar al menos un propietario de la plataforma.');
      }
      perfil(d.usuario_id).es_plataforma = !!d.es; guardar(); return { ok: true };
    }
    if (accion === 'usuario_plataforma') {
      const u = perfil(String(d.usuario_id || ''));
      if (!u) throw new Error('Usuario no encontrado.');
      if (area && u.area_id !== area) {
        const m = tabla('empresa_miembros').find(x => x.usuario_id === u.id && x.area_id === area);
        if (!m) throw new Error('El usuario no pertenece a esa empresa.');
        if (d.quitar) {
          if (m.es_admin_principal) throw new Error('Es el super administrador principal de esa empresa: designe antes a otro.');
          db.empresa_miembros = tabla('empresa_miembros').filter(x => x !== m); guardar(); return { ok: true };
        }
        if (d.rol !== undefined) m.rol = d.rol;
        if (d.activo !== undefined) m.activo = !!d.activo;
        guardar(); return { ok: true };
      }
      if (d.quitar) {
        const otra = tabla('empresa_miembros').find(x => x.usuario_id === u.id && x.area_id !== u.area_id && x.activo !== false);
        if (!otra) throw new Error('Esta es la única empresa de la persona: para quitarla use «Eliminar usuario» en la configuración de la empresa.');
        if (u.es_admin_principal) throw new Error('Es el super administrador principal de esa empresa: designe antes a otro.');
        const viejo = u.area_id;
        Object.assign(u, { area_id: otra.area_id, rol: otra.rol, activo: otra.activo, es_admin_principal: otra.es_admin_principal });
        db.empresa_miembros = tabla('empresa_miembros').filter(x => !(x.usuario_id === u.id && x.area_id === viejo));
        guardar(); return { ok: true };
      }
      if (d.rol !== undefined) {
        if (u.es_admin_principal && d.rol !== 'superadmin') throw new Error('El administrador principal de una empresa es super administrador. Cambie antes el principal.');
        u.rol = d.rol;
      }
      if (d.activo !== undefined) { if (u.id === yo.id && !d.activo) throw new Error('No puede desactivarse a sí mismo.'); u.activo = !!d.activo; }
      guardar(); return { ok: true };
    }
    if (accion === 'historial_proyecto') {
      const ids = new Set([d.id, ...tabla('proyectos').filter(r => r.padre_id === d.id).map(r => r.id)]);
      const n = t => tabla(t).filter(r => ids.has(r.proyecto_id)).length;
      return { subproyectos: ids.size - 1, actividades: n('actividades'), restricciones: n('restricciones'), cartera: n('cartera') };
    }
    if (accion === 'auditoria_plataforma') {
      return { registros: clon(tabla('auditoria').filter(r => !area || r.area_id === area).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 300)) };
    }
    return empresasDemo(accion, d, yo);
  }
  async function eliminarUsuarioDemo(id) {
    db = cargar();
    const yo = perfil();
    const obj = perfil(id);
    if (!yo || !['superadmin', 'admin'].includes(yo.rol)) throw new Error('Solo el administrador puede eliminar usuarios.');
    if (!obj) throw new Error('Usuario no encontrado.');
    if (obj.id === yo.id) throw new Error('No puede eliminarse a sí mismo.');
    if (obj.es_admin_principal) throw new Error('El administrador principal no se puede eliminar.');
    if (['superadmin', 'admin'].includes(obj.rol) && !esSuper(yo)) throw new Error('Solo el super administrador elimina a un administrador.');
    const conHistorial = Object.entries(db).some(([t, filas]) => !SIN_HISTORIAL.has(t) && Array.isArray(filas) &&
      filas.some(f => f && typeof f === 'object' && Object.entries(f).some(([k, v]) => k !== 'id' && v === id)));
    if (!conHistorial) {
      for (const t of ['notificaciones', 'proyecto_favoritos', 'vistas', 'proyecto_lideres']) db[t] = tabla(t).filter(f => f.usuario_id !== id);
      guardar();
      await api.remove('profiles', id);
      return 'eliminado';
    }
    db.proyecto_lideres = tabla('proyecto_lideres').filter(f => f.usuario_id !== id);
    guardar();
    await api.update('profiles', id, { eliminado: true, activo: false, email: null, rol: GESTORES.includes(obj.rol) ? 'lider' : obj.rol });
    return 'desactivado';
  }

  function emitir(ev, local = true) {
    if (local) for (const cb of oyentes) cb(clon(ev));
    canal?.postMessage(ev);
  }
  canal?.addEventListener('message', e => {
    db = cargar();
    for (const cb of oyentes) cb(e.data);
  });
  window.addEventListener('storage', e => { if (e.key === CLAVE) db = cargar(); });

  function semanaCerrada(resp, semana) {
    return tabla('cierres').some(c => c.responsable_id === resp && c.semana === semana && c.cerrada);
  }

  function notificar(usuarios, tipo, texto, ruta) {
    for (const u of usuarios) {
      if (!u || u === usuarioId()) continue;
      const n = { id: uuid(), usuario_id: u, tipo, texto, ruta, leida: false, created_at: new Date().toISOString() };
      tabla('notificaciones').push(n);
      emitir({ tabla: 'notificaciones', tipo: 'INSERT', fila: n });
    }
  }
  const gestores = area => tabla('profiles').filter(p => p.area_id === area && GESTORES.includes(p.rol) && p.activo).map(p => p.id);

  function auditar(t, accion, fila, cambios) {
    if (!['actividades', 'restricciones', 'proyectos', 'cartera', 'cierres', 'profiles', 'permisos', 'parametros', 'lista_valores', 'acuerdos'].includes(t)) return;
    const a = tabla('auditoria');
    a.push({ id: a.length + 1, area_id: fila.area_id, tabla: t, registro_id: fila.id, accion, usuario_id: usuarioId(), cambios, created_at: new Date().toISOString() });
    if (a.length > 3000) a.splice(0, a.length - 3000);
  }

  // Reglas equivalentes a los triggers de la base de datos
  function antes(t, op, nueva, vieja) {
    if (t === 'actividades') {
      if (nueva) {
        if (new Date(nueva.semana + 'T12:00').getDay() !== 1) throw new Error('La semana debe empezar en lunes.');
        nueva.hh_total = HH.reduce((s, k) => s + (Number(nueva[k]) || 0), 0);
      }
      for (const f of [vieja, nueva]) {
        if (f && semanaCerrada(f.responsable_id, f.semana)) {
          throw new Error(`La semana del ${f.semana.split('-').reverse().join('/')} está cerrada. Solo un administrador puede reabrirla.`);
        }
      }
    }
    if (t === 'cierres' && nueva) {
      if (op === 'UPDATE' && vieja.cerrada && !nueva.cerrada) {
        const yo = perfil();
        if (!GESTORES.includes(yo?.rol)) throw new Error('Solo el administrador o el delegado pueden reabrir una semana.');
        nueva.reabierto_at = new Date().toISOString();
        nueva.reabierto_por = usuarioId();
      } else if (nueva.cerrada && !nueva.automatico) {
        const acts = tabla('actividades').filter(a => a.responsable_id === nueva.responsable_id && a.semana === nueva.semana && a.comprometida);
        const sinEstado = acts.filter(a => a.estado === 'programado').length;
        const sinCnc = acts.filter(a => a.estado === 'no_completado' && !a.cnc_id).length;
        if (sinEstado) throw new Error(`Hay ${sinEstado} compromiso(s) sin estado final (Completado / No completado / Cancelado).`);
        if (sinCnc) throw new Error(`Hay ${sinCnc} compromiso(s) no completado(s) sin causa de no cumplimiento (CNC).`);
      }
    }
    if (t === 'lista_valores' && vieja?.protegido) {
      if (op === 'DELETE') throw new Error(`El valor "${vieja.valor}" está protegido: puede renombrarse, pero no eliminarse.`);
      if (nueva.codigo !== vieja.codigo || !nueva.activo) throw new Error(`El valor "${vieja.valor}" está protegido: solo puede cambiar su texto, orden o color.`);
    }
    if (t === 'profiles' && op === 'UPDATE') {
      const yo = perfil();
      if (nueva.es_admin_principal !== vieja.es_admin_principal) throw new Error('El administrador principal solo se cambia desde la base de datos.');
      if (vieja.es_admin_principal && (nueva.rol !== vieja.rol || !nueva.activo)) {
        throw new Error('El administrador principal no puede perder su rol ni desactivarse.');
      }
      if (nueva.rol !== vieja.rol && (GESTORES.includes(nueva.rol) || GESTORES.includes(vieja.rol)) && !esSuper(yo)) {
        throw new Error('Solo el super administrador asigna o retira los roles de super administrador, administrador y delegado.');
      }
      if (nueva.rol === 'delegado' && vieja.rol !== 'delegado') {
        tabla('delegado_historial').push({ id: uuid(), area_id: nueva.area_id, usuario_id: nueva.id, otorgado_por: usuarioId(), desde: new Date().toISOString(), hasta: null });
      } else if (vieja.rol === 'delegado' && nueva.rol !== 'delegado') {
        for (const h of tabla('delegado_historial')) if (h.usuario_id === nueva.id && !h.hasta) h.hasta = new Date().toISOString();
      }
    }
  }

  function despues(t, op, fila, vieja) {
    if (t === 'comentarios' && op === 'INSERT') {
      const autor = perfil(fila.autor_id)?.nombre || 'Alguien';
      notificar(fila.menciones || [], 'mencion', `${autor} te mencionó: ${fila.texto.slice(0, 140)}`, `#/${fila.entidad}/${fila.entidad_id}`);
    }
    if (t === 'proyectos') {
      if (op === 'INSERT' && fila.estado === 'propuesto') {
        notificar(gestores(fila.area_id), 'proyecto_propuesto', `Proyecto propuesto por aprobar: ${fila.codigo} ${fila.nombre_corto}`, `#/proyectos/${fila.id}`);
      } else if (op === 'UPDATE' && vieja.estado === 'propuesto' && ['activo', 'rechazado'].includes(fila.estado) && fila.propuesto_por) {
        notificar([fila.propuesto_por], 'proyecto_' + fila.estado,
          `Tu proyecto ${fila.nombre_corto} ${fila.estado === 'activo' ? 'fue aprobado.' : 'fue rechazado: ' + (fila.motivo_rechazo || '')}`, `#/proyectos/${fila.id}`);
      }
    }
    if (t === 'cartera' && fila.origen === 'solicitud') {
      if (op === 'INSERT') {
        notificar(gestores(fila.area_id), 'solicitud_nueva', `Nueva solicitud de servicio: ${fila.descripcion.slice(0, 120)}`, `#/cartera/${fila.id}`);
        if (fila.responsable_id) notificar([fila.responsable_id], 'solicitud_nueva', `Solicitud de servicio dirigida a ti: ${fila.descripcion.slice(0, 120)}`, `#/cartera/${fila.id}`);
      } else if (op === 'UPDATE' && vieja.estado === 'nueva' && fila.estado !== 'nueva' && fila.solicitante_id) {
        notificar([fila.solicitante_id], 'solicitud_' + fila.estado,
          `Tu solicitud "${fila.descripcion.slice(0, 80)}" fue ${fila.estado === 'rechazada' ? 'rechazada: ' + (fila.motivo_rechazo || '') : 'aceptada.'}`, `#/cartera/${fila.id}`);
      }
    }
  }

  function completar(t, f) {
    const yo = perfil();
    const ahora = new Date().toISOString();
    const fila = { ...clon(DEFECTOS[t] || {}), ...f };
    if (!SIN_ID.has(t) && !fila.id) fila.id = uuid();
    if (!fila.created_at) fila.created_at = ahora;
    fila.updated_at = ahora;
    if ('created_by' in fila || ['actividades', 'proyectos', 'cartera', 'restricciones', 'reuniones', 'acuerdos'].includes(t)) fila.created_by ??= yo?.id ?? null;
    if (t === 'cierres') { fila.cerrado_at ??= ahora; fila.cerrado_por ??= yo?.id ?? null; }
    if (t === 'cartera') fila.f_solicitud ??= hoy();
    if (t === 'restricciones') fila.f_identificada ??= hoy();
    if (t === 'comentarios') fila.autor_id ??= yo?.id;
    if (t === 'solicitudes_cambio') fila.autor_id ??= yo?.id;
    if (t === 'enlaces') fila.autor_id ??= yo?.id;
    return fila;
  }

  const api = {
    tipo: 'demo',

    async list(t, f = {}) {
      let filas = tabla(t).filter(r => cumple(r, f));
      for (const [col, asc] of [...(f.order || [])].reverse()) {
        filas = [...filas].sort((a, b) => {
          const x = a[col] ?? '', y = b[col] ?? '';
          return (x > y ? 1 : x < y ? -1 : 0) * (asc === false ? -1 : 1);
        });
      }
      if (f.limit) filas = filas.slice(0, f.limit);
      return clon(filas);
    },
    async insert(t, filas) {
      db = cargar();
      const arr = (Array.isArray(filas) ? filas : [filas]).map(f => completar(t, f));
      // Igual que la base: un id repetido se rechaza (lo usa el reintento sin duplicados de la grilla)
      for (const f of arr) if (f.id && tabla(t).some(r => r.id === f.id)) throw new Error(`duplicate key value violates unique constraint "${t}_pkey"`);
      for (const f of arr) antes(t, 'INSERT', f, null);
      tabla(t).push(...arr);
      for (const f of arr) { auditar(t, 'insert', f, f); despues(t, 'INSERT', f, null); }
      guardar();
      for (const f of arr) emitir({ tabla: t, tipo: 'INSERT', fila: f });
      return clon(arr);
    },
    async upsert(t, filas, onConflict) {
      const claves = (onConflict || 'id').split(',');
      const res = [];
      for (const f of Array.isArray(filas) ? filas : [filas]) {
        const ex = tabla(t).find(r => claves.every(k => r[k] === f[k]));
        if (ex && ex.id) res.push(await api.update(t, ex.id, f));
        else if (ex) { Object.assign(ex, f); guardar(); res.push(clon(ex)); }
        else res.push(...await api.insert(t, f));
      }
      return res;
    },
    async update(t, id, cambios) {
      db = cargar();
      const fila = tabla(t).find(r => r.id === id);
      if (!fila) throw new Error('El registro ya no existe.');
      const nueva = { ...clon(fila), ...cambios, updated_at: new Date().toISOString() };
      antes(t, 'UPDATE', nueva, fila);
      const vieja = clon(fila);
      Object.assign(fila, nueva);
      const dif = {};
      for (const k of Object.keys(cambios)) if (JSON.stringify(vieja[k]) !== JSON.stringify(fila[k])) dif[k] = [vieja[k], fila[k]];
      auditar(t, 'update', fila, dif);
      despues(t, 'UPDATE', fila, vieja);
      guardar();
      emitir({ tabla: t, tipo: 'UPDATE', fila: clon(fila), anterior: vieja });
      return clon(fila);
    },
    async updateWhere(t, f, cambios) {
      const res = [];
      for (const r of tabla(t).filter(x => cumple(x, f))) {
        if (r.id) res.push(await api.update(t, r.id, cambios));
        else { Object.assign(r, cambios); res.push(clon(r)); }
      }
      guardar();
      return res;
    },
    async remove(t, id) {
      db = cargar();
      const i = tabla(t).findIndex(r => r.id === id);
      if (i < 0) return;
      const vieja = tabla(t)[i];
      antes(t, 'DELETE', null, vieja);
      tabla(t).splice(i, 1);
      auditar(t, 'delete', vieja, vieja);
      guardar();
      emitir({ tabla: t, tipo: 'DELETE', fila: null, anterior: clon(vieja) });
    },
    async removeWhere(t, f) {
      db = cargar();
      const quitar = tabla(t).filter(x => cumple(x, f));
      for (const v of quitar) antes(t, 'DELETE', null, v);
      db[t] = tabla(t).filter(x => !cumple(x, f));
      guardar();
      for (const v of quitar) emitir({ tabla: t, tipo: 'DELETE', fila: null, anterior: clon(v) });
    },
    async rpc(nombre, args = {}) {
      if (nombre === 'eliminar_usuario') return eliminarUsuarioDemo(args.p_usuario);
      if (nombre === 'registro_abierto') return tabla('areas').filter(a => a.activa !== false).length <= 1;
      if (nombre === 'eliminar_proyecto_completo') {
        // Emula public.eliminar_proyecto_completo(): borra el proyecto con todo su historial
        db = cargar();
        const id = args.p_proyecto;
        const yo = perfil();
        if (!['superadmin', 'admin'].includes(yo?.rol)) throw new Error('Solo un administrador puede eliminar un proyecto con su historial.');
        const acts = new Set(tabla('actividades').filter(a => a.proyecto_id === id).map(a => a.id));
        const rests = new Set(tabla('restricciones').filter(r => r.proyecto_id === id || acts.has(r.actividad_id)).map(r => r.id));
        const cart = new Set(tabla('cartera').filter(c => c.proyecto_id === id).map(c => c.id));
        const r = { actividades: acts.size, restricciones: rests.size, cartera: cart.size };
        const ent = x => (x.entidad === 'actividad' && acts.has(x.entidad_id)) || (x.entidad === 'restriccion' && rests.has(x.entidad_id)) ||
          (x.entidad === 'cartera' && cart.has(x.entidad_id)) || (x.entidad === 'proyecto' && x.entidad_id === id);
        db.comentarios = tabla('comentarios').filter(x => !ent(x));
        db.enlaces = tabla('enlaces').filter(x => !ent(x));
        db.restricciones = tabla('restricciones').filter(x => !rests.has(x.id));
        db.actividades = tabla('actividades').filter(x => !acts.has(x.id));
        db.cartera = tabla('cartera').filter(x => !cart.has(x.id));
        db.plantilla_items = tabla('plantilla_items').filter(x => x.proyecto_id !== id);
        for (const t of ['hitos', 'proyecto_lideres', 'proyecto_favoritos']) db[t] = tabla(t).filter(x => x.proyecto_id !== id);
        for (const v of tabla('lista_valores')) if (v.extra?.proyecto_id === id) delete v.extra.proyecto_id;
        guardar();
        await api.remove('proyectos', id);
        for (const t of ['actividades', 'restricciones', 'cartera']) emitir({ tabla: t, tipo: 'DELETE', fila: null, anterior: { id: null } });
        return r;
      }
      if (nombre === 'exportar_respaldo') return { generado: new Date().toISOString(), version: 1, modo: 'demo', ...clon(db) };
      if (nombre === 'cerrar_semanas_vencidas') return 0;
      throw new Error(`Función no disponible en modo demo: ${nombre}`);
    },
    // Emula la Edge Function "admin-usuarios" (en demo la contraseña no se usa)
    async adminUsuarios(accion, d = {}) {
      db = cargar();
      const yo = perfil();
      // Usuarios de varias empresas (030): mismas acciones que el servidor
      if (accion === 'mis_empresas' || accion === 'cambiar_empresa') {
        if (!yo) throw new Error('No autorizado.');
        const ms = tabla('empresa_miembros').filter(m => m.usuario_id === yo.id && m.activo !== false);
        if (accion === 'mis_empresas') {
          const ids = [...new Set([yo.area_id, ...ms.map(m => m.area_id)])];
          return clon({ actual: yo.area_id, empresas: tabla('areas').filter(a => ids.includes(a.id)).map(a => ({ id: a.id, nombre: a.nombre, activa: a.activa !== false,
            rol: ms.find(m => m.area_id === a.id)?.rol ?? yo.rol })) });
        }
        const m = ms.find(x => x.area_id === d.area_id);
        if (!m) throw new Error('No pertenece a esa empresa.');
        // Antes de cambiar, la empresa que deja queda como membresía con su rol actual
        const actual = tabla('empresa_miembros').find(x => x.usuario_id === yo.id && x.area_id === yo.area_id);
        if (actual) Object.assign(actual, { rol: yo.rol, activo: yo.activo, es_admin_principal: yo.es_admin_principal });
        else tabla('empresa_miembros').push({ usuario_id: yo.id, area_id: yo.area_id, rol: yo.rol, activo: yo.activo, es_admin_principal: !!yo.es_admin_principal });
        Object.assign(yo, { area_id: m.area_id, rol: m.rol, activo: m.activo !== false, es_admin_principal: !!m.es_admin_principal });
        guardar(); return { ok: true };
      }
      // Mejoras del aplicativo de todas las empresas (pedido q7): cualquier usuario activo
      if (accion === 'mejoras' || accion === 'gestionar_mejora') {
        if (!yo?.activo || yo.rol === 'pendiente') throw new Error('No autorizado.');
        if (accion === 'mejoras') {
          const mejoras = [...tabla('solicitudes_cambio')].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
            .map(s => ({ ...s, autor_nombre: tabla('profiles').find(p => p.id === s.autor_id)?.nombre || '', empresa: tabla('areas').find(a => a.id === s.area_id)?.nombre || '' }));
          return { mejoras, gestiona: !!yo.es_plataforma };
        }
        if (!yo.es_plataforma) throw new Error('Solo los propietarios de la plataforma gestionan las mejoras de todas las empresas.');
        const { id, estado, prioridad, respuesta } = d;
        return await api.update('solicitudes_cambio', id, { estado, prioridad, respuesta });
      }
      if (!yo || !GESTORES.includes(yo.rol)) throw new Error('No tiene permiso para gestionar usuarios.');
      if (['empresas', 'crear_empresa', 'estado_empresa'].includes(accion)) return empresasDemo(accion, d, yo);
      if (['plataforma', 'editar_empresa', 'eliminar_empresa', 'usar_empresa', 'cambiar_principal', 'estructura', 'lideres', 'propietario',
        'usuario_plataforma', 'auditoria_plataforma', 'historial_proyecto'].includes(accion)) {
        if (!yo.es_plataforma) throw new Error('Solo el administrador de la plataforma gestiona empresas.');
        return plataformaDemo(accion, d, yo);
      }
      if (String(d.clave || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      if (accion === 'crear') {
        const email = String(d.email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo no válido.');
        const existente = tabla('profiles').find(p => p.email === email);
        if (existente) {
          // Ya tiene cuenta en otra empresa: un propietario la agrega a esta empresa con el rol elegido (030)
          if (!yo.es_plataforma) throw new Error('Ya existe un usuario con ese correo en otra empresa. Pida a un propietario de la plataforma que lo agregue a esta empresa.');
          const destino = d.area_id || yo.area_id;
          if (existente.area_id === destino || tabla('empresa_miembros').some(m => m.usuario_id === existente.id && m.area_id === destino)) throw new Error('Ya existe un usuario con ese correo en esta empresa.');
          if (!tabla('empresa_miembros').some(m => m.usuario_id === existente.id && m.area_id === existente.area_id)) {
            tabla('empresa_miembros').push({ usuario_id: existente.id, area_id: existente.area_id, rol: existente.rol, activo: existente.activo, es_admin_principal: !!existente.es_admin_principal });
          }
          tabla('empresa_miembros').push({ usuario_id: existente.id, area_id: destino, rol: d.rol || 'lider', activo: true, es_admin_principal: false });
          guardar(); return { id: existente.id, agregado: true };
        }
        if (GESTORES.includes(d.rol) && !esSuper(yo)) throw new Error('Solo el super administrador asigna los roles de super administrador, administrador y delegado.');
        const [p] = await api.insert('profiles', { area_id: yo.es_plataforma && d.area_id ? d.area_id : yo.area_id, email, nombre: String(d.nombre || '').trim(), rol: d.rol || 'lider',
          codigo: d.codigo || null, cargo_id: d.cargo_id || null, gerencia_ids: d.gerencia_ids || [], horas_dia: d.horas_dia === '' || d.horas_dia == null ? null : Number(d.horas_dia),
          activo: true, es_admin_principal: false, debe_cambiar_clave: true, tour_visto: false });
        return { id: p.id };
      }
      if (accion === 'clave') {
        const obj = perfil(d.usuario_id);
        if (!obj) throw new Error('Usuario no encontrado.');
        if (obj.id !== yo.id && (obj.es_admin_principal || (GESTORES.includes(obj.rol) && !esSuper(yo)))) throw new Error('No puede restablecer la contraseña de ese usuario.');
        await api.update('profiles', obj.id, { debe_cambiar_clave: obj.id !== yo.id });
        return { ok: true };
      }
      throw new Error('Acción no válida.');
    },
    subscribe(tablas, cb) {
      const f = ev => { if (tablas.includes(ev.tabla)) cb(ev); };
      oyentes.add(f);
      return () => oyentes.delete(f);
    },

    // Herramientas propias del modo demo
    reiniciar() { localStorage.removeItem(CLAVE); db = cargar(); },
    usuariosDemo() { return clon(tabla('profiles')); },

    auth: {
      async usuario() {
        const id = usuarioId();
        const p = id && perfil(id);
        return p ? { id: p.id, email: p.email } : null;
      },
      async ingresar(idOEmail) {
        const p = tabla('profiles').find(x => x.id === idOEmail || x.email === idOEmail);
        if (!p) throw new Error('Usuario de demostración no encontrado.');
        localStorage.setItem(CLAVE_SESION, p.id);
        return { id: p.id, email: p.email };
      },
      async registrar() { throw new Error('En modo demostración elija uno de los usuarios de ejemplo.'); },
      async recuperar() { throw new Error('No disponible en modo demostración.'); },
      async cambiarClave() { const p = perfil(); if (p) await api.update('profiles', p.id, { debe_cambiar_clave: false }); },
      async salir() { localStorage.removeItem(CLAVE_SESION); },
      alCambiar() { /* sin eventos externos en demo */ },
    },
  };
  // Semana de referencia del seed (para reconstruir datos si cambia la semana)
  api.semanaDemo = () => db._semana || lunes();
  // Medición de rendimiento (solo pruebas): simula la demora de red del API y cuenta las llamadas
  const latencia = Number(localStorage.getItem('gyc-latencia')) || 0;
  if (latencia) {
    window.__llamadas = [];
    for (const m of ['list', 'insert', 'upsert', 'update', 'updateWhere', 'remove', 'removeWhere', 'rpc', 'adminUsuarios']) {
      const orig = api[m].bind(api);
      api[m] = async (...a) => { window.__llamadas.push(`${m} ${typeof a[0] === 'string' ? a[0] : ''}`); (window.__linea ||= []).push(`${Math.round(performance.now())} ${m} ${typeof a[0] === 'string' ? a[0] : ''} ${m === 'adminUsuarios' ? a[0] : ''}`); await new Promise(r => setTimeout(r, latencia)); return orig(...a); };
    }
  }
  return api;
}
