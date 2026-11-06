// Consola de Administración — LPS-GES
// Barra superior: ⚙ Administración › [Plataforma] › EMPRESA (selector) › PROYECTO (selector).
// Menú PLATAFORMA (propietarios de la plataforma, admin-plataforma.js) y menú EMPRESA (la empresa en la que se trabaja).
// Spec: docs/LPS-GT_Alcance_v0.7.docx sección 6.1-6.2
import { api, mensajeError } from '../data/api.js';
import { store, on, esAdmin, cargarCatalogo, etiqueta, nombre, seleccionarProyecto } from '../core/store.js';
import * as plat from './admin-plataforma.js';
import { ROLES, COLOR_ROL } from '../data/catalogos.js';
import { esc } from '../core/util.js';
import { ok, error, confirmar, pedirDatos, badge } from '../ui/ui.js';

// ---------- Estado ----------
let contenedor = null;
let panelActivo = 'resumen';
let dejarEscuchar = null;

// ---------- Menú ----------
const esPlataforma = () => !!store.usuario?.es_plataforma;
const MENU_PLATAFORMA = [
  { id: 'p-resumen',     ico: '📊', texto: 'Resumen' },
  { id: 'p-empresas',    ico: '🏢', texto: 'Empresas' },
  { id: 'p-usuarios',    ico: '👥', texto: 'Usuarios' },
  { id: 'p-estructura',  ico: '🌳', texto: 'Estructura de todas las empresas' },
  { id: 'p-propietarios', ico: '👑', texto: 'Propietarios' },
  { id: 'p-auditoria',   ico: '📜', texto: 'Auditoría' },
  { id: 'p-reportes',    ico: '📄', texto: 'Reportes' },
];
const MENU = [
  { id: 'resumen',       ico: '📊', texto: 'Resumen',                 si: esAdmin },
  { sep: true },
  // Usuarios y roles, Administrador delegado y Matriz de permisos son de los Grupos LPS: quedan en Configuración (pedido 16)
  { id: 'estructura',    ico: '🌐', texto: 'Estructura de la empresa', si: esAdmin },
  // Portafolios y Programas van dentro de «Estructura de la empresa» (con las mismas dos pestañas de Plataforma)
  // Listas configurables, Parámetros y Calendario aplican a los Grupos LPS: quedan en Configuración (pedido a11)
  { sep: true },
  { id: 'auditoria',     ico: '🕑', texto: 'Auditoría',               si: esAdmin },
];


// ---------- API pública ----------
export function showAdminConsole(panelInicial, el) {
  panelActivo = panelInicial || (esPlataforma() ? 'p-empresas' : 'resumen');
  contenedor = el;

  el.innerHTML = buildShell();
  repintarCabecera();

  el.querySelector('.admin-cerrar').addEventListener('click', cerrarConsola);
  el.querySelector('.admin-topbar').addEventListener('click', e => {
    if (e.target.closest('[data-a="plataforma"]')) navegarA('p-resumen');
  });
  el.querySelector('.admin-topbar').addEventListener('change', async e => {
    const sel = e.target;
    if (sel.matches('[data-sel="empresa"]')) {
      const destino = { id: sel.value, nombre: sel.selectedOptions[0]?.textContent };
      sel.value = store.area?.id;
      try { await plat.abrirEmpresa(destino); } catch (err) { error(mensajeError(err)); }
    }
    if (sel.matches('[data-sel="proyecto"]') && sel.value) {
      const grupo = !!store.proyectos.find(p => p.id === sel.value)?.padre_id;
      seleccionarProyecto(sel.value);
      repintarCabecera();
      ok(`${grupo ? 'Grupo LPS' : 'Proyecto'} seleccionado: el plan, el Look Ahead y los reportes se filtran por él.`);
    }
  });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarConsola(); });
  el.querySelector('.admin-nav').addEventListener('click', e => {
    const item = e.target.closest('[data-panel]');
    if (item) navegarA(item.dataset.panel);
  });

  pintarMenu();
  renderPanel();

  const dejarCatalogo = on('catalogo', () => { pintarMenu(); });
  // Si se elige otro proyecto o Grupo LPS en el menú lateral, la barra superior lo refleja
  const dejarProyecto = on('proyecto', () => repintarCabecera());
  dejarEscuchar = () => { dejarCatalogo(); dejarProyecto(); };
  setTimeout(() => contenedor?.querySelector('#admin-contenido')?.focus(), 50);
}

export function cerrarConsola() {
  dejarEscuchar?.();
  dejarEscuchar = null;
  contenedor = null;
  location.hash = '#/tablero';
}

function buildShell() {
  return `<div class="admin-inner">
    <div class="admin-topbar">
      <span class="admin-topbar-ico">⚙</span>
      <span class="admin-topbar-titulo">Administración</span>
      <span class="admin-migas"></span>
      <span class="flex"></span>
      <button class="admin-cerrar" title="Cerrar (Esc)" aria-label="Cerrar">✕</button>
    </div>
    <div class="admin-body">
      <aside class="admin-lateral">
        <nav class="admin-nav" aria-label="Navegación de administración"></nav>
      </aside>
      <main class="admin-contenido" id="admin-contenido" tabindex="-1">
        <div class="admin-cargando"><span class="spinner"></span></div>
      </main>
    </div>
  </div>`;
}

// Migas: [Plataforma] › EMPRESA (selector) › PROYECTO o GRUPO LPS (selector)
async function repintarCabecera() {
  const migas = contenedor?.querySelector('.admin-migas');
  if (!migas) return;
  let empresas = [{ id: store.area?.id, nombre: store.area?.nombre || 'Empresa' }];
  if (esPlataforma()) {
    // Las mismas empresas que usan los paneles de la plataforma (una sola descarga)
    try { empresas = plat.empresasEnMemoria() || (await plat.cargarPlataforma()).areas || empresas; } catch { /* se muestra solo la propia */ }
  }
  const proyectos = (store.proyectos || []).filter(p => !['cerrado', 'rechazado'].includes(p.estado));
  // Cada Grupo LPS va justo debajo de su proyecto
  const ordenados = proyectos.filter(p => !p.padre_id || !proyectos.some(x => x.id === p.padre_id))
    .flatMap(p => [p, ...proyectos.filter(h => h.padre_id === p.id)]);
  const grupoSel = !!proyectos.find(p => p.id === store.proyectoSel)?.padre_id;
  migas.innerHTML = `${esPlataforma() ? `<button class="admin-miga-plat${panelActivo.startsWith('p-') ? ' activo' : ''}" data-a="plataforma">Plataforma</button><span class="admin-miga-sep">›</span>` : ''}
    <label class="admin-miga-sel"><span>EMPRESA</span><select data-sel="empresa" ${esPlataforma() ? '' : 'disabled'}>
      ${empresas.map(e => `<option value="${e.id}" ${e.id === store.area?.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></label>
    <span class="admin-miga-sep">›</span>
    <label class="admin-miga-sel"><span>${grupoSel ? 'GRUPO LPS' : 'PROYECTO'}</span><select data-sel="proyecto"><option value="">Elegir proyecto o Grupo LPS…</option>
      ${ordenados.map(p => `<option value="${p.id}" ${p.id === store.proyectoSel ? 'selected' : ''}>${p.padre_id ? '\u00a0\u00a0↳ ' : ''}${esc(p.codigo)} · ${esc(p.nombre_corto)}${p.padre_id ? ' (Grupo LPS)' : ''}</option>`).join('')}</select></label>`;
}

// ---------- Navegación ----------
function pintarMenu() {
  const nav = contenedor?.querySelector('.admin-nav');
  if (!nav) return;
  const item = m => m.sep ? '<hr class="admin-nav-sep">' : `<button class="admin-item${panelActivo === m.id ? ' activo' : ''}" data-panel="${m.id}">
      <span class="admin-ico">${m.ico}</span><span class="admin-txt">${esc(m.texto)}</span></button>`;
  const empresaItems = MENU.filter(m => !m.si || m.si());
  // Quién administra cada bloque (pedido q5): la plataforma, el propietario; la empresa, la del usuario
  nav.innerHTML = (esPlataforma() ? `<div class="admin-nav-grupo" title="Solo los propietarios de la plataforma">Plataforma (Propietario)</div>${MENU_PLATAFORMA.map(item).join('')}<hr class="admin-nav-sep">` : '') +
    `<div class="admin-nav-grupo" title="${esc(store.area?.nombre || '')}">Empresa (${esc(store.area?.nombre || '')})</div>${empresaItems.map(item).join('')}`;
}

function navegarA(id) {
  panelActivo = id;
  pintarMenu();
  contenedor?.querySelector('.admin-miga-plat')?.classList.toggle('activo', id.startsWith('p-'));
  renderPanel();
}

async function renderPanel() {
  const previo = contenedor?.querySelector('#admin-contenido');
  if (!previo) return;
  // Cada panel registra sus clics en el contenedor: se reemplaza para no acumular los del panel anterior
  const cont = previo.cloneNode(false);
  previo.replaceWith(cont);
  cont.innerHTML = '<div class="admin-cargando"><span class="spinner"></span></div>';
  // Secciones que ya funcionan en Configuración: se muestran aquí mismo, con los mismos datos y reglas
  const config = nombre => async el => {
    const { seccionConfig } = await import('./config.js');
    el.innerHTML = '';
    await seccionConfig(nombre, el);
  };
  const ctx = { imprimir: imprimirPanel, repintarCabecera };
  if (panelActivo.startsWith('p-') && !esPlataforma()) panelActivo = 'resumen';
  try {
    const mapa = {
      'p-resumen':     el => plat.panelResumenPlataforma(el, ctx),
      'p-empresas':    el => plat.panelEmpresas(el, ctx),
      'p-usuarios':    el => plat.panelUsuariosPlataforma(el, ctx),
      'p-estructura':  el => plat.panelEstructuraTodas(el, ctx),
      'p-propietarios': el => plat.panelPropietarios(el, ctx),
      'p-auditoria':   el => plat.panelAuditoriaPlataforma(el, ctx),
      'p-reportes':    el => plat.panelReportesPlataforma(el, ctx),
      'resumen':     panelResumen,
      'empresas':    config('empresas'),
      // Propietarios: la misma vista de dos pestañas que en Plataforma, solo con esta empresa (pedido 16)
      'estructura':  el => plat.panelEstructuraEmpresa(el, ctx),
      'auditoria':   config('auditoria'),
    };
    const fn = mapa[panelActivo];
    if (fn) await fn(cont);
    else cont.innerHTML = '<p class="nota" style="padding:20px">Panel en construcción.</p>';
  } catch (e) {
    cont.innerHTML = `<div class="aviso error" style="margin:20px">${esc(mensajeError(e))}</div>`;
  }
}

// ════════════════════════════════════════════════════════════════
// RESUMEN
// ════════════════════════════════════════════════════════════════

async function panelResumen(el) {
  let perfiles = [], proyectos = [], delegados = [];
  try {
    [perfiles, proyectos] = await Promise.all([
      api.list('profiles', { eq: { activo: true } }),
      api.list('proyectos', {}),
    ]);
    delegados = perfiles.filter(p => p.rol === 'delegado');
  } catch { /* sin datos aún */ }

  const activos = proyectos.filter(p => p.estado === 'activo').length;
  const propuestos = proyectos.filter(p => p.estado === 'propuesto').length;

  const delegadoActual = delegados[0];
  const rolLabel = r => ROLES[r] || r;
  const contPorRol = Object.fromEntries(['superadmin', 'admin', 'delegado', 'lider', 'consulta'].map(r =>
    [r, perfiles.filter(p => p.rol === r).length]
  ));

  el.innerHTML = cab('Resumen del área', [btn('🖨 Imprimir', 'imprimir')]) +
  `<div class="admin-kpis">
    <div class="admin-kpi"><span class="admin-kpi-num">${perfiles.length}</span><span class="admin-kpi-txt">Usuarios activos</span></div>
    <div class="admin-kpi"><span class="admin-kpi-num">${activos}</span><span class="admin-kpi-txt">Proyectos activos</span></div>
    <div class="admin-kpi"><span class="admin-kpi-num">${propuestos}</span><span class="admin-kpi-txt">Por aprobar</span></div>
    <div class="admin-kpi"><span class="admin-kpi-num">${proyectos.length - activos - propuestos}</span><span class="admin-kpi-txt">En pausa / cerrados</span></div>
  </div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:16px">
    <div class="tarjeta" style="flex:1;min-width:260px;padding:16px">
      <h3 style="margin:0 0 10px">Usuarios por rol</h3>
      <table class="simple">
        <thead><tr><th>Rol</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${Object.entries(contPorRol).map(([r, c]) => `<tr>
            <td>${badge(rolLabel(r), COLOR_ROL[r] || '#888')}</td>
            <td><b>${c}</b></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="tarjeta" style="flex:1;min-width:260px;padding:16px">
      <h3 style="margin:0 0 10px">Administrador delegado actual</h3>
      ${delegadoActual
        ? `<p><b>${esc(delegadoActual.nombre)}</b><br>
           <small style="color:var(--gris-txt)">${esc(delegadoActual.email || delegadoActual.codigo || '')}</small></p>
           <button class="btn btn-sm" data-a="ir-delegado">Gestionar delegación →</button>`
        : `<p style="color:var(--gris-txt)">Sin delegado asignado.</p>
           <button class="btn btn-sm btn-primario" data-a="ir-delegado">Asignar delegado →</button>`}
    </div>
    ${propuestos ? `<div class="tarjeta" style="flex:1;min-width:260px;padding:16px;border-left:3px solid var(--naranja)">
      <h3 style="margin:0 0 10px">⚠ Proyectos por aprobar</h3>
      <p>${propuestos} proyecto(s) propuesto(s) esperan aprobación.</p>
      <button class="btn btn-sm btn-primario" data-a="ir-proyectos">Ver proyectos →</button>
    </div>` : ''}
  </div>`;

  el.querySelector('[data-a="imprimir"]')?.addEventListener('click', () => imprimirPanel(el, 'Resumen del área'));
  // El delegado se gestiona en Configuración › Usuarios y roles (pedido 16)
  el.querySelector('[data-a="ir-delegado"]')?.addEventListener('click', () => { location.hash = '#/config/usuarios'; });
  el.querySelector('[data-a="ir-proyectos"]')?.addEventListener('click', () => navegarA('estructura'));
}

// ════════════════════════════════════════════════════════════════
// PROYECTOS / PROCESOS
// ════════════════════════════════════════════════════════════════

async function panelProyectos(el) {
  const [proyectos, portafolios, programas, lideresProy] = await Promise.all([
    api.list('proyectos', { eq: { area_id: store.area.id }, order: [['codigo', true]] }),
    api.list('portafolios', { eq: { area_id: store.area.id } }).catch(() => []),
    api.list('programas', { eq: { area_id: store.area.id } }).catch(() => []),
    api.list('proyecto_lideres', {}).catch(() => []),
  ]);
  const colorEst = { activo: '#2e7d32', propuesto: '#e65100', en_pausa: '#795548', cerrado: '#546E7A', rechazado: '#b71c1c' };
  const labelEst = { activo: 'Activo', propuesto: 'Propuesto', en_pausa: 'En pausa', cerrado: 'Cerrado', rechazado: 'Rechazado' };
  const propuestos = proyectos.filter(p => p.estado === 'propuesto');
  const nomPort = id => portafolios.find(x => x.id === id)?.nombre || '';
  const nomProg = id => programas.find(x => x.id === id)?.nombre || '';
  const lidNames = p => lideresProy.filter(l => l.proyecto_id === p.id).map(l => nombre(l.usuario_id)).join(', ');

  el.innerHTML = cab('Proyectos y procesos', [
    btn('+ Nuevo proyecto', 'nuevo', 'btn-primario'),
    btn('🖨 Imprimir', 'imprimir'),
  ]) +
  (propuestos.length ? `<div class="aviso warn" style="margin-bottom:12px"><b>${propuestos.length} proyecto(s) propuesto(s) esperan aprobación.</b></div>` : '') +
  `<div class="admin-filtros">
    <input class="inp" id="buscar-proy" placeholder="Buscar por código o nombre..." style="width:220px">
    <select class="inp" id="fil-port"><option value="">Portafolio: todos</option>
      ${portafolios.map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}<option value="-">Sin portafolio</option></select>
    <select class="inp" id="fil-est"><option value="">Estado: todos</option>
      ${Object.entries(labelEst).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
  </div>
  <div class="tarjeta admin-tabla-wrap">
    <table class="simple" id="tabla-proy">
      <thead><tr><th>CÓDIGO</th><th>NOMBRE</th><th>GRUPO LPS DE</th><th>PORTAFOLIO</th><th>PROGRAMA</th><th>GERENCIA</th><th>ESTADO</th><th>LÍDERES</th><th></th></tr></thead>
      <tbody>${proyectos.map(p => `<tr data-port="${p.portafolio_id || '-'}" data-est="${p.estado || ''}">
          <td><b>${esc(p.codigo || '—')}</b></td>
          <td>${esc(p.nombre_corto || '—')}</td>
          <td>${esc(proyectos.find(x => x.id === p.padre_id)?.nombre_corto || '—')}</td>
          <td>${esc(nomPort(p.portafolio_id) || '—')}</td>
          <td>${esc(nomProg(p.programa_id) || '—')}</td>
          <td>${esc(etiqueta(p.gerencia_id) || '—')}</td>
          <td>${badge(labelEst[p.estado] || p.estado, colorEst[p.estado] || '#888')}</td>
          <td><small>${esc(lidNames(p) || '—')}</small></td>
          <td>
            <button class="btn btn-xs" data-editar="${p.id}">Editar</button>
            ${p.estado === 'propuesto' ? `
              <button class="btn btn-xs btn-primario" data-aprobar="${p.id}">Aprobar</button>
              <button class="btn btn-xs btn-warn" data-rechazar="${p.id}">Rechazar</button>` : ''}
            ${['cerrado', 'rechazado', 'propuesto'].includes(p.estado) ? '' :
              `<button class="btn btn-xs btn-warn" data-estado="${p.id}" data-nuevo-est="${p.estado === 'activo' ? 'en_pausa' : 'activo'}">
                ${p.estado === 'activo' ? 'Pausar' : 'Activar'}</button>`}
          </td></tr>`).join('')}</tbody>
    </table>
    <div style="text-align:right;padding:8px;color:var(--gris-txt);font-size:.85em">${proyectos.length} registro(s)</div>
  </div>`;

  const filtrar = () => {
    const q = (el.querySelector('#buscar-proy')?.value || '').toLowerCase();
    const port = el.querySelector('#fil-port')?.value || '';
    const est = el.querySelector('#fil-est')?.value || '';
    el.querySelectorAll('#tabla-proy tbody tr').forEach(tr => {
      tr.style.display = (!q || tr.textContent.toLowerCase().includes(q)) && (!port || tr.dataset.port === port) && (!est || tr.dataset.est === est) ? '' : 'none';
    });
  };
  el.querySelector('#buscar-proy')?.addEventListener('input', filtrar);
  el.querySelector('#fil-port')?.addEventListener('change', filtrar);
  el.querySelector('#fil-est')?.addEventListener('change', filtrar);

  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    const idEdit = e.target.closest('[data-editar]')?.dataset.editar;
    const idAprob = e.target.closest('[data-aprobar]')?.dataset.aprobar;
    const idRech = e.target.closest('[data-rechazar]')?.dataset.rechazar;
    const idEst = e.target.closest('[data-estado]')?.dataset.estado;
    const nuevoEst = e.target.closest('[data-estado]')?.dataset.nuevoEst;
    const { formularioProyecto } = await import('./proyectos.js');
    if (a === 'nuevo') { await formularioProyecto(); await renderPanel(); }
    if (a === 'imprimir') imprimirPanel(el, 'Proyectos y procesos');
    if (idEdit) { await formularioProyecto(proyectos.find(p => p.id === idEdit)); await renderPanel(); }
    if (idAprob) { await cambiarEstadoProy(idAprob, 'activo', { aprobado_por: store.usuario.id, aprobado_at: new Date().toISOString() }); await cargarCatalogo(); await renderPanel(); }
    if (idRech) { await rechazarProyecto(proyectos.find(p => p.id === idRech)); await cargarCatalogo(); await renderPanel(); }
    if (idEst && nuevoEst) { await cambiarEstadoProy(idEst, nuevoEst); await cargarCatalogo(); await renderPanel(); }
  });
}

// ════════════════════════════════════════════════════════════════
// ESTRUCTURA: EMPRESA → PORTAFOLIO → PROGRAMA → PROYECTO
// ════════════════════════════════════════════════════════════════

async function cargarEstructura() {
  const [portafolios, programas, proyectos] = await Promise.all([
    api.list('portafolios', { eq: { area_id: store.area.id }, order: [['nombre', true]] }),
    api.list('programas', { eq: { area_id: store.area.id }, order: [['nombre', true]] }),
    api.list('proyectos', { eq: { area_id: store.area.id }, order: [['codigo', true]] }),
  ]);
  return { portafolios, programas, proyectos };
}

const estadoEst = e => e === 'inactivo' ? badge('Inactivo', '#888') : badge('Activo', '#2e7d32');

async function panelEstructura(el) {
  const [{ portafolios, programas, proyectos }, lideresProy] = await Promise.all([
    cargarEstructura(),
    api.list('proyecto_lideres', {}).catch(() => []),
  ]);
  const colorEst = { activo: '#2e7d32', propuesto: '#e65100', en_pausa: '#795548', cerrado: '#546E7A', rechazado: '#b71c1c' };
  const labelEst = { activo: 'Activo', propuesto: 'Propuesto', en_pausa: 'En pausa', cerrado: 'Cerrado', rechazado: 'Rechazado' };
  const propuestos = proyectos.filter(p => p.estado === 'propuesto');
  const lidNames = p => lideresProy.filter(l => l.proyecto_id === p.id).map(l => nombre(l.usuario_id)).filter(Boolean).join(', ');

  const itemProy = (p, filtroEst, q) => {
    const ger = etiqueta(p.gerencia_id);
    const lids = lidNames(p);
    const subs = proyectos.filter(x => x.padre_id === p.id).filter(x =>
      (!filtroEst || x.estado === filtroEst) &&
      (!q || `${x.codigo} ${x.nombre_corto}`.toLowerCase().includes(q)));
    return `<li class="est-proy" data-est="${p.estado}">
      <div class="est-proy-fila">
        <span class="est-proy-nombre"><b>${esc(p.codigo)}</b> · ${esc(p.nombre_corto)}</span>
        <span class="est-proy-meta">
          ${badge(labelEst[p.estado] || p.estado, colorEst[p.estado] || '#888')}
          ${ger ? `<small class="nota" style="margin-left:4px">${esc(ger)}</small>` : ''}
          ${lids ? `<small class="nota" style="margin-left:4px">👤 ${esc(lids)}</small>` : ''}
        </span>
        <span class="est-proy-acc">
          <button class="btn btn-xs" data-editar="${p.id}">Editar</button>
          ${p.estado === 'propuesto' ? `
            <button class="btn btn-xs btn-primario" data-aprobar="${p.id}">Aprobar</button>
            <button class="btn btn-xs btn-warn" data-rechazar="${p.id}">Rechazar</button>` : ''}
          ${['cerrado', 'rechazado', 'propuesto'].includes(p.estado) ? '' :
            `<button class="btn btn-xs btn-warn" data-estado="${p.id}" data-nuevo-est="${p.estado === 'activo' ? 'en_pausa' : 'activo'}">
              ${p.estado === 'activo' ? 'Pausar' : 'Activar'}</button>`}
        </span>
      </div>
      ${subs.length ? `<ul>${subs.map(x => itemProy(x, filtroEst, q)).join('')}</ul>` : ''}
    </li>`;
  };

  const buildArbol = (filtroEst = '', q = '') => {
    const pasaFiltro = p => {
      const ok = (!filtroEst || p.estado === filtroEst) && (!q || `${p.codigo} ${p.nombre_corto}`.toLowerCase().includes(q));
      const tieneSubs = proyectos.filter(x => x.padre_id === p.id).some(x =>
        (!filtroEst || x.estado === filtroEst) && (!q || `${x.codigo} ${x.nombre_corto}`.toLowerCase().includes(q)));
      return ok || tieneSubs;
    };
    const ramaPrograma = g => {
      const ps = proyectos.filter(p => p.programa_id === g.id && !p.padre_id).filter(pasaFiltro);
      if (!ps.length && filtroEst) return '';
      return `<li><span class="est-prog">📁 ${esc(g.nombre)}</span> ${g.estado === 'inactivo' ? estadoEst(g.estado) : ''}
        <small class="nota">${ps.length} proyecto(s)</small>${ps.length ? `<ul>${ps.map(p => itemProy(p, filtroEst, q)).join('')}</ul>` : ''}</li>`;
    };
    const ramaPortafolio = f => {
      const gs = programas.filter(g => g.portafolio_id === f.id);
      const ps = proyectos.filter(p => p.portafolio_id === f.id && !p.programa_id && !p.padre_id).filter(pasaFiltro);
      const gsConProy = gs.filter(g => proyectos.filter(p => p.programa_id === g.id && !p.padre_id).some(pasaFiltro));
      if (!ps.length && !gsConProy.length && filtroEst) return '';
      return `<li><span class="est-port">🗂 ${esc(f.nombre)}</span> ${f.estado === 'inactivo' ? estadoEst(f.estado) : ''}
        <ul>${gs.map(ramaPrograma).join('')}${ps.map(p => itemProy(p, filtroEst, q)).join('')}${!gs.length && !ps.length ? '<li class="nota">Sin programas ni proyectos</li>' : ''}</ul></li>`;
    };
    const progSueltos = programas.filter(g => !g.portafolio_id).filter(g =>
      proyectos.filter(p => p.programa_id === g.id && !p.padre_id).some(pasaFiltro));
    const proySueltos = proyectos.filter(p => !p.portafolio_id && !p.programa_id && !p.padre_id).filter(pasaFiltro);
    return `<div class="tarjeta est-arbol"><ul>
      <li><span class="est-emp">🏢 ${esc(store.area?.nombre || 'Empresa')}</span>
        <ul>${portafolios.map(ramaPortafolio).join('')}
          ${progSueltos.length ? `<li><span class="est-port nota">Programas sin portafolio</span><ul>${progSueltos.map(ramaPrograma).join('')}</ul></li>` : ''}
          ${proySueltos.length ? `<li><span class="est-port nota">Proyectos sin portafolio ni programa</span><ul>${proySueltos.map(p => itemProy(p, filtroEst, q)).join('')}</ul></li>` : ''}
        </ul></li></ul></div>`;
  };

  el.innerHTML = cab('Estructura de la empresa', [
    btn('+ Nuevo proyecto', 'nuevo', 'btn-primario'),
    btn('🖨 Imprimir', 'imprimir'),
  ]) +
  (propuestos.length ? `<div class="aviso warn" style="margin-bottom:12px"><b>${propuestos.length} proyecto(s) propuesto(s) esperan aprobación.</b></div>` : '') +
  `<div class="admin-filtros">
    <input class="inp" id="buscar-est" placeholder="Buscar por código o nombre..." style="width:220px">
    <select class="inp" id="fil-port-est"><option value="">Portafolio: todos</option>
      ${portafolios.map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select>
    <select class="inp" id="fil-est-arbol"><option value="">Estado: todos</option>
      <option value="activo">Activo</option>
      <option value="propuesto">Propuesto</option>
      <option value="en_pausa">En pausa</option>
      <option value="cerrado">Cerrado</option>
      <option value="rechazado">Rechazado</option>
    </select>
  </div>
  <div id="est-arbol-cont">${buildArbol()}</div>`;

  const refrescar = () => {
    const q = (el.querySelector('#buscar-est')?.value || '').toLowerCase();
    const portFil = el.querySelector('#fil-port-est')?.value || '';
    const filtroEst = el.querySelector('#fil-est-arbol')?.value || '';
    // Si hay filtro por portafolio, filtramos proyectos con ese portafolio
    const qFinal = q;
    const estFinal = filtroEst;
    el.querySelector('#est-arbol-cont').innerHTML = buildArbol(estFinal, qFinal);
    // Ocultar portafolios que no coinciden con el filtro de portafolio
    if (portFil) {
      el.querySelectorAll('.est-arbol > ul > li > ul > li').forEach(li => {
        // Verificar si este li corresponde al portafolio seleccionado
        // No tenemos data-port en los li del árbol, así que buscamos por contenido
      });
    }
  };
  el.querySelector('#buscar-est')?.addEventListener('input', refrescar);
  el.querySelector('#fil-port-est')?.addEventListener('change', refrescar);
  el.querySelector('#fil-est-arbol')?.addEventListener('change', refrescar);

  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    const idEdit = e.target.closest('[data-editar]')?.dataset.editar;
    const idAprob = e.target.closest('[data-aprobar]')?.dataset.aprobar;
    const idRech = e.target.closest('[data-rechazar]')?.dataset.rechazar;
    const idEst = e.target.closest('[data-estado]')?.dataset.estado;
    const nuevoEst = e.target.closest('[data-estado]')?.dataset.nuevoEst;
    if (a === 'imprimir') { imprimirPanel(el, 'Estructura de la empresa'); return; }
    const { formularioProyecto } = await import('./proyectos.js');
    if (a === 'nuevo') { await formularioProyecto(); await cargarCatalogo(); await renderPanel(); }
    if (idEdit) { await formularioProyecto(proyectos.find(p => p.id === idEdit)); await cargarCatalogo(); await renderPanel(); }
    if (idAprob) { await cambiarEstadoProy(idAprob, 'activo', { aprobado_por: store.usuario.id, aprobado_at: new Date().toISOString() }); await cargarCatalogo(); await renderPanel(); }
    if (idRech) { await rechazarProyecto(proyectos.find(p => p.id === idRech)); await cargarCatalogo(); await renderPanel(); }
    if (idEst && nuevoEst) { await cambiarEstadoProy(idEst, nuevoEst); await cargarCatalogo(); await renderPanel(); }
  });
}

async function panelPortafolios(el) {
  const { portafolios, programas, proyectos } = await cargarEstructura();
  el.innerHTML = cab('Portafolios', [btn('+ Nuevo portafolio', 'nuevo', 'btn-primario')]) +
    `<p class="admin-sub">Agrupan programas y proyectos de la empresa.</p>` +
    tabla(['CÓDIGO', 'NOMBRE', 'RESPONSABLE', 'PROGRAMAS', 'PROYECTOS', 'ESTADO', ''], portafolios.map(f => [
      `<b>${esc(f.codigo || '—')}</b>`, esc(f.nombre), esc(f.responsable_id ? nombre(f.responsable_id) : '—'),
      programas.filter(g => g.portafolio_id === f.id).length, proyectos.filter(p => p.portafolio_id === f.id).length,
      estadoEst(f.estado),
      `<button class="btn btn-xs" data-editar="${f.id}">Editar</button>
       <button class="btn btn-xs btn-warn" data-estado="${f.id}">${f.estado === 'inactivo' ? 'Activar' : 'Desactivar'}</button>`]));
  el.addEventListener('click', async e => {
    const id = e.target.closest('[data-editar]')?.dataset.editar;
    const idEst = e.target.closest('[data-estado]')?.dataset.estado;
    if (e.target.closest('[data-a="nuevo"]')) { if (await editarNodo('portafolios', null, { portafolios })) renderPanel(); }
    if (id) { if (await editarNodo('portafolios', portafolios.find(x => x.id === id), { portafolios })) renderPanel(); }
    if (idEst) { await cambiarEstadoNodo('portafolios', portafolios.find(x => x.id === idEst)); renderPanel(); }
  });
}

async function panelProgramas(el) {
  const { portafolios, programas, proyectos } = await cargarEstructura();
  const nomPort = id => portafolios.find(x => x.id === id)?.nombre || '—';
  el.innerHTML = cab('Programas', [btn('+ Nuevo programa', 'nuevo', 'btn-primario')]) +
    `<p class="admin-sub">Un programa agrupa proyectos relacionados y pertenece a un portafolio.</p>` +
    tabla(['CÓDIGO', 'NOMBRE', 'PORTAFOLIO', 'RESPONSABLE', 'PROYECTOS', 'ESTADO', ''], programas.map(g => [
      `<b>${esc(g.codigo || '—')}</b>`, esc(g.nombre), esc(nomPort(g.portafolio_id)), esc(g.responsable_id ? nombre(g.responsable_id) : '—'),
      proyectos.filter(p => p.programa_id === g.id).length, estadoEst(g.estado),
      `<button class="btn btn-xs" data-editar="${g.id}">Editar</button>
       <button class="btn btn-xs" data-proyectos="${g.id}">Proyectos…</button>
       <button class="btn btn-xs btn-warn" data-estado="${g.id}">${g.estado === 'inactivo' ? 'Activar' : 'Desactivar'}</button>`]));
  el.addEventListener('click', async e => {
    const id = e.target.closest('[data-editar]')?.dataset.editar;
    const idEst = e.target.closest('[data-estado]')?.dataset.estado;
    const idProy = e.target.closest('[data-proyectos]')?.dataset.proyectos;
    if (e.target.closest('[data-a="nuevo"]')) { if (await editarNodo('programas', null, { portafolios })) renderPanel(); }
    if (id) { if (await editarNodo('programas', programas.find(x => x.id === id), { portafolios })) renderPanel(); }
    if (idEst) { await cambiarEstadoNodo('programas', programas.find(x => x.id === idEst)); renderPanel(); }
    if (idProy) { if (await asignarProyectos(programas.find(x => x.id === idProy), proyectos)) { await cargarCatalogo(); renderPanel(); } }
  });
}

async function editarNodo(tablaNodo, x, { portafolios }) {
  const esProg = tablaNodo === 'programas';
  const responsables = store.perfiles?.length ? store.perfiles : await api.list('profiles', { eq: { activo: true } }).catch(() => []);
  return pedirDatos({
    titulo: x ? `Editar ${esProg ? 'programa' : 'portafolio'}: ${x.nombre}` : esProg ? 'Nuevo programa' : 'Nuevo portafolio',
    valores: x || {},
    campos: [
      { name: 'codigo', label: 'Código' },
      { name: 'nombre', label: 'Nombre', required: true },
      ...(esProg ? [{ name: 'portafolio_id', label: 'Portafolio', type: 'select', required: true,
        options: portafolios.filter(f => f.estado !== 'inactivo' || f.id === x?.portafolio_id).map(f => ({ value: f.id, label: f.nombre })) }] : []),
      { name: 'responsable_id', label: 'Responsable', type: 'select',
        options: responsables.filter(p => p.activo && !p.eliminado && p.rol !== 'pendiente').map(p => ({ value: p.id, label: p.nombre || p.email })) },
      { name: 'descripcion', label: 'Descripción', type: 'textarea', full: true },
    ],
    alGuardar: async d => {
      const datos = { codigo: d.codigo || null, nombre: d.nombre.trim(), descripcion: d.descripcion || null, responsable_id: d.responsable_id || null };
      if (esProg) datos.portafolio_id = d.portafolio_id || null;
      if (x) await api.update(tablaNodo, x.id, datos);
      else await api.insert(tablaNodo, { ...datos, area_id: store.area.id, estado: 'activo' });
      // Los proyectos del programa siguen a su portafolio
      if (esProg && x && x.portafolio_id !== datos.portafolio_id) {
        const ps = await api.list('proyectos', { eq: { programa_id: x.id } });
        for (const p of ps) await api.update('proyectos', p.id, { portafolio_id: datos.portafolio_id });
      }
      ok(esProg ? 'Programa guardado.' : 'Portafolio guardado.');
    },
  });
}

async function cambiarEstadoNodo(tablaNodo, x) {
  if (!x) return;
  const activar = x.estado === 'inactivo';
  const que = tablaNodo === 'programas' ? 'el programa' : 'el portafolio';
  if (!await confirmar(`¿${activar ? 'Activar' : 'Desactivar'} ${que} "${x.nombre}"? ${activar ? '' : 'Sus proyectos no cambian; solo deja de ofrecerse para asignar proyectos nuevos.'}`,
    { titulo: activar ? 'Activar' : 'Desactivar', texto: activar ? 'Activar' : 'Desactivar', peligro: !activar })) return;
  try { await api.update(tablaNodo, x.id, { estado: activar ? 'activo' : 'inactivo' }); ok(activar ? 'Activado.' : 'Desactivado.'); }
  catch (err) { error(mensajeError(err)); }
}

async function asignarProyectos(g, proyectos) {
  if (!g) return null;
  const candidatos = proyectos.filter(p => !['cerrado', 'rechazado'].includes(p.estado) || p.programa_id === g.id);
  return pedirDatos({
    titulo: `Proyectos del programa ${g.nombre}`, texto: 'Guardar',
    antes: 'Marque los proyectos que pertenecen a este programa. Un proyecto marcado aquí deja el programa que tenía antes.',
    valores: { proyectos: proyectos.filter(p => p.programa_id === g.id).map(p => p.id) },
    campos: [{ name: 'proyectos', label: 'Proyectos', type: 'multiselect', full: true,
      options: candidatos.map(p => ({ value: p.id, label: `${p.codigo} · ${p.nombre_corto}` })) }],
    alGuardar: async d => {
      const marcados = new Set(d.proyectos || []);
      for (const p of candidatos) {
        if (marcados.has(p.id) && p.programa_id !== g.id) await api.update('proyectos', p.id, { programa_id: g.id, portafolio_id: g.portafolio_id || null });
        if (!marcados.has(p.id) && p.programa_id === g.id) await api.update('proyectos', p.id, { programa_id: null });
      }
      ok('Proyectos del programa actualizados.');
    },
  });
}

async function cambiarEstadoProy(id, nuevoEstado, extra = {}) {
  try {
    await api.update('proyectos', id, { estado: nuevoEstado, ...extra });
    ok(`Proyecto ${nuevoEstado === 'activo' ? 'activado' : nuevoEstado === 'en_pausa' ? 'pausado' : nuevoEstado}.`);
  } catch (err) { error(mensajeError(err)); }
}

async function rechazarProyecto(p) {
  if (!p) return;
  await pedirDatos({
    titulo: `Rechazar: ${p.codigo}`,
    campos: [{ name: 'motivo', label: 'Motivo del rechazo', required: true }],
    alGuardar: async d => {
      try {
        await api.update('proyectos', p.id, { estado: 'rechazado', motivo_rechazo: d.motivo });
        ok('Proyecto rechazado. El líder recibirá aviso.');
      } catch (err) { error(mensajeError(err)); }
    },
  });
}

function cab(titulo, botones = []) {
  const btns = botones.map(({ texto, accion, clase }) =>
    `<button class="btn btn-sm ${clase || ''}" data-a="${accion}">${texto}</button>`).join('');
  return `<div class="admin-panel-cab"><h2>${titulo}</h2><div class="barra-acciones">${btns}</div></div>`;
}
function btn(texto, accion, clase = '') { return { texto, accion, clase }; }

function tabla(cabeceras, filas) {
  if (!filas.length) return '<div class="aviso info" style="margin-top:12px">Sin registros.</div>';
  return `<div class="tarjeta admin-tabla-wrap"><table class="simple">
    <thead><tr>${cabeceras.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(celdas => `<tr>${celdas.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function imprimirPanel(el, titulo) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { error('El navegador bloqueó la ventana emergente.'); return; }
  const estilos = [...document.styleSheets].map(s => {
    try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch { return ''; }
  }).join('\n');
  const content = el.querySelector?.('.tarjeta, .admin-tabla-wrap, .admin-kpis');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>${estilos}\n@media print{.no-imprimir,.barra-acciones{display:none!important}body{font-size:11pt}}</style>
    </head><body><h2 style="margin-bottom:12px">${esc(titulo)}</h2>${content?.outerHTML || ''}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}
