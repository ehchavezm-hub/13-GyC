// Estructura general: cabecera, navegación lateral y menú de proyectos (6.3), notificaciones y usuario. v1.1
import { api, mensajeError } from '../data/api.js';
import { store, on, esGestor, esStaff, esAdmin, puede, seleccionarProyecto, seleccionarNivel, cargarCatalogo, rol } from '../core/store.js';
import { ROLES } from '../data/catalogos.js';
import { esc, html, normalizar, fmtFechaHora } from '../core/util.js';
import { ir } from '../core/router.js';
import { pedirDatos, ok, error, arrastrable } from './ui.js';

export const NAV = [
  { grupo: 'Administración' },
  { ruta: '/admin', ico: '⚙', texto: 'Administración', si: esAdmin, prefijo: '/admin' },
  { grupo: 'Documentos' },
  { ruta: '/informacion-proyecto', ico: 'ℹ️', texto: 'Información del proyecto', si: esStaff },
  { ruta: '/programa-arranque', ico: '📋', texto: 'Programa de arranque', si: esStaff },
  { ruta: '/lookahead', ico: '🔭', texto: 'Plan de gestión', si: esStaff },
  { ruta: '/backlog', ico: '🗃', texto: 'Plan de construcción', si: esStaff },
  { ruta: '/cartera', ico: '🗂', texto: 'Programa de cierre', si: () => esStaff() || puede('crear_solicitud') },
  { grupo: 'Seguimiento' },
  { ruta: '/tablero', ico: '📊', texto: 'Tablero', si: () => true },   // pedido 173: todos los usuarios ven el Tablero
  { ruta: '/reunion', ico: '👥', texto: 'Reunión semanal', si: esStaff },
  { ruta: '/reportes', ico: '🖨', texto: 'Reportes', si: () => esStaff() || puede('ver_indicadores') },
  { grupo: 'Más' },
  { ruta: '/config/usuarios', ico: '⚙', texto: 'Configuración', si: esGestor, prefijo: '/config' },
];

let filtroProy = '';

export function montarLayout(raiz, { alSalir }) {
  const u = store.usuario;
  const iniciales = (u.codigo || u.nombre || '?').slice(0, 2).toUpperCase();
  raiz.innerHTML = '';
  const app = html(`<div id="app">
    <header class="cabecera">
      <button class="btn-icono btn-menu" data-a="menu" aria-label="Contraer o expandir el menú" title="Contraer / expandir el menú lateral">☰</button>
      <a class="logo" href="#/"><span>Gy<b>C</b></span></a>
      <span class="cab-area">${esc(store.area?.nombre || '')}</span>
      <span class="flex"></span>
      <span class="tam-letra" title="Tamaño de letra y de las filas"><button data-a="letra-normal" aria-label="Letra normal">A</button><button data-a="letra-grande" aria-label="Letra grande">A+</button></span>
      <span class="btn-actualizar"><button class="btn-texto-cab" data-a="actualizar" title="Actualizar la página">Actualizar</button><button class="btn-icono btn-flecha" data-a="actualizar-menu" title="Más opciones de actualización" aria-label="Opciones de actualización">▾</button></span>
      <button class="btn-icono" data-a="notif" title="Notificaciones" aria-label="Notificaciones">🔔<span class="contador oculto"></span></button>
      <button class="usuario-btn" data-a="usuario"><span class="avatar">${esc(iniciales)}</span><span class="nom">${esc(u.nombre)}</span></button>
    </header>
    <aside class="lateral"><div class="lateral-tirador" title="Arrastre para cambiar el ancho del menú (doble clic: ancho normal)"></div>
      <nav class="nav nav-admin" aria-label="Administración"></nav>
      <section class="menu-proy" aria-label="Menú de proyectos">
        <div class="menu-proy-cab"><h3>Proyecto</h3>
          ${esGestor() || puede('crear_cartera') ? `<button class="btn btn-sm btn-primario btn-agregar-proy" data-a="nuevo-proy" title="Agregar un proyecto (lo verá todo el equipo)">＋ ${esGestor() ? 'Agregar' : 'Proponer'}</button>` : ''}</div>
        <input type="search" placeholder="Buscar código o nombre…" aria-label="Buscar proyecto">
        <div class="proy-lista"></div>
      </section>
      <nav class="nav nav-modulos" aria-label="Navegación principal"></nav>
    </aside>
    <main class="contenido" id="contenido" tabindex="-1"></main>
  </div>`);
  raiz.append(app);

  pintarNav();
  pintarProyectos();
  aplicarPreferencias({});
  tiradorLateral(app);
  document.addEventListener('ruta', pintarNav);
  on('catalogo', () => { pintarProyectos(); });
  on('proyecto', () => { pintarProyectos(); pintarNav(); });

  app.querySelector('.menu-proy input').addEventListener('input', e => { filtroProy = e.target.value; pintarProyectos(); });
  app.querySelector('.proy-lista').addEventListener('click', e => {
    // Portafolio o programa: clic en el nombre lo elige (suma todo lo de abajo, pedido Q5); la flecha lo abre o cierra
    const nivel = e.target.closest('[data-nivel]');
    if (nivel && !e.target.closest('.arbol-flecha')) {
      seleccionarNivel(nivel.dataset.nivel);
      document.body.classList.remove('menu-abierto');
      return;
    }
    const r = e.target.closest('[data-rama]');
    if (r && (r.dataset.rama !== 'empresa' || e.target.closest('[data-solo-rama]'))) { alternarRama(r.dataset.rama); return; }
    const it = e.target.closest('.proy-item, .arbol-emp');
    if (it) {
      seleccionarProyecto(it.dataset.id);
      document.body.classList.remove('menu-abierto');
    }
  });

  app.querySelector('.cabecera').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'menu') {
      if (matchMedia('(max-width: 900px)').matches) document.body.classList.toggle('menu-abierto');
      else aplicarPreferencias({ contraido: !preferencias.contraido });
    }
    if (a === 'letra-normal' || a === 'letra-grande') aplicarPreferencias({ letraGrande: a === 'letra-grande' });
    if (a === 'notif') panelNotificaciones();
    if (a === 'usuario') menuUsuario(alSalir);
    if (a === 'actualizar') location.reload();
    if (a === 'actualizar-menu') menuActualizar();
  });
  app.querySelector('[data-a="nuevo-proy"]')?.addEventListener('click', () => import('../views/proyectos.js').then(m => m.formularioProyecto(null, { sub: true })));

  try {
    const previa = sessionStorage.getItem('gyc-recarga-forzada');
    if (previa !== null) {
      sessionStorage.removeItem('gyc-recarga-forzada');
      const actual = versionApp();
      ok(previa === actual ? `Caché vaciada. Ya tenía la última versión publicada (${actual}).` : `Aplicativo actualizado a la versión ${actual}.`);
    }
  } catch { /* opcional */ }

  cargarNotificaciones();
  api.subscribe(['notificaciones'], ev => {
    if (ev.fila?.usuario_id === u.id || ev.anterior?.usuario_id === u.id) cargarNotificaciones();
  });
  const recargar = debounceCatalogo();
  api.subscribe(['lista_valores', 'proyectos', 'portafolios', 'programas'], () => recargar());
  return app.querySelector('#contenido');
}

function debounceCatalogo() {
  let t;
  return () => { clearTimeout(t); t = setTimeout(() => cargarCatalogo().catch(() => {}), 800); };
}

const preferencias = (() => {
  try { return { ancho: 260, contraido: false, letraGrande: false, ...JSON.parse(localStorage.getItem('gyc-vista') || '{}') }; }
  catch { return { ancho: 260, contraido: false, letraGrande: false }; }
})();

function aplicarPreferencias(cambios) {
  Object.assign(preferencias, cambios);
  try { localStorage.setItem('gyc-vista', JSON.stringify(preferencias)); } catch { /* sin almacenamiento */ }
  const app = document.getElementById('app');
  if (app) app.style.setProperty('--lateral', preferencias.contraido ? '60px' : `${preferencias.ancho}px`);
  document.body.classList.toggle('lateral-contraido', !!preferencias.contraido);
  document.documentElement.classList.toggle('letra-grande', !!preferencias.letraGrande);
  document.querySelectorAll('.tam-letra button').forEach(b => b.classList.toggle('activo', (b.dataset.a === 'letra-grande') === !!preferencias.letraGrande));
  clearTimeout(aplicarPreferencias.t);
  aplicarPreferencias.t = setTimeout(() => (window.Tabulator?.findTable?.('.tabulator') || []).forEach(t => t.redraw(true)), 80);
}

function tiradorLateral(app) {
  const tirador = app.querySelector('.lateral-tirador');
  tirador.addEventListener('dblclick', () => aplicarPreferencias({ ancho: 260, contraido: false }));
  tirador.addEventListener('mousedown', e => {
    e.preventDefault();
    const x0 = e.clientX, a0 = preferencias.contraido ? 60 : preferencias.ancho;
    document.body.classList.add('arrastrando-lateral');
    const mover = ev => {
      const ancho = Math.round(Math.min(460, Math.max(60, a0 + ev.clientX - x0)));
      aplicarPreferencias(ancho < 150 ? { contraido: true } : { contraido: false, ancho });
    };
    const soltar = () => { document.body.classList.remove('arrastrando-lateral'); removeEventListener('mousemove', mover); removeEventListener('mouseup', soltar); };
    addEventListener('mousemove', mover); addEventListener('mouseup', soltar);
  });
}

function pintarNav() {
  const navAdmin = document.querySelector('.nav-admin'), navModulos = document.querySelector('.nav-modulos');
  if (!navAdmin || !navModulos) return;
  const actual = location.hash.replace(/^#/, '').split('?')[0];
  const pintar = lista => lista.filter(n => n.grupo || n.si()).map(n => n.grupo
    ? `<div class="nav-grupo">${esc(n.grupo)}</div>`
    : `<a href="#${n.ruta}" title="${esc(n.texto)}" class="${actual === n.ruta || actual.startsWith((n.prefijo || n.ruta) + '/') ? 'activo' : ''}"><span class="ico">${n.ico}</span><span class="txt">${esc(n.texto)}</span></a>`).join('');
  // Administración arriba, luego el árbol PROYECTOS y después los módulos (pedido q6)
  const corte = NAV.findIndex((n, i) => i > 0 && n.grupo);
  const admin = NAV.slice(0, corte);
  navAdmin.innerHTML = admin.some(n => !n.grupo && n.si()) ? pintar(admin) : '';
  navAdmin.classList.toggle('oculto', !navAdmin.innerHTML);
  // s10: nombre del proyecto activo como cabecera de los módulos
  const proyActivo = store.proyectoSel ? store.proyectos.find(p => p.id === store.proyectoSel) : null;
  const cabProy = proyActivo
    ? `<div class="nav-proy-activo" title="${esc(proyActivo.nombre_completo || proyActivo.nombre_corto)}"><span class="ico">📋</span><span class="txt"><b>${esc(proyActivo.codigo || '')}</b>${proyActivo.codigo ? ' · ' : ''}${esc(proyActivo.nombre_corto)}</span></div>`
    : '';
  navModulos.innerHTML = cabProy + pintar(NAV.slice(corte));
  for (const nav of [navAdmin, navModulos]) nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('menu-abierto')));
}

// Ramas contraídas del árbol de proyectos (por computadora)
const contraidosProy = (() => { try { return new Set(JSON.parse(localStorage.getItem('gyc-arbol-proy') || '[]')); } catch { return new Set(); } })();
function alternarRama(clave) {
  contraidosProy.has(clave) ? contraidosProy.delete(clave) : contraidosProy.add(clave);
  try { localStorage.setItem('gyc-arbol-proy', JSON.stringify([...contraidosProy])); } catch { /* opcional */ }
  pintarProyectos();
}

// Menú de proyectos en árbol: Empresa → Portafolio → Programa → Proyecto
function pintarProyectos() {
  const cont = document.querySelector('.proy-lista');
  if (!cont) return;
  let lista = store.proyectos.filter(p => p.estado === 'activo' || (p.estado === 'propuesto' && esStaff()));
  const f = normalizar(filtroProy);
  if (f) lista = lista.filter(p => normalizar(p.codigo + ' ' + p.nombre_corto + ' ' + (p.nombre_completo || '')).includes(f));
  // Con búsqueda solo se muestran las ramas que tienen proyectos (y se abren)
  const soloConProyectos = !!f;
  const abierta = clave => soloConProyectos || !contraidosProy.has(clave);
  const portafolios = (store.portafolios || []).filter(x => x.estado !== 'inactivo');
  const programas = (store.programas || []).filter(x => x.estado !== 'inactivo');
  const idsPort = new Set(portafolios.map(x => x.id)), idsProg = new Set(programas.map(x => x.id));

  const item = (p, nivel, sub) => `<div class="proy-item arbol-n${nivel}${sub ? ' arbol-sub' : ''}${store.proyectoSel === p.id ? ` activo${p.padre_id ? ' grupo-activo' : ''}` : ''}" data-id="${p.id}" title="${esc(`${p.codigo} · ${p.nombre_completo || p.nombre_corto}${sub ? ' (Subproyecto)' : ''}`)}">
      <span class="arbol-ico">${sub ? '▫' : '📋'}</span><span class="nom">${esc(p.nombre_corto)}${p.estado === 'propuesto' ? ' ⏳' : ''}</span></div>`;
  // Proyecto con subproyectos (pedido a7): se elige completo con un clic en el nombre; la flecha lo abre o cierra
  const hijosDe = p => lista.filter(x => x.padre_id === p.id);
  const nodo = (p, nivel) => {
    const hs = hijosDe(p);
    if (!hs.length) return item(p, nivel);
    const ab = abierta('p' + p.id);
    return `<div class="proy-item arbol-cont arbol-n${nivel}${store.proyectoSel === p.id ? ' activo' : ''}" data-id="${p.id}" title="${esc(`${p.codigo} · ${p.nombre_completo || p.nombre_corto} (con sus subproyectos)`)}">
        <span class="arbol-flecha" data-rama="p${p.id}" role="button" aria-expanded="${ab}">${ab ? '▾' : '▸'}</span><span class="arbol-ico">📋</span>
        <span class="nom">${esc(p.nombre_corto)} <small>(${hs.length})</small></span></div>` + (ab ? hs.map(h => item(h, nivel + 1, true)).join('') : '');
  };

  const raiz = arr => arr.filter(p => !p.padre_id || !lista.some(x => x.id === p.padre_id));
  const rama = (clave, nivel, ico, nombre, codigo, n, hijos, clase) => {
    if (soloConProyectos && !n) return '';
    const ab = abierta(clave);
    const nivelSel = clave[0] + ':' + clave.slice(1);   // 'f<id>' → 'f:<id>'
    return `<div class="arbol-rama arbol-n${nivel} ${clase}${store.nivelSel === nivelSel ? ' activo' : ''}" data-rama="${clave}" data-nivel="${nivelSel}" role="button" aria-expanded="${ab}" title="${esc(nombre)}: clic para ver todo lo que contiene; la flecha lo abre o cierra">
        <span class="arbol-flecha">${ab ? '▾' : '▸'}</span><span class="arbol-ico">${ico}</span>
        <span class="nom">${esc(nombre)} <small>(${n})</small></span><span class="cod">${esc(codigo || '')}</span></div>
      ${ab ? (hijos || `<div class="arbol-vacio arbol-n${nivel + 1}">Sin contenido</div>`) : ''}`;
  };
  const deProg = g => lista.filter(p => p.programa_id === g.id);
  const ramaProg = (g, nivel) => { const ps = deProg(g); return rama('g' + g.id, nivel, '📁', g.nombre, g.codigo, ps.length, raiz(ps).map(p => nodo(p, nivel + 1)).join(''), 'arbol-prog'); };
  const ramasPort = portafolios.map(fp => {
    const gs = programas.filter(g => g.portafolio_id === fp.id);
    const directos = lista.filter(p => p.portafolio_id === fp.id && !idsProg.has(p.programa_id));
    const n = gs.reduce((s, g) => s + deProg(g).length, 0) + directos.length;
    return rama('f' + fp.id, 1, '🗂', fp.nombre, fp.codigo, n, gs.map(g => ramaProg(g, 2)).join('') + raiz(directos).map(p => nodo(p, 2)).join(''), 'arbol-port');
  }).join('');
  const progSueltos = programas.filter(g => !idsPort.has(g.portafolio_id)).map(g => ramaProg(g, 1)).join('');
  const sueltos = raiz(lista.filter(p => !idsPort.has(p.portafolio_id) && !idsProg.has(p.programa_id))).map(p => nodo(p, 1)).join('');
  const cuerpo = ramasPort + progSueltos + sueltos;
  const empresa = store.area?.nombre || 'Empresa';
  const abiertaEmp = abierta('empresa');
  cont.innerHTML = `<div class="arbol-rama arbol-n0 arbol-emp proy-todos${!store.proyectoSel && !store.nivelSel ? ' activo' : ''}" data-rama="empresa" data-id="" role="button" aria-expanded="${abiertaEmp}"
      title="Todos los proyectos de ${esc(empresa)}"><span class="arbol-flecha" data-solo-rama>${abiertaEmp ? '▾' : '▸'}</span><span class="arbol-ico">🏢</span>
      <span class="nom">${esc(empresa)} <small>· todos (${lista.length})</small></span></div>` +
    (abiertaEmp ? (cuerpo || `<p class="nota" style="padding:8px">${f ? 'Sin resultados.' : 'Sin proyectos.'}</p>`) : '');
}

async function cargarNotificaciones() {
  try {
    store.notificaciones = await api.list('notificaciones', { eq: { usuario_id: store.usuario.id }, order: [['created_at', false]], limit: 50 });
  } catch { store.notificaciones = []; }
  const n = store.notificaciones.filter(x => !x.leida).length;
  const c = document.querySelector('.cabecera .contador');
  if (c) { c.textContent = n > 99 ? '99+' : n; c.classList.toggle('oculto', !n); }
}

function menuActualizar() {
  if (document.querySelector('.menu-actualizar')) return cerrarFlotantes();
  cerrarFlotantes();
  const m = html(`<div class="menu-usuario menu-actualizar">
    <button data-op="normal">↳ Actualizar página</button>
    <button data-op="forzado">🧹 Vaciar caché y volver a cargar de manera forzada</button></div>`);
  const r = document.querySelector('[data-a="actualizar-menu"]').getBoundingClientRect();
  m.style.right = Math.max(8, innerWidth - r.right) + 'px';
  document.body.append(m);
  m.addEventListener('click', async e => {
    const op = e.target.closest('[data-op]')?.dataset.op;
    if (op === 'normal') location.reload();
    if (op === 'forzado') await recargaForzada();
  });
  setTimeout(() => document.addEventListener('click', function f(e) {
    if (!e.target.closest('.menu-actualizar,[data-a="actualizar-menu"]')) { cerrarFlotantes(); document.removeEventListener('click', f); }
  }), 0);
}

export function versionApp() { return window.GYC_VERSION || 'local'; }

export async function recargaForzada() {
  cerrarFlotantes();
  const aviso = html('<div class="recarga-forzada"><div><span class="spinner"></span> Vaciando caché y descargando la última versión…</div></div>');
  document.body.append(aviso);
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map(r => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    const base = new URL('./', location.href).href;
    const archivos = new Set([base, base + 'index.html', base + 'config.js', base + 'sw.js']);
    for (const r of performance.getEntriesByType('resource')) {
      const u = new URL(r.name);
      if (u.href.startsWith(base) && !u.pathname.includes('/rest/v1/')) archivos.add(u.origin + u.pathname);
    }
    await Promise.all([...archivos].map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
  } catch { /* si algo falla, igual se recarga */ }
  try { sessionStorage.setItem('gyc-recarga-forzada', versionApp()); } catch { /* opcional */ }
  location.reload();
}

function cerrarFlotantes() { document.querySelectorAll('.panel-notif,.menu-usuario,.menu-actualizar').forEach(x => x.remove()); }

function panelNotificaciones() {
  if (document.querySelector('.panel-notif')) return cerrarFlotantes();
  cerrarFlotantes();
  const p = html(`<div class="panel-notif" role="dialog" aria-label="Notificaciones">
    <div class="notif-cab" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--borde)">
      <b>Notificaciones</b><button class="btn btn-sm" data-a="todas">Marcar todas como leídas</button></div>
    ${store.notificaciones.length ? store.notificaciones.map(n => `<div class="item${n.leida ? '' : ' no-leida'}" data-id="${n.id}" data-ruta="${esc(n.ruta || '')}">
      ${esc(n.texto)}<small>${fmtFechaHora(n.created_at)}</small></div>`).join('') : '<p class="nota" style="padding:14px">Sin notificaciones.</p>'}</div>`);
  document.body.append(p);
  arrastrable(p, p.querySelector('.notif-cab'));
  p.addEventListener('click', async e => {
    if (e.target.closest('[data-a="todas"]')) {
      await Promise.all(store.notificaciones.filter(n => !n.leida).map(n => api.update('notificaciones', n.id, { leida: true }).catch(() => {})));
      await cargarNotificaciones(); cerrarFlotantes(); return;
    }
    const it = e.target.closest('.item');
    if (!it) return;
    api.update('notificaciones', it.dataset.id, { leida: true }).then(cargarNotificaciones).catch(() => {});
    cerrarFlotantes();
    if (it.dataset.ruta) location.hash = it.dataset.ruta;
  });
  setTimeout(() => document.addEventListener('click', function f(e) {
    if (!e.target.closest('.panel-notif,[data-a="notif"]')) { cerrarFlotantes(); document.removeEventListener('click', f); }
  }), 0);
}

// Usuarios de varias empresas (030): elegir con qué empresa trabajar. El rol es el que tiene en cada una.
async function cambiarDeEmpresa() {
  let r;
  try { r = await api.adminUsuarios('mis_empresas'); } catch (e) { error(mensajeError(e)); return; }
  const empresas = (r?.empresas || []).filter(x => x.activa);
  if (empresas.length < 2) { ok('Usted pertenece a una sola empresa.'); return; }
  await pedirDatos({
    titulo: 'Cambiar de empresa', texto: 'Cambiar',
    antes: 'Trabajará con los proyectos, el equipo y la configuración de la empresa elegida. Puede volver cuando quiera desde este mismo menú.',
    valores: { area_id: r.actual },
    campos: [{ name: 'area_id', label: 'Empresa', type: 'select', required: true, full: true,
      options: empresas.map(x => ({ value: x.id, label: `${x.nombre} · ${ROLES[x.rol] || x.rol}${x.id === r.actual ? ' (actual)' : ''}` })) }],
    alGuardar: async d => {
      if (d.area_id === r.actual) return;
      await api.adminUsuarios('cambiar_empresa', { area_id: d.area_id });
      try { localStorage.removeItem('gyc-proyecto'); localStorage.removeItem('gyc-nivel'); } catch { /* opcional */ }
      location.hash = '#/';
      location.reload();
    },
  });
}

function menuUsuario(alSalir) {
  if (document.querySelector('.menu-usuario')) return cerrarFlotantes();
  cerrarFlotantes();
  const u = store.usuario;
  const m = html(`<div class="menu-usuario">
    <div style="padding:8px 10px"><b>${esc(u.nombre)}</b><div class="nota">${esc(u.email || '')}</div><div class="nota">${esc(ROLES[rol()] || rol())}</div></div>
    <hr style="border:none;border-top:1px solid var(--borde)">
    <button data-a="perfil">Mi perfil</button>
    ${(store.misEmpresas || []).length > 1 && !u.es_plataforma ? '<button data-a="empresa">🏢 Cambiar de empresa</button>' : ''}
    <button data-a="clave">Cambiar contraseña</button>
    <button data-a="salir">Cerrar sesión</button>
    <div class="nota" style="padding:6px 10px 2px;border-top:1px solid var(--borde);margin-top:4px">Versión ${esc(versionApp())}</div></div>`);
  document.body.append(m);
  m.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    cerrarFlotantes();
    if (a === 'salir') alSalir();
    if (a === 'empresa') await cambiarDeEmpresa();
    if (a === 'perfil') {
      await pedirDatos({
        titulo: 'Mi perfil', valores: u,
        campos: [
          { name: 'nombre', label: 'Nombre', required: true },
          { name: 'codigo', label: 'Código corto (iniciales)' },
          { name: 'horas_dia', label: 'Horas disponibles por día', type: 'number', min: 0, max: 24, step: 0.5, help: 'Para la capacidad semanal. Vacío = valor del área.' },
        ],
        alGuardar: async d => { Object.assign(store.usuario, await api.update('profiles', u.id, d)); ok('Perfil actualizado.'); },
      });
    }
    if (a === 'clave') {
      await pedirDatos({
        titulo: 'Cambiar contraseña',
        campos: [{ name: 'p0', label: 'Contraseña actual', type: 'password', required: true },
          { name: 'p1', label: 'Nueva contraseña', type: 'password', required: true }, { name: 'p2', label: 'Repetir contraseña', type: 'password', required: true }],
        alGuardar: async d => {
          if (d.p1.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
          if (d.p1 !== d.p2) throw new Error('Las contraseñas no coinciden.');
          await api.auth.cambiarClave(d.p1, d.p0); ok('Contraseña actualizada.');
        },
      });
    }
  });
  setTimeout(() => document.addEventListener('click', function f(e) {
    if (!e.target.closest('.menu-usuario,[data-a="usuario"]')) { cerrarFlotantes(); document.removeEventListener('click', f); }
  }), 0);
}

export function irA(hash) { ir(hash); }
