// Empresas, usuarios, estructura (Empresa → Portafolio → Programa → Proyecto), propietarios, auditoría y reportes
// de TODAS las empresas. Los datos que cruzan empresas pasan solo por la Edge Function "admin-usuarios":
// en las pantallas normales cada usuario (también el de la plataforma) ve únicamente la empresa en la que trabaja.
import { api, mensajeError } from '../data/api.js';
import { store, cargarCatalogo } from '../core/store.js';
import { ROLES, COLOR_ROL } from '../data/catalogos.js';
import { esc, fmtFechaHora, libExcel } from '../core/util.js';
import { ok, error, confirmar, pedirDatos, modal, badge } from '../ui/ui.js';

// ---------- Datos de la plataforma ----------
// Se guardan en memoria mientras la consola está abierta: cada panel los reutiliza y solo se vuelven a pedir
// al servidor después de un cambio (o pasado un minuto). Antes cada clic los descargaba de nuevo (pedido 19).
let datos = null, cargadosEn = 0, enCurso = null;
export async function cargarPlataforma({ forzar = false } = {}) {
  if (!forzar && datos && Date.now() - cargadosEn < 60000) return datos;
  if (!forzar && enCurso) return enCurso;
  enCurso = api.adminUsuarios('plataforma').then(d => { datos = d; cargadosEn = Date.now(); return d; }).finally(() => { enCurso = null; });
  return enCurso;
}
/** Empresas ya cargadas (para la barra superior), sin volver a pedirlas. */
export function empresasEnMemoria() { return datos?.areas || null; }
const empresa = id => datos.areas.find(a => a.id === id);
// Personas de una empresa: las que la tienen como empresa activa y las que pertenecen por membresía (usuarios de varias
// empresas, migración 030). En estas últimas, rol, estado y «principal» son los de su membresía en esa empresa.
const miembrosDe = id => (datos.miembros || []).filter(m => m.area_id === id);
const usuariosDe = id => {
  const activos = datos.perfiles.filter(p => p.area_id === id).map(p => ({ ...p, _area: id }));
  const otros = miembrosDe(id).filter(m => !activos.some(p => p.id === m.usuario_id)).map(m => {
    const p = datos.perfiles.find(x => x.id === m.usuario_id);
    return p && { ...p, rol: m.rol, activo: m.activo, es_admin_principal: m.es_admin_principal, _area: id, _otra: true };
  }).filter(Boolean);
  return [...activos, ...otros];
};
const perteneceA = (usuarioId, areaId) => usuariosDe(areaId).some(p => p.id === usuarioId);
// ¿Cuántas empresas tiene la persona? (para ofrecer «Quitar de esta empresa»)
const empresasDe = usuarioId => datos.areas.filter(a => perteneceA(usuarioId, a.id));
const principalDe = id => usuariosDe(id).find(p => p.es_admin_principal && !p.es_plataforma) || usuariosDe(id).find(p => p.es_admin_principal);
const proyectosDe = id => datos.proyectos.filter(p => p.area_id === id);
const lideresDe = proyId => datos.lideres.filter(l => l.proyecto_id === proyId).map(l => datos.perfiles.find(p => p.id === l.usuario_id)).filter(Boolean);
// Los niveles de abajo heredan (pedido a8): un Grupo LPS sin líderes propios usa los de su proyecto
const lideresEf = p => lideresDe(p.id).length || !p.padre_id ? lideresDe(p.id) : lideresDe(p.padre_id);
const subDe = p => datos.proyectos.filter(x => x.padre_id === p.id);
const nombreCorto = p => p ? (p.email ? p.email.split('@')[0] : p.nombre) : '';
// Administrador de cada empresa: los propietarios de la plataforma (la crean y la administran por defecto).
// Super administrador: el responsable dentro de la empresa (crea portafolios, programas y proyectos); es opcional.
const propietarios = () => datos.perfiles.filter(p => p.es_plataforma && p.activo);
const superDe = id => { const p = principalDe(id); return p && !p.es_plataforma ? p : null; };
const celdaAdministrador = () => propietarios().map(p => `<b>${esc(p.nombre)}</b><br><small class="nota">${esc(p.email || '')}</small>`).join('<br>') || '—';
const celdaSuper = (a, conBoton = true) => {
  const sa = superDe(a.id);
  return (sa ? `<b>${esc(sa.nombre)}</b><br><small class="nota">${esc(sa.email || '')}</small>` : badge('Sin asignar', '#EDC948')) +
    (conBoton ? ` <button class="btn btn-xs${sa ? '' : ' btn-azul'}" data-principal="${a.id}">${sa ? 'Cambiar' : 'Asignar'}</button>` : '');
};
const codigoEmpresa = a => String(a.id).slice(0, 8);
const activa = a => a.activa !== false;

const COLOR_EST = { activo: '#2e7d32', propuesto: '#e65100', en_pausa: '#795548', cerrado: '#546E7A', rechazado: '#b71c1c' };
const TXT_EST = { activo: 'Activo', propuesto: 'Propuesto', en_pausa: 'En pausa', cerrado: 'Cerrado', rechazado: 'Rechazado' };

function cab(titulo, sub, botones = '') {
  return `<div class="admin-panel-cab"><div><h2>${esc(titulo)}</h2>${sub ? `<p class="admin-sub" style="margin:4px 0 0">${sub}</p>` : ''}</div>
    <div class="barra-acciones">${botones}</div></div>`;
}

// Al cambiar algo de la empresa en la que se trabaja, el resto del aplicativo se actualiza
async function refrescar(areaTocada) {
  await cargarPlataforma({ forzar: true });
  if (!areaTocada || areaTocada === store.area?.id) await cargarCatalogo().catch(() => {});
}

// ════════════════════════════════════════════════════════════════
// RESUMEN DE LA PLATAFORMA
// ════════════════════════════════════════════════════════════════
export async function panelResumenPlataforma(el, ctx) {
  await cargarPlataforma();
  const act = datos.areas.filter(activa).length;
  const vivos = datos.proyectos.filter(p => !['cerrado', 'rechazado'].includes(p.estado));
  const sinAdmin = vivos.filter(p => !lideresEf(p).length).length;
  const usuarios = datos.perfiles.filter(p => p.activo && p.rol !== 'pendiente').length;
  el.innerHTML = cab('Resumen de la plataforma', 'Todas las empresas que usan este aplicativo.', `<button class="btn btn-sm" data-a="imprimir">🖨 Imprimir</button>`) +
    `<div class="admin-kpis">
      ${kpi(act, 'Empresas activas')}${kpi(datos.areas.length - act, 'Suspendidas')}${kpi(usuarios, 'Usuarios activos')}
      ${kpi(datos.portafolios.length, 'Portafolios')}${kpi(datos.programas.length, 'Programas')}${kpi(vivos.length, 'Proyectos vigentes')}
      ${kpi(sinAdmin, 'Proyectos sin administrador', sinAdmin ? 'alerta' : '')}
    </div>
    <div class="tarjeta admin-tabla-wrap"><table class="simple">
      <thead><tr><th>EMPRESA</th><th>ADMINISTRADOR</th><th>SUPER ADMINISTRADOR</th><th class="num">USUARIOS</th><th class="num">PORTAFOLIOS</th><th class="num">PROGRAMAS</th><th class="num">PROYECTOS</th><th>ESTADO</th></tr></thead>
      <tbody>${datos.areas.map(a => `<tr>
        <td><b>${esc(a.nombre)}</b>${a.id === datos.mi_area ? ' ' + badge('En uso ahora', '#1565c0') : ''}</td>
        <td>${celdaAdministrador()}</td><td>${celdaSuper(a, false)}</td>
        <td class="num">${usuariosDe(a.id).filter(p => p.activo && p.rol !== 'pendiente').length}</td>
        <td class="num">${datos.portafolios.filter(x => x.area_id === a.id).length}</td>
        <td class="num">${datos.programas.filter(x => x.area_id === a.id).length}</td>
        <td class="num">${proyectosDe(a.id).length}</td>
        <td>${activa(a) ? badge('Activa', '#2e7d32') : badge('Suspendida', '#b71c1c')}</td></tr>`).join('')}</tbody>
    </table></div>`;
  el.addEventListener('click', e => { if (e.target.closest('[data-a="imprimir"]')) ctx.imprimir(el, 'Resumen de la plataforma'); });
}
const kpi = (n, txt, cls = '') => `<div class="admin-kpi ${cls}"><span class="admin-kpi-num">${n}</span><span class="admin-kpi-txt">${esc(txt)}</span></div>`;

// ════════════════════════════════════════════════════════════════
// EMPRESAS
// ════════════════════════════════════════════════════════════════
export async function panelEmpresas(el, ctx) {
  await cargarPlataforma();
  el.innerHTML = cab('Empresas', 'Todas las empresas de la plataforma. Cada empresa es independiente: sus usuarios, proyectos y permisos no se mezclan.',
    `<button class="btn btn-sm btn-peligro-borde" data-a="eliminar-sel" disabled>Eliminar seleccionadas</button>
     <button class="btn btn-primario" data-a="nueva">+ Nueva empresa</button>`) +
    `<div class="admin-filtros">
      <input class="inp" data-f="q" placeholder="Buscar...">
      <select class="inp" data-f="estado"><option value="">Estado: todos</option><option value="activa">Activas</option><option value="suspendida">Suspendidas</option></select>
      <select class="inp" data-f="orden"><option value="creada">Orden: más antiguas primero</option><option value="nombre">Nombre: A → Z</option><option value="nombre-desc">Nombre: Z → A</option><option value="reciente">Más recientes primero</option></select>
      <span class="flex"></span><span class="nota" data-contador></span>
    </div>
    <div class="tarjeta admin-tabla-wrap"><table class="simple tabla-empresas">
      <thead><tr><th style="width:28px"><input type="checkbox" data-todas aria-label="Seleccionar todas"></th><th>EMPRESA</th><th>ADMINISTRADOR</th><th>SUPER ADMINISTRADOR</th>
        <th class="num">USUARIOS</th><th class="num">PROYECTOS</th><th>ESTADO</th><th>CREADA</th><th></th></tr></thead>
      <tbody></tbody></table></div>`;
  const tbody = el.querySelector('tbody');
  const f = k => el.querySelector(`[data-f="${k}"]`).value;
  const pintar = () => {
    const q = f('q').trim().toLowerCase();
    let lista = datos.areas.filter(a => (!q || `${a.nombre} ${codigoEmpresa(a)} ${superDe(a.id)?.nombre || ''} ${superDe(a.id)?.email || ''}`.toLowerCase().includes(q)) &&
      (!f('estado') || (f('estado') === 'activa') === activa(a)));
    const orden = f('orden');
    if (orden === 'nombre') lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (orden === 'nombre-desc') lista.sort((a, b) => b.nombre.localeCompare(a.nombre));
    if (orden === 'reciente') lista.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    el.querySelector('[data-contador]').textContent = `${lista.length} de ${datos.areas.length}`;
    tbody.innerHTML = lista.map(a => {
      const mia = a.id === datos.mi_area;
      return `<tr data-id="${a.id}">
        <td><input type="checkbox" data-sel="${a.id}" ${mia ? 'disabled title="Es la empresa en la que está trabajando"' : ''}></td>
        <td><b>${esc(a.nombre)}</b>${mia ? ' ' + badge('En uso ahora', '#1565c0') : ''}<br><small class="nota">Código ${esc(codigoEmpresa(a))}</small></td>
        <td>${celdaAdministrador()}</td>
        <td>${celdaSuper(a)}</td>
        <td class="num">${usuariosDe(a.id).filter(p => p.activo && p.rol !== 'pendiente').length} <button class="btn btn-xs" data-usuarios="${a.id}">Gestionar</button></td>
        <td class="num">${proyectosDe(a.id).length}</td>
        <td>${activa(a) ? badge('Activa', '#2e7d32') : badge('Suspendida', '#b71c1c')}</td>
        <td>${esc(fmtFechaHora(a.created_at))}</td>
        <td class="acciones-fila">
          <button class="btn btn-xs" data-abrir="${a.id}" ${mia ? 'disabled' : ''}>Abrir</button>
          <button class="btn btn-xs" data-editar="${a.id}">Editar</button>
          <button class="btn btn-xs" data-estado="${a.id}" ${mia ? 'disabled' : ''}>${activa(a) ? 'Suspender' : 'Activar'}</button>
          <button class="btn btn-xs btn-peligro-borde" data-eliminar="${a.id}" ${mia ? 'disabled' : ''}>Eliminar</button></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="nota">Sin empresas con ese filtro.</td></tr>';
    actualizarSel();
  };
  const seleccionadas = () => [...el.querySelectorAll('[data-sel]:checked')].map(c => c.dataset.sel);
  const actualizarSel = () => {
    const n = seleccionadas().length;
    const b = el.querySelector('[data-a="eliminar-sel"]');
    b.disabled = !n; b.textContent = n ? `Eliminar seleccionadas (${n})` : 'Eliminar seleccionadas';
  };
  el.querySelectorAll('[data-f]').forEach(x => x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', pintar));
  el.addEventListener('change', e => {
    if (e.target.matches('[data-todas]')) el.querySelectorAll('[data-sel]:not(:disabled)').forEach(c => { c.checked = e.target.checked; });
    if (e.target.matches('[data-sel], [data-todas]')) actualizarSel();
  });
  el.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    const a = t.dataset.a, d = t.dataset;
    try {
      if (a === 'nueva') { if (await nuevaEmpresa()) { await refrescar(); pintar(); } }
      if (a === 'eliminar-sel') { if (await eliminarEmpresas(seleccionadas())) { await refrescar(); pintar(); } }
      if (d.abrir) await abrirEmpresa(empresa(d.abrir));
      if (d.editar) { if (await editarEmpresa(empresa(d.editar))) { await refrescar(d.editar); pintar(); ctx.repintarCabecera(); } }
      if (d.estado) { if (await estadoEmpresa(empresa(d.estado))) { await refrescar(); pintar(); } }
      if (d.eliminar) { if (await eliminarEmpresas([d.eliminar])) { await refrescar(); pintar(); } }
      if (d.principal) { if (await cambiarPrincipal(empresa(d.principal))) { await refrescar(d.principal); pintar(); } }
      if (d.usuarios) await gestionarUsuarios(empresa(d.usuarios), () => refrescar(d.usuarios).then(pintar));
    } catch (err) { error(mensajeError(err)); }
  });
  pintar();
}

async function nuevaEmpresa() {
  const { semillaEmpresa } = await import('../data/catalogos.js');
  return pedirDatos({
    titulo: 'Nueva empresa', texto: 'Crear empresa',
    antes: `<div class="admin-quien"><span class="nota">Administrador de la empresa</span>${celdaAdministrador()}</div>
      Se crea con sus listas, parámetros y permisos iniciales y la administran los propietarios de la plataforma (para trabajar en ella use «Abrir»).
      Después puede agregarle usuarios con «Gestionar» y asignarle su <b>super administrador</b>, que creará sus portafolios, programas y proyectos.`,
    campos: [
      { name: 'nombre_empresa', label: 'Nombre de la empresa', required: true, full: true },
      { name: 'descripcion', label: 'Descripción', full: true },
    ],
    alGuardar: async d => {
      await api.adminUsuarios('crear_empresa', { ...d, semilla: semillaEmpresa() });
      ok(`Empresa "${d.nombre_empresa}" creada.`);
    },
  });
}

async function editarEmpresa(a) {
  return pedirDatos({
    titulo: `Editar empresa: ${a.nombre}`, valores: a,
    campos: [{ name: 'nombre', label: 'Nombre de la empresa', required: true, full: true }, { name: 'descripcion', label: 'Descripción', full: true }],
    alGuardar: async d => { await api.adminUsuarios('editar_empresa', { area_id: a.id, ...d }); ok('Empresa actualizada.'); },
  });
}

// ---------- Desactivar / Reactivar (pedido 15) ----------
// No borra nada: oculta el nivel de menús y selectores y conserva su historial (PAC, actividades). En cascada hacia abajo:
// al desactivar un portafolio, programa o proyecto se desactiva lo que tiene debajo; al reactivar se pregunta si también.
const inactivo = (tipo, x) => tipo === 'empresa' ? !activa(x) : ['portafolio', 'programa'].includes(tipo) ? x.estado === 'inactivo' : x.estado === 'cerrado';
function botonActivo(tipo, x) {
  if (tipo === 'empresa' && x.id === datos.mi_area) return '';
  return inactivo(tipo, x)
    ? `<button class="btn btn-xs btn-azul" data-activo="${tipo}:${x.id}" title="Volver a mostrarlo en menús y selectores">Reactivar</button>`
    : `<button class="btn btn-xs" data-activo="${tipo}:${x.id}" title="Ocultarlo sin borrar nada (se puede reactivar)">Desactivar</button>`;
}
async function cambiarActivo(tipo, id) {
  const TABLA = { portafolio: 'portafolios', programa: 'programas', proyecto: 'proyectos', subproyecto: 'proyectos' };
  if (tipo === 'empresa') return estadoEmpresa(empresa(id));
  const x = datos[TABLA[tipo]].find(r => r.id === id);
  if (!x) return false;
  const reactivar = inactivo(tipo, x);
  // Lo que está debajo
  const progs = tipo === 'portafolio' ? datos.programas.filter(g => g.portafolio_id === id) : [];
  const idsProg = new Set(progs.map(g => g.id));
  let proys = tipo === 'portafolio' ? datos.proyectos.filter(p => p.portafolio_id === id || idsProg.has(p.programa_id))
    : tipo === 'programa' ? datos.proyectos.filter(p => p.programa_id === id)
    : tipo === 'proyecto' ? datos.proyectos.filter(p => p.padre_id === id) : [];
  const idsP = new Set(proys.map(p => p.id));
  proys = [...proys, ...datos.proyectos.filter(p => idsP.has(p.padre_id) && !idsP.has(p.id))];
  // Solo los que cambian de estado
  const progsCambian = progs.filter(g => (g.estado === 'inactivo') === reactivar);
  const proysCambian = proys.filter(p => reactivar ? p.estado === 'cerrado' : !['cerrado', 'rechazado'].includes(p.estado));
  const debajo = progsCambian.length + proysCambian.length;
  const nombreX = x.nombre || x.nombre_corto;
  const que = { portafolio: 'el portafolio', programa: 'el programa', proyecto: 'el proyecto', subproyecto: 'el Grupo LPS' }[tipo];
  let conHijos = true;
  if (reactivar) {
    if (!await confirmar(`¿Reactivar ${que} "${nombreX}"? Volverá a aparecer en los menús y selectores.`,
      { titulo: 'Reactivar', texto: 'Reactivar' })) return false;
    if (debajo) conHijos = await confirmar(`¿Reactivar también lo que tiene debajo (${debajo})?`, { titulo: 'Reactivar lo de abajo', texto: 'Sí, también' });
  } else if (!await confirmar(`¿Desactivar ${que} "${nombreX}"${debajo ? ` y lo que tiene debajo (${debajo})` : ''}? No se borra nada: deja de aparecer en menús y selectores, `
      + 'conserva su historial y el PAC, y se puede reactivar cuando quiera.', { titulo: 'Desactivar', texto: 'Desactivar', peligro: true })) return false;
  const estadoNivel = r => reactivar ? 'activo' : 'inactivo', estadoProy = () => reactivar ? 'activo' : 'cerrado';
  const actualizar = (tabla, r, estado) => api.adminUsuarios('estructura', { tabla, id: r.id, datos: { estado } });
  await actualizar(TABLA[tipo], x, TABLA[tipo] === 'proyectos' ? estadoProy() : estadoNivel());
  if (conHijos) {
    for (const g of progsCambian) await actualizar('programas', g, estadoNivel());
    for (const p of proysCambian) await actualizar('proyectos', p, estadoProy());
  }
  ok(`${reactivar ? 'Reactivado' : 'Desactivado'}: ${nombreX}${conHijos && debajo ? ` y ${debajo} elemento(s) de abajo` : ''}.`);
  return true;
}

async function estadoEmpresa(a) {
  const activar = !activa(a);
  if (!await confirmar(activar ? `¿Activar la empresa "${a.nombre}"? Sus usuarios podrán volver a ingresar.`
    : `¿Suspender la empresa "${a.nombre}"? Sus usuarios no podrán ingresar. Sus datos se conservan y puede reactivarla cuando quiera.`,
  { titulo: activar ? 'Activar empresa' : 'Suspender empresa', texto: activar ? 'Activar' : 'Suspender', peligro: !activar })) return false;
  await api.adminUsuarios('estado_empresa', { area_id: a.id, activa: activar });
  ok(activar ? 'Empresa activada.' : 'Empresa suspendida.');
  return true;
}

async function eliminarEmpresas(ids) {
  const lista = ids.map(empresa).filter(Boolean);
  if (!lista.length) return false;
  // Elimina cualquier empresa con TODOS sus datos: se confirma escribiendo su nombre (o ELIMINAR si son varias)
  const cifras = a => {
    const ps = proyectosDe(a.id);
    return `<li><b>${esc(a.nombre)}</b>: ${usuariosDe(a.id).length} usuario(s), ${datos.portafolios.filter(x => x.area_id === a.id).length} portafolio(s),
      ${datos.programas.filter(x => x.area_id === a.id).length} programa(s), ${ps.filter(p => !p.padre_id).length} proyecto(s) y ${ps.filter(p => p.padre_id).length} Grupo(s) LPS</li>`;
  };
  const clave = lista.length === 1 ? lista[0].nombre : 'ELIMINAR';
  const d = await pedirDatos({
    titulo: lista.length > 1 ? `Eliminar ${lista.length} empresas` : `Eliminar la empresa ${lista[0].nombre}`, texto: 'Eliminar definitivamente',
    antes: `<div class="aviso error"><b>Se eliminarán por completo, con todos sus datos:</b><ul style="margin:6px 0 0 18px">${lista.map(cifras).join('')}</ul>
      También su Look Ahead, plan semanal, restricciones, cartera, historial y las cuentas de sus usuarios. <b>No se puede deshacer.</b>
      Si quiere conservar la información, use «Suspender» o descargue antes un respaldo.</div>`,
    campos: [{ name: 'confirmacion', label: `Para confirmar escriba: ${clave}`, required: true, full: true }],
  });
  if (!d) return false;
  if (String(d.confirmacion).trim().toLowerCase() !== clave.toLowerCase()) { error(`Escriba exactamente «${clave}» para confirmar.`); return false; }
  const fallas = [];
  for (const a of lista) {
    try { await api.adminUsuarios('eliminar_empresa', { area_id: a.id }); } catch (e) { fallas.push(`${a.nombre}: ${mensajeError(e)}`); }
  }
  if (fallas.length) error(fallas.join('\n')); else ok(lista.length > 1 ? 'Empresas eliminadas.' : 'Empresa eliminada.');
  return true;
}

// Trabajar en otra empresa: el aplicativo completo pasa a mostrar sus datos
export async function abrirEmpresa(a, { volverA = '#/admin' } = {}) {
  if (!a || a.id === store.area?.id) return;
  if (!await confirmar(`¿Abrir la empresa "${a.nombre}"? El aplicativo completo (plan, Look Ahead, tablero…) pasará a mostrar los datos de esa empresa.`,
    { titulo: 'Abrir empresa', texto: 'Abrir' })) return;
  await api.adminUsuarios('usar_empresa', { area_id: a.id });
  try { localStorage.removeItem('lpsgt-proyecto'); } catch { /* opcional */ }
  location.hash = volverA;
  location.reload();
}

async function cambiarPrincipal(a) {
  const candidatos = usuariosDe(a.id).filter(p => p.activo && !p.es_plataforma && p.rol !== 'pendiente');
  if (!candidatos.length) { error('La empresa todavía no tiene usuarios: la administran los propietarios. Agregue usuarios con «Gestionar» y luego designe aquí su super administrador.'); return false; }
  const actual = principalDe(a.id);
  return pedirDatos({
    titulo: `Super administrador de ${a.nombre}`, texto: superDe(a.id) ? 'Cambiar' : 'Asignar',
    antes: 'El super administrador es el responsable dentro de la empresa: crea sus portafolios, programas, proyectos y Grupos LPS, y asigna los roles de administrador y delegado. Los propietarios de la plataforma siguen siendo sus administradores.',
    valores: { usuario_id: actual && !actual.es_plataforma ? actual.id : '' },
    campos: [{ name: 'usuario_id', label: 'Usuario', type: 'select', required: true, full: true,
      options: candidatos.map(p => ({ value: p.id, label: `${p.nombre} (${p.email || '—'}) · ${ROLES[p.rol] || p.rol}` })) }],
    alGuardar: async d => { await api.adminUsuarios('cambiar_principal', { area_id: a.id, usuario_id: d.usuario_id }); ok('Super administrador asignado.'); },
  });
}

// ════════════════════════════════════════════════════════════════
// USUARIOS (de todas las empresas o de una)
// ════════════════════════════════════════════════════════════════
export async function panelUsuariosPlataforma(el) {
  await cargarPlataforma();
  el.innerHTML = cab('Usuarios de la plataforma', 'Usuarios de todas las empresas, agrupados por empresa.',
    `<button class="btn btn-primario" data-a="nuevo">+ Nuevo usuario</button>`) +
    `<div class="admin-filtros">
      <input class="inp" data-f="q" placeholder="Buscar nombre o correo...">
      <select class="inp" data-f="empresa"><option value="">Empresa: todas</option>${datos.areas.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select>
      <select class="inp" data-f="rol"><option value="">Rol: todos</option>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <select class="inp" data-f="estado"><option value="">Estado: todos</option><option value="1">Activos</option><option value="0">Inactivos</option></select>
      <span class="flex"></span><span class="nota" data-contador></span></div>
    <div data-tabla></div>`;
  const f = k => el.querySelector(`[data-f="${k}"]`).value;
  const pintar = () => {
    const q = f('q').trim().toLowerCase();
    const todas = datos.areas.flatMap(a => usuariosDe(a.id));
    const filtroEmp = f('empresa');
    const areas = filtroEmp ? datos.areas.filter(a => a.id === filtroEmp) : datos.areas;
    let total = 0, gruposHtml = '';
    for (const a of areas) {
      const lista = usuariosDe(a.id).filter(p =>
        (!q || `${p.nombre} ${p.email}`.toLowerCase().includes(q)) &&
        (!f('rol') || p.rol === f('rol')) &&
        (f('estado') === '' || String(Number(!!p.activo)) === f('estado'))
      ).sort((x, y) => (x.nombre || '').localeCompare(y.nombre || ''));
      if (!lista.length) continue;
      total += lista.length;
      gruposHtml += `<div class="empresa-grupo" style="margin-bottom:14px">
        <div class="empresa-grupo-cab"><span>🏢 ${esc(a.nombre)}</span><small class="nota"> · ${lista.length} usuario${lista.length !== 1 ? 's' : ''}</small>
          <span class="flex"></span><button class="btn btn-sm btn-primario" data-nuevo-en="${esc(a.id)}">+ Agregar usuario</button></div>
        <div class="tarjeta" style="border-radius:0 0 10px 10px">${tablaUsuarios(lista, false)}</div>
      </div>`;
    }
    el.querySelector('[data-contador]').textContent = `${total} de ${todas.length}`;
    el.querySelector('[data-tabla]').innerHTML = gruposHtml || '<p class="nota" style="padding:12px">Sin usuarios.</p>';
  };
  el.querySelectorAll('[data-f]').forEach(x => x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', pintar));
  el.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.a === 'nuevo') { if (await nuevoUsuario(f('empresa') || datos.mi_area)) { await refrescar(); pintar(); } }
      if (t.dataset.nuevoEn) { if (await nuevoUsuario(t.dataset.nuevoEn)) { await refrescar(); pintar(); } }
      if (await accionUsuario(t)) { await refrescar(); pintar(); }
    } catch (err) { error(mensajeError(err)); }
  });
  pintar();
}

function tablaUsuarios(lista, conEmpresa) {
  if (!lista.length) return '<p class="nota" style="padding:12px">Sin usuarios.</p>';
  return `<table class="simple"><thead><tr><th>NOMBRE</th><th>CORREO</th>${conEmpresa ? '<th>EMPRESA</th>' : ''}<th>ROL</th><th>ESTADO</th><th>ACCIONES</th><th>ELIMINAR</th></tr></thead>
    <tbody>${lista.map(p => `<tr>
      <td><b>${esc(p.nombre || '—')}</b>${p.es_admin_principal && !p.es_plataforma ? ' ' + badge('Principal', '#1A365D') : ''}${p.es_plataforma ? ' ' + badge('Propietario', '#B07AA1') : ''}
        ${empresasDe(p.id).length > 1 ? `<br><small class="nota">También en: ${esc(empresasDe(p.id).filter(a => a.id !== p._area).map(a => a.nombre).join(', '))}${p._otra ? ` · hoy trabaja en ${esc(empresa(p.area_id)?.nombre || '')}` : ''}</small>` : ''}</td>
      <td>${esc(p.email || '—')}</td>
      ${conEmpresa ? `<td>${esc(empresa(p._area)?.nombre || '—')}</td>` : ''}
      <td>${badge(ROLES[p.rol] || p.rol, COLOR_ROL[p.rol])}</td>
      <td>${p.activo ? badge('Activo', '#2e7d32') : badge('Inactivo', '#888')}</td>
      <td class="acciones-fila"><button class="btn btn-xs" data-rol="${p.id}" data-area="${p._area}">Cambiar rol</button>
        <button class="btn btn-xs" data-activo="${p.id}" data-area="${p._area}">${p.activo ? 'Desactivar' : 'Activar'}</button>
        ${empresasDe(p.id).length > 1 && !p.es_plataforma ? `<button class="btn btn-xs btn-peligro-borde" data-quitar-de="${p.id}" data-area="${p._area}" title="Deja de pertenecer a esta empresa; su cuenta y sus otras empresas siguen">Quitar de esta empresa</button>` : ''}</td>
      <td>${!p.es_plataforma ? `<button class="btn btn-xs btn-peligro" data-eliminar="${p.id}" data-area="${p._area}" title="Eliminar usuario del sistema completamente">🗑 Eliminar</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

async function accionUsuario(t) {
  // Cada fila es una persona EN una empresa (data-area): su rol y estado son los de esa empresa
  const area = t.dataset.area;
  const id = t.dataset.rol || t.dataset.activo || t.dataset.quitarDe || t.dataset.eliminar;
  const u = area ? usuariosDe(area).find(p => p.id === id) : datos.perfiles.find(p => p.id === id);
  if (!u) return false;
  const nomEmp = empresa(area)?.nombre || '';
  if (t.dataset.eliminar) {
    if (!await confirmar(`¿Eliminar a ${u.nombre} del sistema? Esto borrará su cuenta de todas las empresas y no se puede deshacer.`,
      { titulo: 'Eliminar usuario', texto: 'Eliminar', peligro: true })) return false;
    await api.adminUsuarios('eliminar_usuario', { usuario_id: u.id });
    ok(`${u.nombre} fue eliminado del sistema.`);
    return true;
  }
  if (t.dataset.quitarDe) {
    if (!await confirmar(`¿Quitar a ${u.nombre} de ${nomEmp}? Su cuenta sigue y conserva sus otras empresas (${empresasDe(u.id).filter(a => a.id !== area).map(a => a.nombre).join(', ')}).`,
      { titulo: 'Quitar de la empresa', texto: 'Quitar', peligro: true })) return false;
    await api.adminUsuarios('usuario_plataforma', { usuario_id: u.id, area_id: area, quitar: true });
    ok(`${u.nombre} ya no pertenece a ${nomEmp}.`);
    return true;
  }
  if (t.dataset.rol) {
    return pedirDatos({
      titulo: `Rol de ${u.nombre}${nomEmp ? ` en ${nomEmp}` : ''}`, valores: { rol: u.rol },
      campos: [{ name: 'rol', label: 'Rol', type: 'select', required: true, full: true, options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) }],
      alGuardar: async d => { await api.adminUsuarios('usuario_plataforma', { usuario_id: u.id, area_id: area, rol: d.rol }); ok('Rol actualizado.'); },
    });
  }
  if (!await confirmar(`¿${u.activo ? 'Desactivar' : 'Activar'} a ${u.nombre}${nomEmp ? ` en ${nomEmp}` : ''}?`, { texto: u.activo ? 'Desactivar' : 'Activar', peligro: u.activo })) return false;
  await api.adminUsuarios('usuario_plataforma', { usuario_id: u.id, area_id: area, activo: !u.activo });
  ok(u.activo ? 'Usuario desactivado.' : 'Usuario activado.');
  return true;
}

async function nuevoUsuario(areaId) {
  return pedirDatos({
    titulo: 'Nuevo usuario', texto: 'Crear',
    antes: 'Deberá cambiar la contraseña en su primer ingreso. Si el correo ya tiene cuenta en otra empresa, se agrega a esta empresa con el rol elegido (la contraseña no se cambia).',
    valores: { area_id: areaId, rol: 'lider' },
    campos: [
      { name: 'area_id', label: 'Empresa', type: 'select', required: true, full: true, options: datos.areas.map(a => ({ value: a.id, label: a.nombre })) },
      { name: 'nombre', label: 'Nombre', required: true },
      { name: 'email', label: 'Correo', type: 'email', required: true },
      { name: 'rol', label: 'Rol', type: 'select', required: true, options: Object.entries(ROLES).filter(([k]) => k !== 'pendiente').map(([value, label]) => ({ value, label })) },
      { name: 'clave', label: 'Contraseña temporal (mínimo 8 caracteres)', type: 'password', required: true },
    ],
    alGuardar: async d => {
      const r = await api.adminUsuarios('crear', d);
      // Correo que ya tenía cuenta en otra empresa: se agrega a esta con el rol elegido (usuarios de varias empresas)
      ok(r?.agregado ? `${d.email} ya tenía cuenta: se agregó a ${empresa(d.area_id)?.nombre || 'la empresa'} como ${ROLES[d.rol] || d.rol}. Entra con su misma contraseña y elige la empresa desde su menú.`
        : `Usuario creado en ${empresa(d.area_id)?.nombre || 'la empresa'}.`);
    },
  });
}

async function gestionarUsuarios(a, alCambiar) {
  const cuerpo = document.createElement('div');
  const pintar = () => {
    cuerpo.innerHTML = `<div style="display:flex;margin-bottom:8px"><span class="flex"></span><button class="btn btn-sm btn-primario" data-a="nuevo">+ Nuevo usuario</button></div>
      ${tablaUsuarios(usuariosDe(a.id), false)}`;
  };
  cuerpo.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      const cambio = t.dataset.a === 'nuevo' ? await nuevoUsuario(a.id) : await accionUsuario(t);
      if (cambio) { await refrescar(a.id); pintar(); alCambiar?.(); }
    } catch (err) { error(mensajeError(err)); }
  });
  pintar();
  modal({ titulo: `Usuarios de ${a.nombre}`, cuerpo, ancho: 1100, botones: [{ texto: 'Cerrar' }] });
}

// ════════════════════════════════════════════════════════════════
// ESTRUCTURA DE TODAS LAS EMPRESAS: Empresa → Portafolio → Programa → Proyecto
// ════════════════════════════════════════════════════════════════
let vistaEstructura = 'tabla';
const contraidos = new Set();
// Empresa a la que se limita la vista de estructura (pedido 16: «Estructura de la empresa» con las mismas dos pestañas);
// vacío = todas las empresas
let soloArea = '';
const vis = arr => soloArea ? arr.filter(x => x.area_id === soloArea) : arr;
const areasVis = () => soloArea ? datos.areas.filter(a => a.id === soloArea) : datos.areas;

/** Estructura de la empresa elegida (menú EMPRESA): misma vista que la de todas las empresas, solo con esa empresa. */
export function panelEstructuraEmpresa(el, ctx) { return panelEstructuraTodas(el, ctx, { area: store.area?.id }); }

export async function panelEstructuraTodas(el, ctx, { area = '' } = {}) {
  await cargarPlataforma();
  soloArea = area;
  const nombreEmp = area ? empresa(area)?.nombre || '' : '';
  const enArea = area ? ` data-area="${area}"` : '';
  const pintarTodo = () => {
    soloArea = area;   // la vista vuelve a pintarse sola: conserva su empresa
    const vivos = vis(datos.proyectos).filter(p => !['cerrado', 'rechazado'].includes(p.estado));
    const sinAdmin = vivos.filter(p => !lideresEf(p).length).length;
    el.innerHTML = cab(area ? `Estructura de la empresa: ${nombreEmp}` : 'Estructura de todas las empresas',
      area ? 'Portafolio › Programa › Proyecto › Grupo LPS de esta empresa (en el Grupo LPS se registran su Look Ahead y su Plan semanal). Es la misma estructura que se ve en Plataforma › «Estructura de todas las empresas».'
        : 'Empresa › Portafolio › Programa › Proyecto › Grupo LPS (en el Grupo LPS se registran su Look Ahead y su Plan semanal). Es la misma estructura que cada empresa ve en «Estructura de la empresa»: lo que cambie aquí se refleja allá.',
      `<button class="btn" data-nuevo="portafolios"${enArea}>+ Portafolio</button><button class="btn" data-nuevo="programas"${enArea}>+ Programa</button><button class="btn" data-nuevo="proyectos"${enArea}>+ Proyecto</button><button class="btn btn-primario" data-a="nuevo-sub">+ Grupo LPS</button>
       <button class="btn" data-a="xl-export">⬇ Descargar XLS</button><label class="btn" title="Cargar proyectos desde XLS">⬆ Cargar XLS<input type="file" accept=".xlsx,.xls" data-a="xl-import" style="display:none"></label><button class="btn" data-a="backup-completo" style="margin-left:auto;background:#1565c0;color:#fff;border-color:#1565c0" title="Descargar respaldo XLS de toda la estructura (todas las empresas)">💾 Backup completo</button>`) +
      `<div class="chips-cifras">
        ${area ? '' : `<span class="chip-cifra"><b>${datos.areas.length}</b> Empresas</span>`}<span class="chip-cifra"><b>${vis(datos.portafolios).length}</b> Portafolios</span>
        <span class="chip-cifra"><b>${vis(datos.programas).length}</b> Programas</span><span class="chip-cifra"><b>${vis(datos.proyectos).filter(p => !p.padre_id).length}</b> Proyectos</span>
        <span class="chip-cifra"><b>${vis(datos.proyectos).filter(p => p.padre_id).length}</b> Grupos LPS</span>
        <span class="chip-cifra ${sinAdmin ? 'alerta' : ''}"><b>${sinAdmin}</b> Proyectos sin administrador</span></div>
      <div class="pestanas-linea"><button data-vista="tabla" class="${vistaEstructura === 'tabla' ? 'activo' : ''}">${area ? 'Estructura de la empresa' : 'Estructura de todas las empresas'}</button>
        <button data-vista="arbol" class="${vistaEstructura === 'arbol' ? 'activo' : ''}">Estructura jerárquica</button></div>
      <div data-cuerpo></div>`;
    const cuerpo = el.querySelector('[data-cuerpo]');
    if (vistaEstructura === 'tabla') pintarTabla(cuerpo); else pintarOrganigrama(cuerpo);
  };

  el.addEventListener('click', async e => {
    const t = e.target.closest('button, [data-toggle], .org-caja'); if (!t) return;
    const d = t.dataset;
    try {
      if (d.vista) { vistaEstructura = d.vista; pintarTodo(); return; }
      if (d.toggle) { contraidos.has(d.toggle) ? contraidos.delete(d.toggle) : contraidos.add(d.toggle); pintarTodo(); return; }
      if (d.a === 'xl-export') { try { await exportarEstructura(area); } catch (err) { error(mensajeError(err)); } return; }
      if (d.a === 'backup-completo') {
        const btn = e.target; btn.disabled = true; const t0 = btn.textContent; btn.textContent = '⏳ Exportando...';
        try { await exportarEstructura(''); } catch (err) { error(mensajeError(err)); } finally { btn.disabled = false; btn.textContent = t0; }
        return;
      }
      if (d.a === 'expandir') { contraidos.clear(); pintarTodo(); return; }
      if (d.a === 'contraer') { datos.areas.forEach(a => contraidos.add('a' + a.id)); datos.portafolios.forEach(f => contraidos.add('f' + f.id)); datos.programas.forEach(g => contraidos.add('g' + g.id)); datos.proyectos.forEach(p => contraidos.add('p' + p.id)); pintarTodo(); return; }
      let cambio = false, areaId = null;
      if (d.a === 'nuevo-sub') {
        // Nivel Grupo LPS (pedido Q2): primero se elige el proyecto al que pertenece
        const padre = await elegirProyectoPadre();
        if (!padre) return;
        const r = await editarNodo('proyectos', null, { area: padre.area_id, padre: padre.id }); cambio = !!r; areaId = r?.area_id;
      }
      if (d.nuevo) { const r = await editarNodo(d.nuevo, null, { area: d.area, portafolio: d.portafolio, programa: d.programa, padre: d.padre }); cambio = !!r; areaId = r?.area_id; }
      if (d.editar) { const x = datos[d.tabla].find(r => r.id === d.editar); cambio = !!await editarNodo(d.tabla, x, {}); areaId = x?.area_id; }
      if (d.eliminar) { const x = datos[d.tabla].find(r => r.id === d.eliminar); cambio = await eliminarNodo(d.tabla, x); areaId = x?.area_id; }
      if (d.lideres) { const p = datos.proyectos.find(r => r.id === d.lideres); cambio = !!await miembrosProyecto(p); areaId = p?.area_id; }
      if (d.supervisiones) { const p = datos.proyectos.find(r => r.id === d.supervisiones); await gestionarSupervisiones(p); areaId = p?.area_id; }
      if (d.eliminarEmpresa) { cambio = await eliminarEmpresas([d.eliminarEmpresa]); }
      if (d.activo) { const [tipo, id] = d.activo.split(':'); cambio = await cambiarActivo(tipo, id); areaId = tipo === 'empresa' ? id : null; }
      if (d.editarEmpresa) { const a = empresa(d.editarEmpresa); cambio = !!await editarEmpresa(a); areaId = a?.id; if (cambio) ctx.repintarCabecera(); }
      if (d.usuarios) { await gestionarUsuarios(empresa(d.usuarios), () => refrescar(d.usuarios).then(pintarTodo)); }
      if (cambio) { await refrescar(areaId); pintarTodo(); }
    } catch (err) { error(mensajeError(err)); }
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.org-caja')) e.target.click(); });
  el.addEventListener('input', e => { if (e.target.matches('[data-buscar]')) filtrarTabla(el); });
  el.addEventListener('change', async e => {
    if (e.target.matches('[data-mostrar]')) { filtrarTabla(el); return; }
    if (e.target.matches('[data-a="xl-import"]') && e.target.files?.[0]) {
      const lbl = e.target.closest('label');
      const textoOrig = lbl ? lbl.firstChild?.textContent : null;
      if (lbl) lbl.firstChild.textContent = '⏳ Importando...';
      try { await importarEstructura(e.target.files[0], area, async () => { await refrescar(area); pintarTodo(); }); }
      catch (err) { error(mensajeError(err)); }
      finally { if (lbl && textoOrig) lbl.firstChild.textContent = textoOrig; }
      e.target.value = '';
    }
  });
  pintarTodo();
}

function pintarTabla(cuerpo) {
  const filas = [];
  const fila = (nivel, tipo, x, celdas, clave, hijos) => {
    const abierto = !contraidos.has(clave);
    filas.push(`<tr class="est-fila est-${tipo}" data-tipo="${tipo}" data-nivel="${nivel}" data-texto="${esc(celdas.buscar.toLowerCase())}">
      <td style="padding-left:${8 + nivel * 20}px">${hijos ? `<span class="est-toggle" data-toggle="${clave}" role="button" aria-label="${abierto ? 'Contraer' : 'Expandir'}">${abierto ? '▾' : '▸'}</span>` : '<span class="est-toggle est-sin-hijos"></span>'}
        ${celdas.nombre}</td>
      <td>${celdas.tipo}</td><td class="nota">${celdas.codigo}</td><td>${celdas.admin}</td><td class="acciones-fila">${celdas.acciones}</td></tr>`);
    return abierto;
  };
  const filaProyecto = (p, nivel) => {
    const lid = lideresEf(p), sub = !!p.padre_id, hijos = sub ? [] : subDe(p);
    const heredado = sub && !lideresDe(p.id).length && lid.length;
    const abierto = fila(nivel, sub ? 'subproyecto' : 'proyecto', p, {
      nombre: `<span class="est-ico">${sub ? '▫' : '📋'}</span> <span class="${sub ? 'est-n-sub' : 'est-n-proy'}">${esc(p.nombre_corto)}</span> ${p.estado !== 'activo' ? badge(TXT_EST[p.estado] || p.estado, COLOR_EST[p.estado]) : ''}`,
      tipo: sub ? badge('Grupo LPS', '#1A365D') : badge('Proyecto', '#E8762B'), codigo: esc(p.codigo || '—'), buscar: `${p.nombre_corto} ${p.codigo} ${lid.map(nombreCorto).join(' ')}`,
      admin: lid.length ? `${esc(lid.map(nombreCorto).join(', '))}${heredado ? ' <small class="nota">(heredado)</small>' : ''} <button class="btn btn-xs" data-lideres="${p.id}">Cambiar</button>`
        : `${badge('Sin asignar', '#EDC948')} <button class="btn btn-xs btn-azul" data-lideres="${p.id}">Asignar</button>`,
      acciones: `${sub ? '' : `<button class="btn btn-xs" data-nuevo="proyectos" data-area="${p.area_id}" data-padre="${p.id}">+ Grupo LPS</button>`}
        <button class="btn btn-xs" data-editar="${p.id}" data-tabla="proyectos">Editar</button>
        <button class="btn btn-xs" data-lideres="${p.id}">Miembros y permisos</button>
        ${sub ? `<button class="btn btn-xs" data-supervisiones="${p.id}" title="Configurar quién puede ver y editar las actividades de otra persona en este Grupo LPS">👥 Supervisiones</button>` : ''}
        ${botonActivo(sub ? 'subproyecto' : 'proyecto', p)}
        <button class="btn btn-xs btn-peligro-borde" data-eliminar="${p.id}" data-tabla="proyectos">Eliminar</button>`,
    }, 'p' + p.id, hijos.length);
    if (abierto) hijos.forEach(h => filaProyecto(h, nivel + 1));
  };
  const filaPrograma = (g, nivel) => {
    const ps = datos.proyectos.filter(p => p.programa_id === g.id && !p.padre_id);
    if (fila(nivel, 'programa', g, {
      nombre: `<span class="est-ico">📁</span> <span class="est-n-prog">${esc(g.nombre)}</span> ${g.estado === 'inactivo' ? badge('Inactivo', '#888') : ''}`,
      tipo: badge('Programa', '#8E44AD'), codigo: esc(g.codigo || '—'), buscar: `${g.nombre} ${g.codigo || ''}`,
      admin: esc(g.responsable_id ? nombreCorto(datos.perfiles.find(u => u.id === g.responsable_id)) : ''),
      acciones: `<button class="btn btn-xs" data-nuevo="proyectos" data-area="${g.area_id}" data-programa="${g.id}">+ Proyecto</button>
        <button class="btn btn-xs" data-editar="${g.id}" data-tabla="programas">Editar</button>
        ${botonActivo('programa', g)}
        <button class="btn btn-xs btn-peligro-borde" data-eliminar="${g.id}" data-tabla="programas">Eliminar</button>`,
    }, 'g' + g.id, ps.length)) ps.forEach(p => filaProyecto(p, nivel + 1));
  };
  for (const a of areasVis()) {
    const ports = datos.portafolios.filter(f => f.area_id === a.id);
    const progSueltos = datos.programas.filter(g => g.area_id === a.id && !g.portafolio_id);
    const proySueltos = proyectosDe(a.id).filter(p => !p.portafolio_id && !p.programa_id && !p.padre_id);
    const abierta = fila(0, 'empresa', a, {
      nombre: `<span class="est-ico">🏢</span> <b>${esc(a.nombre)}</b> ${a.id === datos.mi_area ? badge('En uso ahora', '#1565c0') : ''} ${activa(a) ? '' : badge('Suspendida', '#b71c1c')}`,
      tipo: badge('Empresa', '#2e7d32'), codigo: esc(codigoEmpresa(a)), buscar: `${a.nombre} ${codigoEmpresa(a)}`,
      admin: `<small class="nota">Administrador: ${esc(propietarios().map(nombreCorto).join(', ') || '—')} · Super administrador: ${esc(superDe(a.id) ? nombreCorto(superDe(a.id)) : 'sin asignar')}</small>`,
      acciones: `<button class="btn btn-xs" data-nuevo="portafolios" data-area="${a.id}">+ Portafolio</button>
        <button class="btn btn-xs" data-nuevo="programas" data-area="${a.id}">+ Programa</button>
        <button class="btn btn-xs" data-nuevo="proyectos" data-area="${a.id}">+ Proyecto</button>
        <button class="btn btn-xs" data-usuarios="${a.id}">Usuarios</button>
        ${botonActivo('empresa', a)}`,
    }, 'a' + a.id, ports.length + progSueltos.length + proySueltos.length);
    if (!abierta) continue;
    for (const f of ports) {
      const gs = datos.programas.filter(g => g.portafolio_id === f.id);
      const ps = datos.proyectos.filter(p => p.portafolio_id === f.id && !p.programa_id && !p.padre_id);
      if (fila(1, 'portafolio', f, {
        nombre: `<span class="est-ico">🗂</span> <span class="est-n-port">${esc(f.nombre)}</span> ${f.estado === 'inactivo' ? badge('Inactivo', '#888') : ''}`,
        tipo: badge('Portafolio', '#1565c0'), codigo: esc(f.codigo || '—'), buscar: `${f.nombre} ${f.codigo || ''}`,
        admin: esc(f.responsable_id ? nombreCorto(datos.perfiles.find(u => u.id === f.responsable_id)) : ''),
        acciones: `<button class="btn btn-xs" data-nuevo="programas" data-area="${a.id}" data-portafolio="${f.id}">+ Programa</button>
          <button class="btn btn-xs" data-nuevo="proyectos" data-area="${a.id}" data-portafolio="${f.id}">+ Proyecto</button>
          <button class="btn btn-xs" data-editar="${f.id}" data-tabla="portafolios">Editar</button>
          ${botonActivo('portafolio', f)}
          <button class="btn btn-xs btn-peligro-borde" data-eliminar="${f.id}" data-tabla="portafolios">Eliminar</button>`,
      }, 'f' + f.id, gs.length + ps.length)) { gs.forEach(g => filaPrograma(g, 2)); ps.forEach(p => filaProyecto(p, 2)); }
    }
    progSueltos.forEach(g => filaPrograma(g, 1));
    proySueltos.forEach(p => filaProyecto(p, 1));
  }
  cuerpo.innerHTML = `<div class="admin-filtros">
      <input class="inp" data-buscar placeholder="Buscar en la estructura..." style="width:260px">
      <select class="inp" data-mostrar><option value="">Mostrar: todo</option><option value="empresa">Solo empresas</option><option value="portafolio">Hasta portafolios</option>
        <option value="programa">Hasta programas</option><option value="proyecto">Hasta proyectos</option><option value="sinadmin">Proyectos sin administrador</option></select>
      <button class="btn btn-sm" data-a="expandir">Expandir todo</button><button class="btn btn-sm" data-a="contraer">Contraer todo</button></div>
    <div class="tarjeta admin-tabla-wrap"><table class="simple tabla-estructura">
      <thead><tr><th>NOMBRE</th><th>TIPO</th><th>CÓDIGO</th><th>ADMINISTRADOR</th><th></th></tr></thead><tbody>${filas.join('')}</tbody></table></div>`;
}

function filtrarTabla(el) {
  const q = (el.querySelector('[data-buscar]')?.value || '').trim().toLowerCase();
  const m = el.querySelector('[data-mostrar]')?.value || '';
  const orden = ['empresa', 'portafolio', 'programa', 'proyecto', 'subproyecto'];
  el.querySelectorAll('.est-fila').forEach(tr => {
    let ver = !q || tr.dataset.texto.includes(q);
    if (m === 'sinadmin') ver = ver && ['proyecto', 'subproyecto'].includes(tr.dataset.tipo) && !!tr.querySelector('.btn-azul');
    else if (m) ver = ver && orden.indexOf(tr.dataset.tipo) <= orden.indexOf(m);
    tr.style.display = ver ? '' : 'none';
  });
}

// Proyecto al que se agrega un Grupo LPS: solo proyectos (no Grupos LPS), con su empresa
function elegirProyectoPadre() {
  const opciones = vis(datos.proyectos).filter(p => !p.padre_id && !['cerrado', 'rechazado'].includes(p.estado))
    .map(p => ({ value: p.id, label: `${empresa(p.area_id)?.nombre || ''} › ${p.codigo} · ${p.nombre_corto}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!opciones.length) { error('Primero cree un proyecto: el Grupo LPS pertenece a un proyecto.'); return Promise.resolve(null); }
  let elegido = null;
  return pedirDatos({
    titulo: 'Nuevo Grupo LPS', antes: 'Elija el proyecto al que pertenece. El Grupo LPS hereda su empresa, portafolio, programa y líderes; en él se registra el LPS (Look Ahead y Plan semanal).',
    campos: [{ name: 'padre_id', label: 'Proyecto', type: 'select', required: true, full: true, options: opciones }],
    alGuardar: d => { elegido = datos.proyectos.find(p => p.id === d.padre_id) || null; },
  }).then(() => elegido);
}

// Organigrama (como el lienzo «Estructura de Proyectos»): cajas por nivel unidas con líneas
function pintarOrganigrama(cuerpo) {
  // Cada tarjeta se edita con un clic sobre ella (pedido 14)
  const TABLA = { portafolio: 'portafolios', programa: 'programas', proyecto: 'proyectos', subproyecto: 'proyectos' };
  const caja = (tipo, titulo, sub, id, areaSub) => `<div class="org-caja org-${tipo}" role="button" tabindex="0" title="Clic para editar"
      ${tipo === 'empresa' ? `data-editar-empresa="${id}"` : `data-editar="${id}" data-tabla="${TABLA[tipo]}"`}><b>${esc(titulo)}</b><small>${esc(sub)}</small>
      ${areaSub ? `<button class="org-mas" title="Agregar Grupo LPS" aria-label="Agregar Grupo LPS a ${esc(titulo)}" data-nuevo="proyectos" data-area="${areaSub}" data-padre="${id}">+</button>` : ''}
      ${tipo === 'empresa' && id === datos.mi_area ? '' : `<button class="org-borrar" title="Eliminar" aria-label="Eliminar ${esc(titulo)}"
        ${tipo === 'empresa' ? `data-eliminar-empresa="${id}"` : `data-eliminar="${id}" data-tabla="${TABLA[tipo]}"`}>🗑</button>`}</div>`;
  // Portafolios y programas se abren en horizontal; los proyectos (y sus Grupos LPS) se apilan en vertical (pedido 20)
  const columna = items => `<ul class="org-v">${items.join('')}</ul>`;
  const nodo = (htmlCaja, hijos, proyectos = []) => {
    const ramas = [...hijos, ...(hijos.length && proyectos.length ? [`<li class="org-grupo">${columna(proyectos)}</li>`] : [])];
    return `<li>${htmlCaja}${ramas.length ? `<ul>${ramas.join('')}</ul>` : proyectos.length ? columna(proyectos) : ''}</li>`;
  };
  const sub = p => nodo(caja('subproyecto', p.nombre_corto, 'Grupo LPS', p.id), []);
  const proy = p => nodo(caja('proyecto', p.nombre_corto, `Proyecto${lideresDe(p.id).length ? ' · ' + lideresDe(p.id).map(nombreCorto).join(', ') : ''}`, p.id, p.area_id), [], subDe(p).map(sub));
  const raiz = arr => arr.filter(p => !p.padre_id);
  const prog = g => nodo(caja('programa', g.nombre, 'Programa', g.id), [], raiz(datos.proyectos.filter(p => p.programa_id === g.id)).map(proy));
  const arboles = areasVis().map(a => {
    const hijos = [
      ...datos.portafolios.filter(f => f.area_id === a.id).map(f => nodo(caja('portafolio', f.nombre, 'Portafolio', f.id),
        datos.programas.filter(g => g.portafolio_id === f.id).map(prog),
        raiz(datos.proyectos.filter(p => p.portafolio_id === f.id && !p.programa_id)).map(proy))),
      ...datos.programas.filter(g => g.area_id === a.id && !g.portafolio_id).map(prog),
    ];
    return `<div class="org-arbol"><ul>${nodo(caja('empresa', a.nombre, 'Empresa', a.id), hijos,
      raiz(proyectosDe(a.id).filter(p => !p.portafolio_id && !p.programa_id)).map(proy))}</ul></div>`;
  });
  cuerpo.innerHTML = `<p class="nota">Haga clic en una tarjeta para editarla; 🗑 la elimina y <b>+</b> (en cada proyecto) le agrega un Grupo LPS. Los proyectos se listan en columna bajo su programa, portafolio o empresa. Las cajas naranjas son proyectos (con su administrador) y las azul oscuro, sus Grupos LPS, donde se registran el Look Ahead y el Plan semanal.</p>
    <div class="org-lienzo">${arboles.join('')}</div>`;
}

// ---------- Exportar / Importar XLS ----------
async function exportarEstructura(soloAreaId = '') {
  await libExcel();
  const XLSX = window.XLSX;
  const cabecera = ['Empresa', 'Portafolio', 'Programa', 'Proyecto', 'Código Proyecto', 'Grupo LPS', 'Código Grupo LPS', 'Estado'];
  const filas = [cabecera];
  const esBackupTotal = !soloAreaId;
  const areas = soloAreaId ? datos.areas.filter(a => a.id === soloAreaId) : datos.areas;
  for (const a of areas) {
    const ports = datos.portafolios.filter(f => f.area_id === a.id);
    const progs = datos.programas.filter(g => g.area_id === a.id);
    const projs = datos.proyectos.filter(p => p.area_id === a.id && !p.padre_id);
    if (!projs.length) { filas.push([a.nombre, '', '', '', '', '', '', '']); continue; }
    for (const p of projs) {
      const prog = progs.find(g => g.id === p.programa_id);
      const port = ports.find(f => f.id === (p.portafolio_id || prog?.portafolio_id));
      const subs = datos.proyectos.filter(x => x.padre_id === p.id);
      if (subs.length) {
        for (const s of subs)
          filas.push([a.nombre, port?.nombre || '', prog?.nombre || '', p.nombre_corto, p.codigo || '', s.nombre_corto, s.codigo || '', s.estado]);
      } else {
        filas.push([a.nombre, port?.nombre || '', prog?.nombre || '', p.nombre_corto, p.codigo || '', '', '', p.estado]);
      }
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = cabecera.map((_, i) => ({ wch: [20, 20, 20, 25, 16, 25, 18, 12][i] }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Estructura');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, esBackupTotal ? `backup-lpsges-${fecha}.xlsx` : `estructura-${fecha}.xlsx`);
}

async function importarEstructura(file, soloAreaId, alTerminar) {
  await libExcel();
  const XLSX = window.XLSX;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Leer como array de arrays para no depender de los nombres exactos de cabecera
  const todas = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
  if (todas.length < 2) { error('El archivo está vacío o no tiene el formato esperado.'); return; }

  // Detectar columnas por posición (primero) o por cabecera (fallback)
  const cab = todas[0].map(c => String(c).trim().toLowerCase().replace(/[áéíóú]/g, m => ({ á:'a',é:'e',í:'i',ó:'o',ú:'u' }[m])));
  const ci = name => { const i = cab.indexOf(name); return i >= 0 ? i : null; };
  const iEmp  = ci('empresa')           ?? 0;
  const iPort = ci('portafolio')        ?? 1;
  const iProg = ci('programa')          ?? 2;
  const iProy = ci('proyecto')          ?? 3;
  const iCodP = ci('codigo proyecto')   ?? 4;
  // Cabecera actual «Grupo LPS»; los archivos descargados antes dicen «Sub-proyecto»
  const iSub  = ci('grupo lps') ?? ci('sub-proyecto') ?? 5;
  const iCodS = ci('codigo grupo lps') ?? ci('codigo sub-proyecto') ?? 6;
  const iEst  = ci('estado')            ?? 7;
  const c = (row, i) => String(row[i] ?? '').trim();

  const filas = todas.slice(1).filter(r => r.some(v => String(v).trim()));

  // Caché local para no re-crear lo que ya existe o ya creamos en esta sesión
  const portCache = new Map(); // "areaId:nombre" → id
  const progCache = new Map(); // "areaId:portId:nombre" → id
  const proyCache = new Map(); // "areaId:cod:CODE" o "areaId:nom:NAME" → id

  // Precargar existentes en caché
  for (const f of datos.portafolios) portCache.set(`${f.area_id}:${f.nombre}`, f.id);
  for (const g of datos.programas) {
    progCache.set(`${g.area_id}:${g.portafolio_id || ''}:${g.nombre}`, g.id);
  }
  for (const p of datos.proyectos.filter(x => !x.padre_id)) {
    if (p.codigo) proyCache.set(`${p.area_id}:cod:${p.codigo}`, p.id);
    proyCache.set(`${p.area_id}:nom:${p.nombre_corto}`, p.id);
  }

  let cPorts = 0, cProgs = 0, cProys = 0, cSubs = 0, omitidos = 0;
  const errores = [];

  const crearNodo = async (tabla, areaId, campos) => {
    const res = await api.adminUsuarios('estructura', { tabla, area_id: areaId, datos: campos });
    // La Edge Function puede devolver { registro: {...} } o el objeto directamente
    const reg = res?.registro ?? res;
    if (!reg?.id) throw new Error(`Respuesta inesperada al crear ${tabla}: ${JSON.stringify(res)}`);
    if (tabla === 'portafolios') { datos.portafolios.push(reg); cPorts++; }
    else if (tabla === 'programas') { datos.programas.push(reg); cProgs++; }
    else if (campos.padre_id) { datos.proyectos.push(reg); cSubs++; }
    else { datos.proyectos.push(reg); cProys++; }
    return reg;
  };

  for (let i = 0; i < filas.length; i++) {
    const row = filas[i];
    try {
      const nomEmp  = c(row, iEmp);
      const nomPort = c(row, iPort);
      const nomProg = c(row, iProg);
      const nomProy = c(row, iProy);
      const codProy = c(row, iCodP);
      const nomSub  = c(row, iSub);
      const codSub  = c(row, iCodS);
      const estado  = c(row, iEst) || 'activo';

      const areaId = soloAreaId || datos.areas.find(a => a.nombre === nomEmp)?.id;
      if (!areaId) { omitidos++; continue; }

      // Portafolio
      let portId = null;
      if (nomPort) {
        const clave = `${areaId}:${nomPort}`;
        portId = portCache.get(clave);
        if (!portId) {
          const r = await crearNodo('portafolios', areaId, { nombre: nomPort, estado: 'activo' });
          portId = r.id; portCache.set(clave, portId);
        }
      }

      // Programa
      let progId = null;
      if (nomProg) {
        const clave = `${areaId}:${portId || ''}:${nomProg}`;
        progId = progCache.get(clave);
        if (!progId) {
          const r = await crearNodo('programas', areaId, { nombre: nomProg, portafolio_id: portId || null, estado: 'activo' });
          progId = r.id; progCache.set(clave, progId);
        }
      }

      // Proyecto: buscar por código primero (más fiable que el nombre)
      if (!nomProy && !codProy) { omitidos++; continue; }
      let proyId = (codProy ? proyCache.get(`${areaId}:cod:${codProy}`) : null)
               ?? (nomProy ? proyCache.get(`${areaId}:nom:${nomProy}`) : null)
               ?? null;
      if (!proyId) {
        const r = await crearNodo('proyectos', areaId, { nombre_corto: nomProy || codProy, codigo: codProy || null, programa_id: progId || null, portafolio_id: portId || null, estado });
        proyId = r.id;
        if (codProy) proyCache.set(`${areaId}:cod:${codProy}`, proyId);
        if (nomProy) proyCache.set(`${areaId}:nom:${nomProy}`, proyId);
      } else { if (!nomSub && !codSub) omitidos++; }

      // Grupo LPS
      if (!nomSub && !codSub) continue;
      const subExiste = datos.proyectos.some(p => p.padre_id === proyId &&
        (codSub ? p.codigo === codSub : p.nombre_corto === nomSub));
      if (!subExiste) {
        await crearNodo('proyectos', areaId, { nombre_corto: nomSub || codSub, codigo: codSub || null, padre_id: proyId, estado });
      } else { omitidos++; }
    } catch (err) {
      const fila = row.filter(v => String(v).trim()).slice(0, 5).join(' | ');
      errores.push(`Fila ${i + 2}: ${mensajeError(err)} — [${fila}]`);
      console.error('[import] fila', i + 2, err, row);
    }
  }

  const total = cPorts + cProgs + cProys + cSubs;

  // Mostrar modal PRIMERO (antes de refrescar), para que aparezca aunque alTerminar falle
  const lineas = [
    total
      ? `<p style="color:#2e7d32;margin:0 0 6px"><b>Creados: ${cPorts} portafolio(s), ${cProgs} programa(s), ${cProys} proyecto(s), ${cSubs} Grupo(s) LPS</b></p>`
      : `<p style="margin:0 0 6px">Sin elementos nuevos que importar.</p>`,
    omitidos ? `<p style="margin:0 0 6px;color:#555">⏭ Ya existían (omitidos): <b>${omitidos}</b></p>` : '',
    errores.length
      ? `<p style="color:#c62828;margin:0 0 4px"><b>Errores (${errores.length}):</b></p><pre style="font-size:12px;white-space:pre-wrap;max-height:200px;overflow:auto;background:#fef2f2;padding:8px;border-radius:4px">${esc(errores.join('\n'))}</pre>`
      : '',
  ].join('');

  modal({
    titulo: 'Resultado de la importación',
    cuerpo: lineas,
    botones: [{ texto: 'Cerrar', clase: 'btn-primario' }],
  });

  // Refrescar la vista después (si falla no oculta el modal ya mostrado)
  if (total > 0) {
    try { await alTerminar(); } catch (e) { console.error('[import] alTerminar error:', e); }
  }
}

// ---------- Altas, ediciones y bajas (pasan por el servidor: pueden ser de cualquier empresa) ----------
async function editarNodo(tabla, x, { area, portafolio, programa, padre }) {
  const areaId = x?.area_id || area;
  const padreId = x?.padre_id || padre || '';
  const padreP = padreId && datos.proyectos.find(z => z.id === padreId);
  const campos = [];
  // Empresa: al crear sin empresa elegida y, en un proyecto (no Grupo LPS), también al editar para moverlo (pedido 15)
  const eligeEmpresa = !areaId || (tabla === 'proyectos' && x && !padreP);
  if (eligeEmpresa) campos.push({ name: 'area_id', label: 'Empresa', type: 'select', required: true, full: true, options: datos.areas.map(a => ({ value: a.id, label: a.nombre })) });
  const opcPort = id => datos.portafolios.filter(f => (!id || f.area_id === id) && f.estado !== 'inactivo').map(f => ({ value: f.id, label: f.nombre }));
  const opcProg = id => datos.programas.filter(g => (!id || g.area_id === id) && g.estado !== 'inactivo').map(g => {
    const f = datos.portafolios.find(z => z.id === g.portafolio_id);
    return { value: g.id, label: [f?.nombre, g.nombre].filter(Boolean).join(' › ') };
  });
  const responsables = id => (id ? usuariosDe(id) : datos.perfiles).filter(p => p.activo && p.rol !== 'pendiente').map(p => ({ value: p.id, label: `${p.nombre} (${nombreCorto(p)})` }));
  if (tabla === 'proyectos') {
    campos.push({ name: 'codigo', label: 'Código', required: true }, { name: 'nombre_corto', label: 'Nombre corto (menú)', required: true },
      { name: 'nombre_completo', label: 'Nombre completo', full: true },
      // Un Grupo LPS hereda el portafolio y el programa de su proyecto
      ...(padreP ? [] : [{ name: 'portafolio_id', label: 'Portafolio', type: 'select', options: opcPort(eligeEmpresa ? null : areaId) },
        { name: 'programa_id', label: 'Programa (define el portafolio)', type: 'select', options: opcProg(eligeEmpresa ? null : areaId) }]),
      { name: 'estado', label: 'Estado', type: 'select', required: true, options: Object.entries(TXT_EST).map(([value, label]) => ({ value, label })) },
      { name: 'fecha_inicio', label: 'Inicio previsto', type: 'date' }, { name: 'fecha_fin', label: 'Fin previsto', type: 'date' });
  } else {
    campos.push({ name: 'codigo', label: 'Código' }, { name: 'nombre', label: 'Nombre', required: true });
    if (tabla === 'programas') campos.push({ name: 'portafolio_id', label: 'Portafolio', type: 'select', options: opcPort(eligeEmpresa ? null : areaId) });
    campos.push({ name: 'responsable_id', label: 'Responsable', type: 'select', options: responsables(eligeEmpresa ? null : areaId) },
      { name: 'estado', label: 'Estado', type: 'select', required: true, options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }] },
      { name: 'descripcion', label: 'Descripción', type: 'textarea', full: true });
  }
  const que = { portafolios: 'portafolio', programas: 'programa', proyectos: padreP ? 'Grupo LPS' : 'proyecto' }[tabla];
  let creado = null, mueveA = null;
  const promesa = pedirDatos({
    titulo: x ? `Editar ${que}: ${x.nombre || x.nombre_corto}` : padreP ? `Nuevo Grupo LPS de ${padreP.nombre_corto}` : `Nuevo ${que}${areaId ? ' en ' + (empresa(areaId)?.nombre || '') : ''}`,
    antes: padreP ? 'El Grupo LPS hereda el portafolio, el programa y los líderes de su proyecto. El Look Ahead y el Plan semanal se registran en él.' : '',
    valores: x || { estado: 'activo', portafolio_id: portafolio || '', programa_id: programa || '' },
    campos,
    alGuardar: async d => {
      const area_id = d.area_id || areaId;
      const mueve = x && tabla === 'proyectos' && area_id !== x.area_id;
      mueveA = mueve ? area_id : null;
      if (mueve) {
        const subs = subDe(x).length;
        if (!await confirmar(`¿Mover "${x.nombre_corto}"${subs ? ` y sus ${subs} Grupo(s) LPS` : ''} a la empresa "${empresa(area_id)?.nombre}"? ` +
          'Se quitan su gerencia, fase, país y líderes (son de la empresa actual) para elegirlos en la nueva. Solo se puede si todavía no tiene actividades, restricciones ni cartera.',
        { titulo: 'Mover a otra empresa', texto: 'Mover' })) throw new Error('No se movió el proyecto.');
      }
      // Un programa o portafolio elegido debe ser de la misma empresa
      for (const [k, t] of [['portafolio_id', 'portafolios'], ['programa_id', 'programas']]) {
        if (d[k] && datos[t].find(z => z.id === d[k])?.area_id !== area_id) throw new Error(`El ${k === 'portafolio_id' ? 'portafolio' : 'programa'} elegido es de otra empresa.`);
      }
      const { area_id: _, ...resto } = d;
      if (padreP) resto.padre_id = padreP.id;
      const res = await api.adminUsuarios('estructura', { tabla, id: x?.id, area_id, datos: resto });
      creado = res.registro;
      ok(mueveA ? `Proyecto movido a ${empresa(mueveA)?.nombre}.` : `${que[0].toUpperCase() + que.slice(1)} guardado.`);
    },
  });
  if (eligeEmpresa) filtrarPorEmpresa();
  const r = await promesa;
  return r ? (creado || x) : null;
}

// En el formulario: portafolios, programas y responsables solo de la empresa elegida
function filtrarPorEmpresa() {
  const form = [...document.querySelectorAll('.modal')].pop();
  const selEmp = form?.querySelector('[name="area_id"]');
  if (!selEmp) return;
  const deOtra = (campo, id) => campo === 'responsable_id' ? !perteneceA(id, selEmp.value)
    : datos[campo === 'portafolio_id' ? 'portafolios' : 'programas'].find(z => z.id === id)?.area_id !== selEmp.value;
  const aplicar = () => {
    for (const campo of ['portafolio_id', 'programa_id', 'responsable_id']) {
      const sel = form.querySelector(`[name="${campo}"]`);
      if (!sel) continue;
      for (const o of sel.options) if (o.value) o.hidden = o.disabled = deOtra(campo, o.value);
      if (sel.selectedOptions[0]?.hidden) sel.value = '';
    }
  };
  selEmp.addEventListener('change', aplicar);
  aplicar();
}

async function eliminarNodo(tabla, x) {
  if (!x) return false;
  if (tabla === 'proyectos') return eliminarProyecto(x);
  const que = tabla === 'portafolios' ? 'el portafolio' : 'el programa';
  const aviso = 'Sus programas y proyectos no se eliminan: quedan sin ' + (tabla === 'portafolios' ? 'portafolio.' : 'programa.');
  if (!await confirmar(`¿Eliminar ${que} "${x.nombre}"? ${aviso}`, { titulo: 'Eliminar', texto: 'Eliminar', peligro: true })) return false;
  await api.adminUsuarios('estructura', { tabla, op: 'eliminar', id: x.id });
  ok('Eliminado.');
  return true;
}

// Proyecto (pedido 18): sin trabajo registrado se elimina con una confirmación; con historial o Grupos LPS se muestra
// lo que se borrará y se confirma escribiendo su nombre
async function eliminarProyecto(x) {
  const h = await api.adminUsuarios('historial_proyecto', { id: x.id });
  const sub = x.padre_id ? 'Grupo LPS' : 'proyecto';
  if (!h.subproyectos && !h.actividades && !h.restricciones && !h.cartera) {
    if (!await confirmar(`¿Eliminar el ${sub} "${x.nombre_corto}"? Todavía no tiene trabajo registrado.`, { titulo: 'Eliminar', texto: 'Eliminar', peligro: true })) return false;
    await api.adminUsuarios('estructura', { tabla: 'proyectos', op: 'eliminar', id: x.id });
    ok(`${sub[0].toUpperCase() + sub.slice(1)} eliminado.`);
    return true;
  }
  const items = [h.subproyectos && `${h.subproyectos} Grupo(s) LPS`, h.actividades && `${h.actividades} actividad(es) del Look Ahead y del plan semanal`,
    h.restricciones && `${h.restricciones} restricción(es)`, h.cartera && `${h.cartera} registro(s) de cartera`].filter(Boolean);
  const d = await pedirDatos({
    titulo: `Eliminar el ${sub} ${x.nombre_corto}`, texto: 'Eliminar definitivamente',
    antes: `<div class="aviso error"><b>Se eliminará con todo su historial:</b><ul style="margin:6px 0 0 18px">${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      También sus comentarios, enlaces e hitos (aunque sean de semanas cerradas). <b>No se puede deshacer.</b> Si quiere conservarlo, cámbielo a «Cerrado».</div>`,
    campos: [{ name: 'confirmacion', label: `Para confirmar escriba: ${x.nombre_corto}`, required: true, full: true }],
  });
  if (!d) return false;
  if (String(d.confirmacion).trim().toLowerCase() !== x.nombre_corto.trim().toLowerCase()) { error(`Escriba exactamente «${x.nombre_corto}» para confirmar.`); return false; }
  await api.adminUsuarios('estructura', { tabla: 'proyectos', op: 'eliminar', id: x.id, completo: true });
  ok(`${sub[0].toUpperCase() + sub.slice(1)} eliminado con su historial.`);
  return true;
}

// Administrador y miembros del proyecto = sus líderes (los permisos de cada uno los da su rol en la Matriz de permisos)
async function miembrosProyecto(p) {
  if (!p) return null;
  const actuales = lideresDe(p.id).map(u => u.id);
  const candidatos = usuariosDe(p.area_id).filter(u => u.activo && u.rol !== 'pendiente');
  return pedirDatos({
    titulo: `Miembros de ${p.nombre_corto}`, texto: 'Guardar',
    antes: `Empresa: <b>${esc(empresa(p.area_id)?.nombre || '')}</b>. Los usuarios se registran en la empresa y aquí solo se eligen: los marcados administran el proyecto (líderes).
      ${p.padre_id ? 'Si no marca a nadie, el Grupo LPS hereda los líderes de su proyecto. ' : 'Sus Grupos LPS los heredan. '}Lo que cada uno puede hacer lo define su rol en «Matriz de permisos».`,
    valores: { usuarios: actuales },
    campos: [{ name: 'usuarios', label: 'Líderes / administradores del proyecto', type: 'multiselect', full: true,
      options: candidatos.map(u => ({ value: u.id, label: `${u.nombre} · ${ROLES[u.rol] || u.rol}` })) }],
    alGuardar: async d => { await api.adminUsuarios('lideres', { proyecto_id: p.id, usuario_ids: d.usuarios || [] }); ok('Miembros actualizados.'); },
  });
}

// ════════════════════════════════════════════════════════════════
// SUPERVISIONES POR GRUPO LPS (s40)
// ════════════════════════════════════════════════════════════════
async function gestionarSupervisiones(p) {
  if (!p) return;
  const areaId = p.area_id;
  const candidatos = usuariosDe(areaId).filter(u => u.activo && u.rol !== 'pendiente');
  let actuales = [];
  try { actuales = await api.list('supervisiones', { eq: { area_id: areaId, proyecto_id: p.id } }); } catch { /* tabla aún no creada */ }
  const opts = candidatos.map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');
  const filasSup = actuales.filter(s => s.activo !== false).map(s => {
    const sup = candidatos.find(u => u.id === s.supervisor_id);
    const sub = candidatos.find(u => u.id === s.subordinado_id);
    return sup && sub ? `<tr><td>${esc(sup.nombre)}</td><td style="padding:0 8px">→</td><td>${esc(sub.nombre)}</td>
      <td><button class="btn btn-xs btn-peligro-borde" data-quitar-s="${s.id}">Quitar</button></td></tr>` : '';
  }).join('');
  let huboambios = false;
  const m = modal({
    titulo: `👥 Supervisiones — ${p.nombre_corto}`,
    ancho: 620,
    cuerpo: `<p class="nota">Un supervisor puede ver y editar las actividades del subordinado en este Grupo LPS.</p>
      <table class="simple" style="width:100%;margin-bottom:12px">
        <thead><tr><th>Supervisor</th><th></th><th>Subordinado</th><th></th></tr></thead>
        <tbody data-filas-s>${filasSup || '<tr><td colspan="4" class="nota">Sin supervisiones configuradas.</td></tr>'}</tbody>
      </table>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select data-sel-sup class="inp" style="flex:1"><option value="">— Supervisor —</option>${opts}</select>
        <span>→</span>
        <select data-sel-sub class="inp" style="flex:1"><option value="">— Subordinado —</option>${opts}</select>
        <button class="btn btn-azul" data-a-agregar>Agregar</button>
      </div>`,
    botones: [{ texto: 'Cerrar' }],
    alCerrar: () => { if (huboambios) refrescar(areaId); },
  });
  m.cuerpo.addEventListener('click', async e => {
    const qs = e.target.closest('[data-quitar-s]');
    if (qs) {
      try { await api.remove('supervisiones', qs.dataset.quitarS); huboambios = true; ok('Supervisión eliminada.'); qs.closest('tr').remove(); } catch (err) { error(mensajeError(err)); }
    }
    if (e.target.closest('[data-a-agregar]')) {
      const supId = m.cuerpo.querySelector('[data-sel-sup]').value;
      const subId = m.cuerpo.querySelector('[data-sel-sub]').value;
      if (!supId || !subId) { error('Elige supervisor y subordinado.'); return; }
      if (supId === subId) { error('El supervisor y el subordinado deben ser distintos.'); return; }
      try {
        await api.insert('supervisiones', { area_id: areaId, proyecto_id: p.id, supervisor_id: supId, subordinado_id: subId, activo: true });
        huboambios = true; ok('Supervisión agregada.');
        const sup = candidatos.find(u => u.id === supId), sub = candidatos.find(u => u.id === subId);
        const tbody = m.cuerpo.querySelector('[data-filas-s]');
        if (tbody.querySelector('[colspan]')) tbody.innerHTML = '';
        tbody.insertAdjacentHTML('beforeend', `<tr><td>${esc(sup.nombre)}</td><td style="padding:0 8px">→</td><td>${esc(sub.nombre)}</td><td><small class="nota">✓</small></td></tr>`);
      } catch (err) { error(mensajeError(err)); }
    }
  });
}

// ════════════════════════════════════════════════════════════════
// PROPIETARIOS DE LA PLATAFORMA
// ════════════════════════════════════════════════════════════════
export async function panelPropietarios(el) {
  await cargarPlataforma();
  const pintar = () => {
    const props = datos.perfiles.filter(p => p.es_plataforma);
    el.innerHTML = cab('Propietarios de la plataforma', 'Administran todas las empresas: las crean, suspenden y eliminan, y ven su estructura. Debe haber al menos uno.',
      `<button class="btn btn-primario" data-a="agregar">+ Agregar propietario</button>`) +
      `<div class="tarjeta admin-tabla-wrap"><table class="simple"><thead><tr><th>NOMBRE</th><th>CORREO</th><th>TRABAJANDO EN</th><th></th></tr></thead>
        <tbody>${props.map(p => `<tr><td><b>${esc(p.nombre)}</b>${p.id === store.usuario.id ? ' ' + badge('Usted', '#1565c0') : ''}</td><td>${esc(p.email || '—')}</td>
          <td>${esc(empresa(p.area_id)?.nombre || '—')}</td>
          <td><button class="btn btn-xs btn-peligro-borde" data-quitar="${p.id}" ${p.id === store.usuario.id || props.length <= 1 ? 'disabled' : ''}>Quitar</button></td></tr>`).join('')}</tbody></table></div>`;
  };
  el.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    try {
      if (t.dataset.a === 'agregar') {
        const r = await pedirDatos({
          titulo: 'Agregar propietario', texto: 'Agregar',
          antes: 'Tendrá acceso a la administración de TODAS las empresas. Asígnelo solo a personas de plena confianza.',
          campos: [{ name: 'usuario_id', label: 'Usuario', type: 'select', required: true, full: true,
            options: datos.perfiles.filter(p => !p.es_plataforma && p.activo).map(p => ({ value: p.id, label: `${p.nombre} (${p.email || '—'}) · ${empresa(p.area_id)?.nombre || ''}` })) }],
          alGuardar: async d => { await api.adminUsuarios('propietario', { usuario_id: d.usuario_id, es: true }); ok('Propietario agregado.'); },
        });
        if (r) { await refrescar(); pintar(); }
      }
      if (t.dataset.quitar) {
        const p = datos.perfiles.find(x => x.id === t.dataset.quitar);
        if (await confirmar(`¿Quitar a ${p.nombre} como propietario de la plataforma? Seguirá como usuario de su empresa.`, { texto: 'Quitar', peligro: true })) {
          await api.adminUsuarios('propietario', { usuario_id: p.id, es: false }); ok('Propietario quitado.'); await refrescar(); pintar();
        }
      }
    } catch (err) { error(mensajeError(err)); }
  });
  pintar();
}

// ════════════════════════════════════════════════════════════════
// AUDITORÍA Y REPORTES DE LA PLATAFORMA
// ════════════════════════════════════════════════════════════════
export async function panelAuditoriaPlataforma(el) {
  await cargarPlataforma();
  el.innerHTML = cab('Auditoría de la plataforma', 'Últimos 300 cambios registrados.') +
    `<div class="admin-filtros"><select class="inp" data-f="empresa"><option value="">Empresa: todas</option>${datos.areas.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></div>
    <div class="tarjeta admin-tabla-wrap" data-tabla><div class="admin-cargando"><span class="spinner"></span></div></div>`;
  const pintar = async () => {
    const cont = el.querySelector('[data-tabla]');
    try {
      const { registros } = await api.adminUsuarios('auditoria_plataforma', { area_id: el.querySelector('[data-f="empresa"]').value || undefined });
      const quien = id => datos.perfiles.find(p => p.id === id)?.nombre || '—';
      cont.innerHTML = registros.length ? `<table class="simple"><thead><tr><th>FECHA</th><th>EMPRESA</th><th>USUARIO</th><th>TABLA</th><th>ACCIÓN</th><th>CAMBIOS</th></tr></thead>
        <tbody>${registros.map(r => `<tr><td>${esc(fmtFechaHora(r.created_at))}</td><td>${esc(empresa(r.area_id)?.nombre || '—')}</td><td>${esc(quien(r.usuario_id))}</td>
          <td>${esc(r.tabla)}</td><td>${esc(r.accion)}</td><td><small>${esc(Object.keys(r.cambios || {}).slice(0, 6).join(', '))}</small></td></tr>`).join('')}</tbody></table>`
        : '<p class="nota" style="padding:12px">Sin registros.</p>';
    } catch (err) { cont.innerHTML = `<div class="aviso error">${esc(mensajeError(err))}</div>`; }
  };
  el.querySelector('[data-f="empresa"]').addEventListener('change', pintar);
  pintar();
}

export async function panelReportesPlataforma(el, ctx) {
  await cargarPlataforma();
  const filas = datos.areas.map(a => {
    const ps = proyectosDe(a.id);
    const cuenta = est => ps.filter(p => p.estado === est).length;
    return [a.nombre, activa(a) ? 'Activa' : 'Suspendida', usuariosDe(a.id).filter(p => p.activo && p.rol !== 'pendiente').length,
      datos.portafolios.filter(x => x.area_id === a.id).length, datos.programas.filter(x => x.area_id === a.id).length,
      cuenta('activo'), cuenta('propuesto'), cuenta('en_pausa'), cuenta('cerrado'), ps.filter(p => !['cerrado', 'rechazado'].includes(p.estado) && !lideresEf(p).length).length];
  });
  const cabs = ['Empresa', 'Estado', 'Usuarios activos', 'Portafolios', 'Programas', 'Proyectos activos', 'Propuestos', 'En pausa', 'Cerrados', 'Sin administrador'];
  el.innerHTML = cab('Reportes de la plataforma', 'Cifras por empresa.',
    `<button class="btn btn-sm" data-a="excel">⬇ Excel</button><button class="btn btn-sm" data-a="imprimir">🖨 Imprimir</button>`) +
    `<div class="tarjeta admin-tabla-wrap"><table class="simple"><thead><tr>${cabs.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(f => `<tr>${f.map((v, i) => `<td${i > 1 ? ' class="num"' : ''}>${esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'imprimir') ctx.imprimir(el, 'Reportes de la plataforma');
    if (a === 'excel') {
      let XLSX;
      try { XLSX = await libExcel(); } catch (err) { return error(err.message); }
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([cabs, ...filas]), 'Empresas');
      XLSX.writeFile(libro, 'Plataforma_empresas.xlsx');
    }
  });
}
