// Configuración (6.1, 6.2): usuarios y roles, listas configurables, parámetros, matriz de permisos,
// columnas personalizadas, importación desde Excel, respaldo y auditoría.
import { imprimirPDF, nombreArchivo } from '../services/pdf.js';
import { leerDemo as leerDatosDemo } from '../services/traer-demo.js';
const hayDatosDemo = () => !!leerDatosDemo();
import { medir } from '../core/monitoreo.js';
import { api, mensajeError, modoDemo } from '../data/api.js';
import { store, on, cargarCatalogo, esAdmin, esSuperadmin, esGestor, puede, opciones, opcionesProyectos, nombre, valoresLista, configLookAhead, diasReunion, diasCierre } from '../core/store.js';
import { ACCIONES, ROLES, PARAMETROS_INICIALES, PLANIFICADORES, COLOR_ROL, GRUPOS_LISTAS, grupoDeLista, LISTAS_RETIRADAS } from '../data/catalogos.js';
import { esc, html, fmtFechaHora, fmtFecha, normalizar, libExcel } from '../core/util.js';
import { ir } from '../core/router.js';
import { crearGrilla } from '../ui/grid.js';
import { ok, error, confirmar, pedirDatos, modal, badge, toast } from '../ui/ui.js';
import { leerLibro, analizar, importar, sugerirUsuario, sugerirProyecto } from '../services/importar.js';

const SECCIONES = [
  ['empresas', '🏢 Empresas', () => !!store.usuario?.es_plataforma],   // solo el administrador de la plataforma
  ['usuarios', '👤 Usuarios y roles'], ['listas', '📋 Listas'], ['parametros', '🔧 Parámetros'], ['permisos', '🔐 Permisos'],
  ['columnas', '▥ Columnas personalizadas'], ['importar', '⬆ Importar Excel'], ['respaldo', '💾 Respaldo'], ['auditoria', '🕑 Auditoría'],
];
let grilla;

export async function render(el, { seccion, query }) {
  desmontarOrg?.();
  grilla?.destruir(); grilla = null;
  catalogoProyectos?.destruir(); catalogoProyectos = null;
  dejarCatalogo?.();
  dejarCatalogo = on('catalogo', () => grilla?.refrescar());
  el.innerHTML = '';
  el.append(html(`<div><div class="pagina-cab"><h1>Configuración</h1></div>
    <div class="pestanas" style="margin-bottom:14px;flex-wrap:wrap">${SECCIONES.filter(([, , si]) => !si || si()).map(([k, t]) => `<button data-s="${k}" class="${k === seccion ? 'activo' : ''}">${t}</button>`).join('')}</div>
    <div data-sec></div></div>`));
  el.querySelector('.pestanas').addEventListener('click', e => { const s = e.target.closest('[data-s]')?.dataset.s; if (s) ir('#/config/' + s); });
  const cont = el.querySelector('[data-sec]');
  const f = { empresas: store.usuario?.es_plataforma ? empresas : null, usuarios, listas, parametros, permisos, columnas, importar: importarVista, respaldo, auditoria }[seccion];
  if (f) await f(cont, query?.get('lista') || undefined); else cont.textContent = 'Sección no encontrada.';
}
/** Secciones de Configuración que también se muestran dentro de la consola de Administración. */
export async function seccionConfig(nombre, el) {
  destruir();
  const f = { empresas: store.usuario?.es_plataforma ? empresas : null, usuarios, listas, parametros, permisos, auditoria }[nombre];
  if (f) await f(el); else el.textContent = 'Sección no disponible.';
}
export function destruir() { desmontarOrg?.(); grilla?.destruir(); grilla = null; dejarCatalogo?.(); dejarCatalogo = null; catalogoProyectos?.destruir(); catalogoProyectos = null; }
let catalogoProyectos = null;
let desmontarOrg = null;        // organigrama del equipo (Usuarios y roles)   // módulo de Proyectos cuando se muestra dentro de Listas
// Cuando cambian los proyectos o las listas (aquí, en otra pestaña u otro usuario), la grilla abierta se actualiza sola
let dejarCatalogo = null;

// ---------- Usuarios ----------
async function usuarios(el) {
  // Los eliminados con historial se conservan solo como nombre en los registros pasados
  const [todos, historial, miembros] = await Promise.all([
    api.list('profiles', { order: [['nombre', true]] }),
    api.list('delegado_historial', { eq: { area_id: store.area.id }, order: [['desde', false]] }).catch(() => []),
    api.list('empresa_miembros', { eq: { area_id: store.area.id } }).catch(() => [])]);
  // Personas de esta empresa: con ella como empresa activa o como miembros que hoy trabajan en otra (030)
  const deAqui = new Map(miembros.filter(m => m.activo !== false).map(m => [m.usuario_id, m]));
  const perfiles = todos.filter(p => !p.eliminado && (p.area_id === store.area.id || deAqui.has(p.id))).map(p => p.area_id === store.area.id ? p
    : { ...p, rol: deAqui.get(p.id).rol, activo: deAqui.get(p.id).activo, es_admin_principal: deAqui.get(p.id).es_admin_principal, _otraEmpresa: true });
  const pendientes = perfiles.filter(p => p.rol === 'pendiente' && p.activo);
  const principal = esSuperadmin();
  el.innerHTML = `
    ${pendientes.length ? `<div class="aviso warn"><b>${pendientes.length} usuario(s) esperan aprobación.</b> Asígneles un rol para que puedan ingresar.</div>` : ''}
    <div class="tarjeta" style="margin-bottom:12px">
      <div class="barra" style="margin-bottom:10px"><h2 style="margin:0">Usuarios</h2><span class="flex"></span>
        ${principal ? '<button class="btn btn-sm btn-azul" data-a="delegado">⭐ Asignar / rotar administrador delegado</button>' : ''}
        <button class="btn btn-sm btn-primario" data-a="nuevo">＋ Nuevo usuario</button>
        <button class="btn btn-sm" data-a="invitar" title="Enlace para que la persona se registre sola">✉ Invitar</button>
        <button class="btn btn-sm" data-a="pdf-usuarios" title="Usuarios y roles con el organigrama">🖨 PDF</button></div>
      <table class="simple"><tr><th>Nombre</th><th>Código</th><th>Cargo</th><th>Correo</th><th>Rol</th><th>Gerencias (consulta)</th><th class="num">H/día</th><th>Estado</th><th></th></tr>
      ${perfiles.map(p => `<tr><td><b>${esc(p.nombre)}</b>${p.es_admin_principal ? ' ' + badge('Principal', '#E8762B') : ''}${p._otraEmpresa ? `<br><small class="nota" title="Pertenece a varias empresas. Su rol en esta empresa lo cambia un propietario en Administración › Plataforma › Empresas › Gestionar.">Hoy trabaja en otra empresa</small>` : ''}</td><td>${esc(p.codigo || '')}</td><td>${esc(p.cargo_id ? store.valores.get(p.cargo_id)?.valor || '' : '')}</td><td>${esc(p.email || '')}</td>
        <td>${badge(ROLES[p.rol] || p.rol, COLOR_ROL[p.rol])}</td>
        <td>${esc((p.gerencia_ids || []).map(g => store.valores.get(g)?.codigo || '').join(', '))}</td><td class="num">${p.horas_dia ?? '—'}</td>
        <td>${p.activo ? 'Activo' : '<span style="color:var(--rojo)">Inactivo</span>'}</td>
        <td style="white-space:nowrap">${p._otraEmpresa ? '' : `<button class="btn btn-sm" data-editar="${p.id}">Editar</button>`}
          ${puedeRestablecer(p) && !p._otraEmpresa ? `<button class="btn btn-sm" data-clave="${p.id}" title="Restablecer contraseña">🔑</button>` : ''}
          ${puedeEliminar(p) ? `<button class="btn btn-sm" data-eliminar="${p.id}" title="Eliminar usuario">🗑</button>` : ''}</td></tr>`).join('')}</table></div>
    <div data-organigrama style="margin-bottom:12px"></div>
    <details class="tarjeta"><summary><b>Historial del administrador delegado</b></summary>
      <table class="simple" style="margin-top:8px"><tr><th>Persona</th><th>Desde</th><th>Hasta</th><th>Otorgado por</th></tr>
      ${historial.map(h => `<tr><td>${esc(nombre(h.usuario_id))}</td><td>${fmtFechaHora(h.desde)}</td><td>${h.hasta ? fmtFechaHora(h.hasta) : 'Vigente'}</td><td>${esc(nombre(h.otorgado_por))}</td></tr>`).join('') || '<tr><td colspan="4" class="nota">Sin registros.</td></tr>'}</table></details>`;
  import('./organigrama.js').then(m => { desmontarOrg = m.desmontarOrganigrama; return m.montarOrganigrama(el.querySelector('[data-organigrama]')); });
  el.addEventListener('click', async e => {
    const id = e.target.closest('[data-editar]')?.dataset.editar;
    const idClave = e.target.closest('[data-clave]')?.dataset.clave;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'pdf-usuarios') {
      const m = await import('./organigrama.js');
      const nodos = await api.list('organigrama_nodos', { eq: { area_id: store.area.id }, order: [['orden', true]] });
      return imprimirPDF('Usuarios y roles', m.informeEquipo(nodos), { proyectoTexto: store.area.nombre || 'Todos los proyectos', orientacion: 'landscape' });
    }
    if (id) await editarUsuario(perfiles.find(p => p.id === id));
    if (idClave) await restablecerClave(perfiles.find(p => p.id === idClave));
    const idEliminar = e.target.closest('[data-eliminar]')?.dataset.eliminar;
    if (idEliminar) await eliminarUsuario(perfiles.find(p => p.id === idEliminar));
    if (a === 'nuevo') await nuevoUsuario();
    if (a === 'invitar') {
      const url = location.origin + location.pathname;
      modal({ titulo: 'Invitar usuarios', ancho: 560, cuerpo: `<p>Envíe este enlace a las personas que deben usar LPS-GES. Al registrarse quedan <b>pendientes</b> y usted les asigna el rol aquí.</p>
        <p><input class="inp" style="width:100%" readonly value="${esc(url)}"></p>
        <p class="nota">También puede crear la cuenta usted mismo con "＋ Nuevo usuario" y entregarle una contraseña temporal.</p>`,
        botones: [{ texto: 'Copiar enlace', clase: 'btn-primario', accion: async () => { await navigator.clipboard?.writeText(url).catch(() => {}); ok('Enlace copiado.'); } }] });
    }
    if (a === 'delegado') await rotarDelegado(perfiles);
  });
}

// Contraseña temporal legible (sin caracteres que se confunden: 0/O, 1/l/I)
function generarClave() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const n = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(n, x => c[x % c.length]).join('');
}

function puedeRestablecer(p) {
  const yo = store.usuario;
  if (p.id === yo.id) return false;   // la propia se cambia desde el menú de usuario
  if (p.es_admin_principal) return false;
  return esSuperadmin() || !['superadmin', 'admin', 'delegado'].includes(p.rol);
}

// Administradores con permiso (no el delegado); nunca a sí mismo ni al principal; a un administrador solo el super administrador
function puedeEliminar(p) {
  return esAdmin() && p.id !== store.usuario.id && !p.es_admin_principal &&
    (esSuperadmin() || !['superadmin', 'admin'].includes(p.rol));
}

async function eliminarUsuario(p) {
  const si = await confirmar(`¿Eliminar a ${p.nombre}${p.email ? ` (${p.email})` : ''}? Perderá el acceso de inmediato. ` +
    'Si ya registró actividades, cierres u otros datos, su nombre se mantiene en esos registros históricos (para no alterar el PAC), ' +
    'pero deja de aparecer en las listas. Su correo queda libre para volver a crearlo si hiciera falta. Esta acción no se puede deshacer.',
    { titulo: 'Eliminar usuario', texto: 'Eliminar', peligro: true });
  if (!si) return;
  try {
    const r = await api.rpc('eliminar_usuario', { p_usuario: p.id });
    ok(r === 'eliminado' ? `${p.nombre} fue eliminado.` : r === 'retirado' ? `${p.nombre} ya no pertenece a esta empresa (su cuenta y sus otras empresas siguen).`
      : `${p.nombre} fue eliminado; su nombre se conserva en el historial.`);
  } catch (e) { error(mensajeError(e)); }
  await cargarCatalogo();
  render(document.getElementById('contenido'), { seccion: 'usuarios' });
}

function mostrarCredenciales(titulo, email, clave) {
  const texto = `LPS-GES\nEnlace: ${location.origin + location.pathname}\nUsuario: ${email}\nContraseña temporal: ${clave}\n(Se le pedirá cambiarla al ingresar)`;
  modal({
    titulo, ancho: 520,
    cuerpo: `<p>Entregue estos datos a la persona por un medio privado. Al ingresar se le pedirá definir su propia contraseña.</p>
      <pre class="credenciales">${esc(texto)}</pre>`,
    botones: [{ texto: 'Cerrar' }, { texto: 'Copiar', clase: 'btn-primario', accion: async () => {
      await navigator.clipboard?.writeText(texto).catch(() => {}); ok('Datos copiados.'); return false; } }],
  });
}

async function nuevoUsuario() {
  const principal = esSuperadmin();
  const roles = Object.entries(ROLES).filter(([k]) => k !== 'pendiente' && (principal || !['superadmin', 'admin', 'delegado'].includes(k)));
  let creado = null;
  await pedirDatos({
    titulo: 'Nuevo usuario', texto: 'Crear usuario',
    valores: { rol: 'lider', clave: generarClave() },
    campos: [
      { name: 'nombre', label: 'Nombre y apellido', required: true },
      { name: 'email', label: 'Correo (usuario de ingreso)', type: 'email', required: true },
      { name: 'cargo_id', label: 'Cargo', type: 'select', options: opciones('cargos'), help: 'Lista editable en Configuración → Listas → Cargos' },
      { name: 'codigo', label: 'Código corto (iniciales)' },
      { name: 'rol', label: 'Rol', type: 'select', required: true, options: roles.map(([value, label]) => ({ value, label })) },
      { name: 'clave', label: 'Contraseña temporal (mínimo 8)', required: true, help: 'Se generó una al azar; puede cambiarla. La persona la cambiará al ingresar.' },
      { name: 'horas_dia', label: 'Horas disponibles por día', type: 'number', min: 0, max: 24, step: 0.5, help: 'Vacío = valor general del área' },
      { name: 'gerencia_ids', label: 'Gerencias visibles (solo usuarios de consulta)', type: 'multiselect', unaColumna: true, options: opciones('gerencias', { vacio: false }) },
    ],
    alGuardar: async d => {
      if (String(d.clave).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      await api.adminUsuarios('crear', d);
      creado = d;
    },
  });
  if (!creado) return;
  await cargarCatalogo();
  await render(document.getElementById('contenido'), { seccion: 'usuarios' });
  mostrarCredenciales(`Usuario creado: ${creado.nombre}`, creado.email.trim().toLowerCase(), creado.clave);
}

async function restablecerClave(p) {
  let hecho = null;
  await pedirDatos({
    titulo: `Restablecer contraseña: ${p.nombre}`, texto: 'Restablecer',
    antes: 'La contraseña actual dejará de funcionar. Se le pedirá cambiar la nueva al ingresar.',
    valores: { clave: generarClave() },
    campos: [{ name: 'clave', label: 'Nueva contraseña temporal (mínimo 8)', required: true, full: true }],
    alGuardar: async d => {
      if (String(d.clave).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      await api.adminUsuarios('clave', { usuario_id: p.id, clave: d.clave });
      hecho = d.clave;
    },
  });
  if (hecho) mostrarCredenciales(`Contraseña restablecida: ${p.nombre}`, p.email || '', hecho);
}

async function editarUsuario(p) {
  const principal = esSuperadmin();
  const roles = Object.entries(ROLES).filter(([k]) => principal || !['superadmin', 'admin', 'delegado'].includes(k) || k === p.rol);
  await pedirDatos({
    titulo: `Usuario: ${p.nombre}`, valores: p,
    campos: [
      { name: 'nombre', label: 'Nombre', required: true }, { name: 'codigo', label: 'Código corto' },
      { name: 'cargo_id', label: 'Cargo', type: 'select', options: opciones('cargos'), help: 'Lista editable en Configuración → Listas → Cargos' },
      { name: 'rol', label: 'Rol', type: 'select', options: roles.map(([value, label]) => ({ value, label })),
        help: principal ? '' : 'Solo el super administrador asigna los roles de super administrador, administrador y delegado.' },
      { name: 'horas_dia', label: 'Horas disponibles por día', type: 'number', min: 0, max: 24, step: 0.5, help: 'Vacío = valor general del área' },
      { name: 'gerencia_ids', label: 'Gerencias visibles (solo usuarios de consulta)', type: 'multiselect', unaColumna: true, options: opciones('gerencias', { vacio: false }) },
      { name: 'activo', label: 'Estado', type: 'checkbox', texto: 'Activo (desmarque para bloquear el acceso sin perder su historial)' },
    ],
    alGuardar: async d => {
      if (p.es_admin_principal && (d.rol !== p.rol || !d.activo)) throw new Error('El administrador principal no puede perder su rol ni desactivarse.');
      await api.update('profiles', p.id, d);
      ok('Usuario actualizado.');
    },
  });
  await cargarCatalogo();
  render(document.getElementById('contenido'), { seccion: 'usuarios' });
}

async function rotarDelegado(perfiles) {
  const actuales = perfiles.filter(p => p.rol === 'delegado');
  const cands = perfiles.filter(p => ['delegado', ...PLANIFICADORES].includes(p.rol) && p.activo);
  const d = await pedirDatos({
    titulo: 'Administrador delegado', texto: 'Asignar',
    antes: `Delegado actual: <b>${esc(actuales.map(a => a.nombre).join(', ') || 'ninguno')}</b>. El anterior vuelve a ser ${esc(ROLES.lider.toLowerCase())}; el cambio queda en el historial.`,
    campos: [{ name: 'nuevo', label: 'Nuevo delegado', type: 'select', options: [{ value: '', label: '— Ninguno (retirar) —' }, ...cands.map(p => ({ value: p.id, label: p.nombre }))] }],
  });
  if (!d) return;
  try {
    for (const a of actuales) if (a.id !== d.nuevo) await api.update('profiles', a.id, { rol: 'lider' });
    if (d.nuevo && !actuales.some(a => a.id === d.nuevo)) await api.update('profiles', d.nuevo, { rol: 'delegado' });
    ok('Administrador delegado actualizado.');
  } catch (e) { error(mensajeError(e)); }
  await cargarCatalogo();
  render(document.getElementById('contenido'), { seccion: 'usuarios' });
}

// ---------- Listas configurables ----------
async function listas(el, claveSel) {
  const todas = Object.values(store.listas).map(x => x.lista).filter(l => !LISTAS_RETIRADAS.includes(l.clave)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const sel = claveSel || todas.find(l => l.clave === 'gerencias')?.clave || todas[0]?.clave;
  const editable = esGestor();
  // Grupos: los iniciales en su orden, luego los creados por el usuario y al final "Otras listas"
  const grupos = [...new Set([...GRUPOS_LISTAS.slice(0, 3), ...todas.map(grupoDeLista).sort(), GRUPOS_LISTAS[3]])];
  const opcionesGrupo = grupos.map(g => {
    const del = todas.filter(l => grupoDeLista(l) === g);
    const opcion = l => `<option value="${l.clave}"${l.clave === sel ? ' selected' : ''}>${esc(l.nombre)}</option>`;
    if (g !== GRUPOS_LISTAS[0]) return del.length ? `<optgroup label="${esc(g)}">${del.map(opcion).join('')}</optgroup>` : '';
    // Primer grupo: Gerencias, Proyectos / Procesos y CET / Servicio primero
    const primero = c => del.filter(l => l.clave === c).map(opcion).join('');
    return `<optgroup label="${esc(g)}">${primero('gerencias')}<option value="__proyectos"${sel === '__proyectos' ? ' selected' : ''}>🏗 Proyectos / Procesos</option><option value="__grupos"${sel === '__grupos' ? ' selected' : ''}>👥 Grupos LPS</option>${primero('servicios')}
      ${del.filter(l => !['gerencias', 'servicios'].includes(l.clave)).map(opcion).join('')}</optgroup>`;
  }).join('');
  el.innerHTML = `<div class="barra" style="margin-bottom:10px"><label>Lista: <select class="sel" data-l>${opcionesGrupo}</select></label>
    ${editable ? '<button class="btn btn-sm" data-a="grupo" title="Cambiar el grupo de esta lista">✎ Grupo</button><button class="btn btn-sm" data-a="nueva">＋ Nueva lista</button>' : ''}
    <button class="btn btn-sm btn-excel" data-a="xls-exp" title="Descargar esta lista en Excel">⬇ Exportar XLS</button>
    ${editable ? '<button class="btn btn-sm btn-excel" data-a="xls-imp" title="Cargar cambios desde Excel: agrega y actualiza, nunca borra">⬆ Importar XLS</button>' : ''}<span class="flex"></span>
    <span class="nota">🔒 = valor usado por los cálculos: puede renombrarse, no eliminarse.</span></div><div data-g></div>`;
  el.querySelector('[data-l]').onchange = e => {
    listas(el, e.target.value);
  };
  const camposGrupo = valor => [
    { name: 'grupo', label: 'Grupo', type: 'select', options: grupos.map(g => ({ value: g, label: g })), value: valor },
    { name: 'grupo_nuevo', label: 'O escriba un grupo nuevo', placeholder: 'Ej.: Calidad' },
  ];
  el.querySelector('[data-a="nueva"]')?.addEventListener('click', async () => {
    const d = await pedirDatos({ titulo: 'Nueva lista', campos: [{ name: 'nombre', label: 'Nombre', required: true, full: true }, { name: 'descripcion', label: 'Descripción', full: true },
      ...camposGrupo(grupoDeLista(store.listas[sel]?.lista || {}))],
      alGuardar: async v => {
        const clave = normalizar(v.nombre).replace(/[^a-z0-9]+/g, '_').slice(0, 40);
        await api.insert('listas', { area_id: store.area.id, clave, nombre: v.nombre, descripcion: v.descripcion, sistema: false,
          grupo: (v.grupo_nuevo || '').trim() || v.grupo });
        await cargarCatalogo();
      } });
    if (d) listas(el, normalizar(d.nombre).replace(/[^a-z0-9]+/g, '_').slice(0, 40));
  });
  el.querySelector('[data-a="grupo"]')?.addEventListener('click', async () => {
    const l = store.listas[sel]?.lista;
    if (!l) return;
    const d = await pedirDatos({ titulo: `Grupo de "${l.nombre}"`, campos: camposGrupo(grupoDeLista(l)),
      alGuardar: async v => { await api.update('listas', l.id, { grupo: (v.grupo_nuevo || '').trim() || v.grupo }); await cargarCatalogo(); } });
    if (d) listas(el, sel);
  });
  // Pedido d9: exportar / importar la lista por Excel (Proyectos y Grupos LPS tienen los suyos en su catálogo)
  const xls = () => import('../services/excel-listas.js');
  const bExp = el.querySelector('[data-a="xls-exp"]'), bImp = el.querySelector('[data-a="xls-imp"]');
  if (sel === '__proyectos' || sel === '__grupos') { bExp?.remove(); bImp?.remove(); }
  bExp?.addEventListener('click', () => xls().then(m => m.exportarLista(sel)).catch(e => error(mensajeError(e))));
  bImp?.addEventListener('click', () => xls().then(m => m.importarLista(sel, () => listas(el, sel))));
  // Proyectos / Procesos: el catálogo completo (tres ventanas, importar, eliminar) se dibuja aquí mismo
  if (sel === '__proyectos' || sel === '__grupos') {
    grilla?.destruir(); grilla = null;
    el.querySelector('[data-a="grupo"]')?.remove();
    el.querySelector('.barra .nota')?.remove();
    const m = await import('./proyectos.js');
    catalogoProyectos = m;
    await m.render(el.querySelector('[data-g]'), { incrustado: true, grupos: sel === '__grupos' });
    return;
  }
  catalogoProyectos?.destruir(); catalogoProyectos = null;
  const lista = store.listas[sel]?.lista;
  if (!lista) return;
  grilla?.destruir();
  grilla = crearGrilla(el.querySelector('[data-g]'), {
    // "_v3" en CET / Servicio: descarta la vista recordada que aún tenía la columna Proyecto (retirada en r2)
    id: `lista_valores_${sel}${sel === 'servicios' ? '_v3' : ''}`, tabla: 'lista_valores', titulo: lista.nombre, altura: 'calc(100vh - 330px)', puedeCrear: editable,
    columnas: [
      { field: '_p', title: '', tipo: 'texto', ancho: 36, calc: true, filtro: false, formato: (v, x) => x.protegido ? '🔒' : '' },
      ...(sel === 'servicios' ? [
        // CET / Servicio: Código (CET) y Servicio; sin proyecto (r2: un CET atiende a varios proyectos), descripción ni color
        { field: 'codigo', title: 'CET', tipo: 'texto', ancho: 140, editable: x => !x.protegido },
        { field: 'valor', title: 'Servicio', tipo: 'texto', ancho: 340 },
      ] : [
        { field: 'valor', title: 'Texto visible', tipo: 'texto', ancho: 320 },
        { field: 'codigo', title: 'Código', tipo: 'texto', ancho: 120, editable: x => !x.protegido },
        { field: 'descripcion', title: 'Descripción', tipo: 'texto', ancho: 240 },
        { field: 'color', title: 'Color', tipo: 'texto', ancho: 100, formato: v => v ? `<span class="badge" style="--c:${esc(v)}">${esc(v)}</span>` : '' },
      ]),
      { field: 'orden', title: 'Orden', tipo: 'numero', ancho: 70, paso: 1 },
      { field: 'activo', title: 'Activo', tipo: 'casilla', ancho: 70, editable: x => !x.protegido },
      sel === 'ubicaciones' ? { field: '_cuenta', title: 'Cuenta para capacidad', tipo: 'casilla', ancho: 150,
        ayuda: 'Desmarque para días que no suman capacidad (vacaciones, feriado)' } : null,
    ],
    derivar: (x, cambios) => {
      if ('_cuenta' in cambios) return { extra: { ...(x.extra || {}), cuenta_capacidad: !!cambios._cuenta } };
      if ('_proyecto' in cambios) return { extra: { ...(x.extra || {}), proyecto_id: cambios._proyecto || null } };
      return {};
    },
    puedeEditarFila: () => editable,
    nuevaFila: () => ({ lista_id: lista.id, valor: '', activo: true, orden: (store.listas[sel].valores.length + 1) * 10, extra: {} }),
    listaParaCrear: x => !!(x.valor && x.valor.trim()),
    eliminar: async x => { if (x.protegido) throw new Error('Valor protegido: no se puede eliminar.'); await api.remove('lista_valores', x.id); },
    camposCalc: ['created_at', 'updated_at'],
    alGuardar: () => cargarCatalogo(),
  });
  const valores = await api.list('lista_valores', { eq: { lista_id: lista.id }, order: [['orden', true]] });
  await grilla.inicializar(valores.map(v => ({ ...v, _cuenta: v.extra?.cuenta_capacidad !== false, _proyecto: v.extra?.proyecto_id || null })));
}

// ---------- Empresas (administrador de la plataforma, pedido 113) ----------
// Todas las empresas usan esta misma aplicación web; los datos de cada una están aislados.
async function empresas(el) {
  // Mismo panel que Administración › Plataforma › Empresas
  const plat = await import('./admin-plataforma.js');
  await plat.panelEmpresas(el, { imprimir: () => {}, repintarCabecera: () => {} });
}

// ---------- Parámetros ----------
async function parametros(el) {
  const p = store.parametros;
  const editable = esGestor();
  const form = html('<div class="tarjeta"></div>');
  el.append(form);
  const campos = [
    // Pedido 114: días laborables, fin de semana y horas por día al inicio
    { name: 'dias_laborables', label: 'Días laborables', type: 'multiselect', value: (p.dias_laborables || []).map(String),
      options: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => ({ value: String(i + 1), label: d })) },
    { name: 'trabajo_fin_semana', label: 'Trabajo en sábado y domingo', type: 'checkbox', value: p.trabajo_fin_semana,
      texto: 'Mostrar sábado y domingo en Equipo y capacidad, Plan semanal y Look Ahead (suman capacidad los días con lugar de trabajo registrado)' },
    { name: 'horas_dia', label: 'Horas disponibles por día (por defecto)', type: 'number', min: 1, max: 24, step: 0.5, value: p.horas_dia },
    // Pedido 110: cuándo se registra el Look Ahead y qué semana planifica
    { name: 'la_dias', label: 'Días de registro del Look Ahead', type: 'multiselect', value: configLookAhead().dias.map(String),
      options: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => ({ value: String(i + 1), label: d })) },
    { name: 'meta_pac', label: 'Meta de PAC (%)', type: 'number', min: 0, max: 100, value: Math.round(p.meta_pac * 100) },
    { name: 'umbral_ambar', label: 'Semáforo ámbar desde (%)', type: 'number', min: 0, max: 100, value: Math.round(p.umbral_ambar * 100) },
    { name: 'semanas_lookahead', label: 'Semanas del Look Ahead', type: 'number', min: 1, max: 8, value: p.semanas_lookahead },
    { name: 'la_semana', label: 'Semana que planifica el Look Ahead', type: 'select', value: configLookAhead().semana,
      options: [{ value: 'actual', label: 'La misma semana (p. ej. el lunes, para esa semana)' }, { value: 'siguiente', label: 'La semana siguiente (p. ej. el viernes, para la próxima)' }],
      help: 'Define la primera semana del Look Ahead y la semana que se compromete. Con «la misma semana», lo que se agrega al Plan hasta el último día de registro cuenta como programado' },
    { name: 'cierre_dias', label: 'Días de cierre semanal', type: 'multiselect', value: diasCierre().map(String),
      options: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => ({ value: String(i + 1), label: d })) },
    { name: 'reunion_dias', label: 'Días de la reunión de cumplimiento del plan semanal', type: 'multiselect', value: diasReunion().map(String),
      options: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => ({ value: String(i + 1), label: d })) },
    { name: 'reunion_hora', label: 'Hora de la reunión', type: 'time', value: p.reunion?.hora || '08:00' },
    { name: '_libre', type: 'vacio' },   // la Hora de cierre va debajo de la Hora de la reunión
    { name: 'cierre_hora', label: 'Hora de cierre', type: 'time', value: p.cierre?.hora || '17:00' },
    { name: 'cierre_automatico', label: 'Cierre automático', type: 'checkbox', texto: 'Cerrar automáticamente las semanas vencidas (los compromisos sin estado quedan "No reportado")', value: p.cierre_automatico },
    { name: 'alerta_dias', label: 'Días de aviso de restricciones por vencer', type: 'number', min: 0, max: 30, value: p.alerta_dias },
    { name: 'arrastre_alerta', label: 'Alertar arrastres desde (semanas)', type: 'number', min: 1, max: 10, value: p.arrastre_alerta },
    { name: 'version_app', label: 'Encabezado izquierdo de los PDF', value: p.version_app },
    { name: 'firma_pdf', label: 'Pie izquierdo de los PDF', value: p.firma_pdf },
    { name: 'separador', type: 'separador', label: 'Modo reunión — minutos por paso' },
    ...Object.entries(p.reunion_minutos || PARAMETROS_INICIALES.reunion_minutos).map(([k, v]) => ({ name: 'rm_' + k, label: k, type: 'number', min: 0, max: 120, value: v })),
    { name: 'separador2', type: 'separador', label: 'Reconocimientos del tablero (M-14)' },
    { name: 'rec_mejor', label: 'Mejor PAC del mes', type: 'checkbox', texto: 'Mostrar', value: p.reconocimientos?.mejor_pac },
    { name: 'rec_mejora', label: 'Mayor mejora del mes', type: 'checkbox', texto: 'Mostrar', value: p.reconocimientos?.mayor_mejora },
  ];
  const { crearFormulario } = await import('../ui/ui.js');
  const f = crearFormulario(campos);
  form.append(f);
  if (!editable) f.querySelectorAll('input,select').forEach(i => { i.disabled = true; });
  else {
    const b = html('<div style="margin-top:14px"><button class="btn btn-primario">Guardar parámetros</button></div>');
    form.append(b);
    b.querySelector('button').onclick = async () => {
      const d = f.leer();
      // "dia" (el último marcado) se conserva: el cierre automático de la base de datos espera hasta ese día
      const cierreDias = (d.cierre_dias || []).map(Number).sort((a, b) => a - b);
      if (!cierreDias.length) return error('Marque al menos un día de cierre semanal.');
      const valores = {
        meta_pac: (d.meta_pac ?? 80) / 100, umbral_ambar: (d.umbral_ambar ?? 60) / 100, semanas_lookahead: d.semanas_lookahead ?? 3,
        look_ahead: { dias: (d.la_dias || []).map(Number).sort((a, b) => a - b), semana: d.la_semana === 'actual' ? 'actual' : 'siguiente' },
        horas_dia: d.horas_dia ?? 8, dias_laborables: d.dias_laborables.map(Number).sort(), trabajo_fin_semana: !!d.trabajo_fin_semana, cierre: { dias: cierreDias, dia: cierreDias.at(-1), hora: d.cierre_hora || '17:00' },
        reunion: { dias: (d.reunion_dias || []).map(Number).sort((a, b) => a - b), hora: d.reunion_hora || '08:00' }, cierre_automatico: d.cierre_automatico, alerta_dias: d.alerta_dias ?? 3,
        arrastre_alerta: d.arrastre_alerta ?? 2, version_app: d.version_app || 'LPS-GES V1.00.01', firma_pdf: d.firma_pdf || 'By EHCM',
        reunion_minutos: Object.fromEntries(Object.keys(p.reunion_minutos || PARAMETROS_INICIALES.reunion_minutos).map(k => [k, d['rm_' + k] ?? 10])),
        reconocimientos: { mejor_pac: d.rec_mejor, mayor_mejora: d.rec_mejora },
      };
      if (valores.umbral_ambar > valores.meta_pac) return error('El umbral ámbar no puede ser mayor que la meta.');
      if (!valores.look_ahead.dias.length) return error('Marque al menos un día de registro del Look Ahead.');
      if (!valores.reunion.dias.length) return error('Marque al menos un día de la reunión de cumplimiento del plan semanal.');
      try {
        await api.upsert('parametros', Object.entries(valores).map(([clave, valor]) => ({ area_id: store.area.id, clave, valor })), 'area_id,clave');
        await cargarCatalogo();
        ok('Parámetros guardados.');
      } catch (e) { error(mensajeError(e)); }
    };
  }
}

// ---------- Permisos ----------
async function permisos(el) {
  const editable = esAdmin();
  const roles = ['admin', 'delegado', 'lider', 'consulta'];
  // Valor efectivo (igual que public.puede): admin sin fila = permitido; rol de planificación sin fila = como el líder
  const valor = (r, a) => store.permisos[r]?.[a] ?? (r === 'admin' ? true : PLANIFICADORES.includes(r) ? !!store.permisos.lider?.[a] : false);
  const celdaEditable = r => editable && (r !== 'admin' || esSuperadmin());
  el.innerHTML = `<div class="tarjeta"><p class="nota">El <b>super administrador</b> siempre tiene todos los permisos y es el único que edita la columna
    <b>Administrador</b>. Los límites fijos del delegado (no tocar al super administrador ni a los administradores, no rotar el delegado) no son modificables.
    ${editable ? '' : ' Solo un administrador puede modificar esta matriz.'}</p>
    <table class="simple"><tr><th>Acción</th>${roles.map(r => `<th style="text-align:center">${esc(ROLES[r])}${r === 'admin' && !esSuperadmin() ? ' 🔒' : ''}</th>`).join('')}</tr>
    ${ACCIONES.map(([a, t]) => `<tr><td>${esc(t)}</td>${roles.map(r => `<td style="text-align:center"><input type="checkbox" data-r="${r}" data-acc="${a}"
      ${valor(r, a) ? 'checked' : ''} ${celdaEditable(r) ? '' : 'disabled'}></td>`).join('')}</tr>`).join('')}</table></div>`;
  el.addEventListener('change', async e => {
    const c = e.target.closest('[data-acc]');
    if (!c) return;
    try {
      await api.upsert('permisos', { area_id: store.area.id, rol: c.dataset.r, accion: c.dataset.acc, permitido: c.checked }, 'area_id,rol,accion');
      (store.permisos[c.dataset.r] ||= {})[c.dataset.acc] = c.checked;
      ok('Permiso actualizado. Aplica de inmediato.');
    } catch (err) { error(mensajeError(err)); c.checked = !c.checked; }
  });
}

// ---------- Columnas personalizadas ----------
async function columnas(el) {
  const editable = esGestor();
  el.innerHTML = `<div class="aviso">Agregue columnas a las grillas sin programar. Para columnas de tipo "lista", primero cree la lista en <a href="#/config/listas">Listas</a>.</div><div data-g></div>`;
  const listasOps = Object.values(store.listas).map(x => ({ value: x.lista.id, label: x.lista.nombre }));
  grilla?.destruir();
  grilla = crearGrilla(el.querySelector('[data-g]'), {
    id: 'columnas', tabla: 'columnas_personalizadas', titulo: 'Columnas', altura: 'calc(100vh - 340px)', puedeCrear: editable,
    columnas: [
      { field: 'grilla', title: 'Grilla', tipo: 'lista', ancho: 160, opciones: [{ value: 'actividades', label: 'Actividades (Plan y Look Ahead)' }, { value: 'cartera', label: 'Cartera' }, { value: 'restricciones', label: 'Restricciones' }, { value: 'proyectos', label: 'Proyectos' }] },
      { field: 'nombre', title: 'Nombre de la columna', tipo: 'texto', ancho: 220 },
      { field: 'clave', title: 'Clave interna', tipo: 'texto', ancho: 150, editable: x => !x.id },
      { field: 'tipo', title: 'Tipo', tipo: 'lista', ancho: 110, opciones: ['texto', 'numero', 'fecha', 'lista', 'casilla'].map(v => ({ value: v, label: v })) },
      { field: 'lista_id', title: 'Lista (si es tipo lista)', tipo: 'lista', ancho: 220, opciones: [{ value: null, label: '—' }, ...listasOps] },
      { field: 'orden', title: 'Orden', tipo: 'numero', ancho: 70, paso: 1 },
      { field: 'activa', title: 'Activa', tipo: 'casilla', ancho: 70 },
    ],
    puedeEditarFila: () => editable,
    nuevaFila: () => ({ area_id: store.area.id, grilla: 'actividades', tipo: 'texto', activa: true, orden: 0, nombre: '', clave: '' }),
    derivar: (x, c) => ('nombre' in c && !x.id ? { clave: normalizar(c.nombre).replace(/[^a-z0-9]+/g, '_').slice(0, 30) } : {}),
    listaParaCrear: x => !!(x.nombre && x.clave),
    camposCalc: ['created_at', 'updated_at'],
    alGuardar: () => cargarCatalogo(),
  });
  await grilla.inicializar(store.columnas);
}

// ---------- Importación ----------
async function importarVista(el) {
  if (!puede('importar_datos')) { el.innerHTML = '<p class="nota">No tiene permiso para importar.</p>'; return; }
  el.innerHTML = `<div class="grid-2">
    <div class="tarjeta"><h2>Histórico de planificación (Excel)</h2>
      <p>Importa las hojas <b>Plan_semanal</b> (libro OT_LA) y <b>2_Cumplimiento_Plan_semanal</b> (libro LPS_OT): actividades, responsables, HH por día, cumplimiento y CNC.
      Las semanas pasadas quedan cerradas como histórico. Puede importar varios archivos, uno por uno; los duplicados se omiten.</p>
      <input type="file" accept=".xlsx,.xlsm,.xls" data-f="hist"><div data-res-hist style="margin-top:10px"></div></div>
    <div class="tarjeta"><h2>Catálogo de proyectos (Excel)</h2>
      <p>Reconoce las columnas por su título, en cualquier orden y hoja: <b>Código</b>, <b>Nombre corto</b> (o Proyecto), Nombre completo,
        Gerencia, Fase, País, Estado, Inicio y Fin. Agrega los proyectos nuevos, puede actualizar los existentes (mismo código)
        y ofrece agregar a las listas las gerencias, fases o países nuevos. Antes de importar muestra una vista previa.</p>
      <input type="file" accept=".xlsx,.xlsm,.xls,.csv" data-f="proy"><div data-res-proy style="margin-top:10px"></div></div></div>
    <p class="nota" style="margin-top:10px">Los archivos se procesan en su navegador y los datos van directo a la base de datos; no se guardan en el repositorio.</p>`;
  el.querySelector('[data-f="hist"]').onchange = e => e.target.files[0] && importarHistorico(e.target.files[0], el.querySelector('[data-res-hist]'));
  el.querySelector('[data-f="proy"]').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) import('./importar-proyectos.js').then(m => m.importarProyectos(f)); };
}

async function importarHistorico(archivo, salida) {
  salida.innerHTML = '<div class="cargando"><span class="spinner"></span> Leyendo archivo…</div>';
  let a;
  try { a = analizar(await leerLibro(archivo)); } catch (e) { salida.innerHTML = `<div class="aviso error">No se pudo leer el archivo: ${esc(e.message)}</div>`; return; }
  if (!a.filas.length) { salida.innerHTML = '<div class="aviso warn">No se encontraron hojas de plan semanal con columna "ACTIVIDAD".</div>'; return; }
  const semanas = [...new Set(a.filas.map(f => f.semana))].sort();
  salida.innerHTML = `<div class="aviso ok">${a.filas.length} actividades · ${semanas.length} semana(s) (${fmtFecha(semanas[0])} – ${fmtFecha(semanas.at(-1))}) · ${a.responsables.length} responsables · ${a.proyectos.length} proyectos.</div>`;
  const usuarios = store.perfiles.filter(p => ['superadmin', 'admin', 'delegado', ...PLANIFICADORES].includes(p.rol) && !p.eliminado);
  const cuerpo = html(`<div>
    <h3>1. Responsables del Excel → usuarios</h3><p class="nota">Los que no se asignen se guardan solo como resumen de PAC histórico.</p>
    <table class="simple">${a.responsables.map(r => { const s = sugerirUsuario(r); return `<tr><td>${esc(r)}</td><td><select class="sel" data-u="${esc(r)}">
      <option value="">— Solo histórico de PAC —</option>${usuarios.map(u => `<option value="${u.id}"${u.id === s ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></td></tr>`; }).join('')}</table>
    <h3 style="margin-top:14px">2. Proyectos / procesos del Excel → catálogo</h3>
    <table class="simple">${a.proyectos.map(t => { const s = sugerirProyecto(t); return `<tr><td>${esc(t)}</td><td><select class="sel" data-p="${esc(t)}">
      <option value="nuevo"${s ? '' : ' selected'}>＋ Crear proyecto nuevo</option><option value="">— Sin proyecto —</option>
      ${store.proyectos.map(p => `<option value="${p.id}"${p.id === s ? ' selected' : ''}>${esc(p.codigo)} · ${esc(p.nombre_corto)}</option>`).join('')}</select></td></tr>`; }).join('')}</table>
    <label class="chk" style="margin-top:12px"><input type="checkbox" data-listas checked> Agregar a las listas las CNC, servicios y gerencias que no existan</label>
    <div data-prog class="nota" style="margin-top:8px"></div></div>`);
  modal({
    titulo: `Importar ${archivo.name}`, cuerpo, ancho: 820,
    botones: [{ texto: 'Cancelar' }, { texto: 'Importar', clase: 'btn-primario', accion: async () => {
      const mapa = { usuarios: {}, proyectos: {}, crearListas: cuerpo.querySelector('[data-listas]').checked };
      cuerpo.querySelectorAll('[data-u]').forEach(s => { mapa.usuarios[s.dataset.u] = s.value; });
      cuerpo.querySelectorAll('[data-p]').forEach(s => { mapa.proyectos[s.dataset.p] = s.value; });
      try {
        const r = await medir('importar.historico', () => importar(a, mapa, t => { cuerpo.querySelector('[data-prog]').textContent = t; }));
        salida.innerHTML = `<div class="aviso ok">Importación terminada: ${r.actividades} actividades, ${r.cierres} semanas cerradas, ${r.historico} registros de PAC histórico,
          ${r.proyectos} proyectos nuevos, ${r.valores} valores de lista nuevos${r.omitidas ? `, ${r.omitidas} duplicados omitidos` : ''}.</div>`;
        await cargarCatalogo();
      } catch (e) { error(mensajeError(e)); return false; }
    } }],
  });
}

// ---------- Respaldo ----------
async function respaldo(el) {
  el.innerHTML = `<div class="grid-2"><div class="tarjeta"><h2>Descargar respaldo</h2>
      <p>Descarga toda la información del área en un archivo JSON (para restaurar) o en Excel (para revisar). Además, ${modoDemo ? 'en producción ' : ''}se ejecuta un respaldo automático semanal hacia la carpeta privada de Google Drive configurada (ver README).</p>
      <div class="barra"><button class="btn btn-primario" data-a="json" ${esAdmin() ? '' : 'disabled'}>⬇ Respaldo completo (JSON)</button>
      <button class="btn" data-a="excel">⬇ Datos principales (Excel)</button></div>
      ${esAdmin() ? '' : '<p class="nota">El respaldo completo solo lo descarga el administrador (si el super administrador se lo permite).</p>'}</div>
    ${!modoDemo && esSuperadmin() && hayDatosDemo() ? `<div class="tarjeta"><h2>Datos del modo demostración</h2>
      <p>En este navegador hay datos cargados en el modo demostración (proyectos, actividades, personas…). Puedes pasarlos a la base de datos real.</p>
      <div class="barra"><button class="btn btn-primario" data-a="traer-demo">⬆ Traer datos del modo demostración</button></div></div>` : ''}
    <div class="tarjeta"><h2>Buenas prácticas</h2><ul><li>Descargue un respaldo antes de importaciones grandes.</li>
      <li>Los archivos de respaldo contienen datos de la empresa: guárdelos en una carpeta privada, nunca en el repositorio público.</li></ul></div></div>`;
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    try {
      if (a === 'traer-demo') return (await import('./traer-demo.js')).abrirTraerDemo();
      if (a === 'json') {
        const datos = await api.rpc('exportar_respaldo');
        descargar(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }), `${nombreArchivo('Respaldo')}.json`);
      }
      if (a === 'excel') {
        await libExcel();
        const wb = window.XLSX.utils.book_new();
        for (const t of ['proyectos', 'actividades', 'restricciones', 'cartera', 'cierres', 'acuerdos', 'pac_historico']) {
          const filas = await api.list(t, { eq: { area_id: store.area.id } });
          window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(filas.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'object' && v ? JSON.stringify(v) : v])))), t.slice(0, 30));
        }
        window.XLSX.writeFile(wb, `${nombreArchivo('Datos principales')}.xlsx`);
      }
    } catch (err) { error(mensajeError(err)); }
  });
}
function descargar(blob, nombreArchivo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombreArchivo; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Auditoría ----------
async function auditoria(el) {
  if (!esGestor()) { el.innerHTML = '<p class="nota">No tiene permiso para ver la auditoría.</p>'; return; }
  const regs = await api.list('auditoria', { eq: { area_id: store.area.id }, order: [['created_at', false]], limit: 300 });
  el.innerHTML = `<div class="tarjeta"><p class="nota">Últimos 300 cambios. El detalle de cada registro también se ve en su ventana de "Comentarios y enlaces".</p>
    <table class="simple"><tr><th>Fecha</th><th>Usuario</th><th>Tabla</th><th>Acción</th><th>Cambios</th></tr>
    ${regs.map(r => `<tr><td style="white-space:nowrap">${fmtFechaHora(r.created_at)}</td><td>${esc(nombre(r.usuario_id) || 'Sistema')}</td><td>${esc(r.tabla)}</td><td>${esc(r.accion)}</td>
      <td class="nota">${r.accion === 'update' ? Object.entries(r.cambios || {}).slice(0, 6).map(([k, v]) => `<b>${esc(k)}</b>: ${esc(JSON.stringify(v?.[0]))} → ${esc(JSON.stringify(v?.[1]))}`).join('<br>')
        : esc((r.cambios?.descripcion || r.cambios?.nombre_corto || r.cambios?.valor || '').toString().slice(0, 80))}</td></tr>`).join('')}</table></div>`;
}
