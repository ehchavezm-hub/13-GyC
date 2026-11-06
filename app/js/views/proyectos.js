// Proyectos (6.3): catálogo que alimenta el menú, propuesta y aprobación, ficha con indicadores e hitos.
import { api, mensajeError } from '../data/api.js';
import { store, cargarCatalogo, esGestor, esStaff, esAdmin, puede, opciones, opcionesLideres, lideres, opcionesEstado, colorEstado, textoEstado, etiqueta, nombre, proyecto, seleccionarProyecto, valoresLista, opcionesProyectos, puedeAgregarProyecto, puedeEditarProyecto, subproyectos } from '../core/store.js';
import { esc, html, fmtFecha, hoy, num, pct, lunes, sumarSemanas } from '../core/util.js';
import { ir } from '../core/router.js';
import { crearGrilla } from '../ui/grid.js';
import { kpi, badge, pedirDatos, ok, error, confirmar, modal, vacio, toast } from '../ui/ui.js';
import { columnasPersonalizadas } from '../services/columnas.js';
import { resumenPAC, colorPAC, resumenRestricciones } from '../services/indicadores.js';
import { panelColaboracion } from './detalle.js';
import { imprimirPDF, tablaPDF, kpisPDF } from '../services/pdf.js';
import { ROLES } from '../data/catalogos.js';
import { elegirArchivoProyectos } from './importar-proyectos.js';

// Tres ventanas, una debajo de otra y en este orden. "Propuesto" va en Activos (y en el panel de aprobación); "Rechazado", en Cerrados.
const VENTANAS = [['activo', 'Activos'], ['en_pausa', 'En pausa'], ['cerrado', 'Cerrados']];
const ESTADOS_EDITABLES = ['activo', 'en_pausa', 'cerrado'];
const ventanaDe = p => (p.estado === 'en_pausa' ? 'en_pausa' : ['cerrado', 'rechazado'].includes(p.estado) ? 'cerrado' : 'activo');
let grillas = {};
// El catálogo vive en Configuración → Listas → Proyectos / Procesos (se dibuja dentro de ese contenedor)
export const RUTA_CATALOGO = '#/config/listas?lista=__proyectos';
const rutaCatalogo = () => (esGestor() ? RUTA_CATALOGO : '#/tablero');
let contenedor = null;
// Pedido d5: el catálogo de Proyectos y el de Grupos LPS son distintos (un Grupo LPS es un proyecto con padre_id:
// pertenece a un proyecto, y atiende a los proyectos de los CET / Servicios de sus actividades)
let modoGrupos = false;
export const RUTA_GRUPOS = '#/config/listas?lista=__grupos';
/** Vuelve a dibujar el catálogo donde esté abierto (Configuración o página propia). */
export function refrescarCatalogo() { if (contenedor?.isConnected) render(contenedor, { incrustado: contenedor.id !== 'contenido', grupos: modoGrupos }); }
const todasLasGrillas = () => Object.values(grillas);

export async function render(el, params) {
  destruir();
  el.innerHTML = '';
  if (params.id) return ficha(el, params.id);
  // Desde el menú ya no hay página propia: el catálogo se administra en Configuración → Listas
  if (!params.incrustado && esGestor()) { location.hash = RUTA_CATALOGO; return; }
  contenedor = el;
  modoGrupos = !!params.grupos;
  const puedeCrear = puedeAgregarProyecto();
  const pag = html(`<div>
    <div class="pagina-cab">${modoGrupos ? '<h2 style="margin:0">Grupos LPS</h2>' : params.incrustado ? '<h2 style="margin:0">Proyectos / Procesos</h2>' : '<h1>Proyectos</h1>'}
      <span class="pagina-sub">${modoGrupos ? 'Equipos de personas que aplican Last Planner: cada uno pertenece a un proyecto y atiende a los proyectos de los CET / Servicios de sus actividades'
        : 'Catálogo de proyectos: alimenta el menú de selección y las listas de todas las grillas (los Grupos LPS tienen su propio catálogo)'}</span>
      <span class="flex"></span>
      ${puedeCrear || puede('crear_cartera') ? `<button class="btn btn-primario" data-a="nuevo">＋ ${modoGrupos ? (puedeCrear ? 'Nuevo Grupo LPS' : 'Proponer Grupo LPS') : puedeCrear ? 'Nuevo proyecto' : 'Proponer proyecto'}</button>` : ''}
      <button class="btn btn-sm btn-excel" data-a="xls-exp" title="Descargar el catálogo en Excel">⬇ Exportar XLS</button>
      ${puede('importar_datos') ? '<button class="btn btn-sm btn-excel" data-a="importar" title="Cargar desde Excel: agrega y actualiza, nunca borra">⬆ Importar XLS</button>' : ''}
      <button class="btn btn-sm" data-a="pdf">🖨 PDF</button></div>
    <div data-propuestos></div>
    ${VENTANAS.map(([e, t]) => `<section class="ventana-estado ventana-${e}" data-ventana="${e}">
      <h2 class="ventana-tit">${t} <span class="contador-pestana" data-cuenta="${e}"></span></h2><div data-grilla="${e}"></div></section>`).join('')}
  </div>`);
  el.append(pag);
  pag.querySelector('[data-a="nuevo"]')?.addEventListener('click', () => formularioProyecto(null, { sub: modoGrupos }));
  const xls = () => import('../services/excel-listas.js');
  pag.querySelector('[data-a="importar"]')?.addEventListener('click', () => (modoGrupos ? xls().then(m => m.importarGrupos(refrescarCatalogo)) : elegirArchivoProyectos()));
  pag.querySelector('[data-a="xls-exp"]')?.addEventListener('click', () => xls().then(m => m.exportarCatalogo(modoGrupos)).catch(e => error(mensajeError(e))));
  pag.querySelector('[data-a="pdf"]').addEventListener('click', () => imprimirPDF(modoGrupos ? 'Catálogo de Grupos LPS' : 'Catálogo de proyectos', tablaPDF(
    // Mismas columnas y anchos que las ventanas de proyectos en pantalla
    grillas.activo?.columnasPDF?.() || [
      { titulo: 'Código', valor: p => p.codigo }, { titulo: 'Nombre', valor: p => p.nombre_corto }, { titulo: 'Gerencia', valor: p => etiqueta(p.gerencia_id) },
      { titulo: 'Fase', valor: p => etiqueta(p.fase_id) }, { titulo: 'Estado', valor: p => textoEstado('estados_proyecto', p.estado) }],
    store.proyectos.filter(p => !!p.padre_id === modoGrupos)), { proyectoTexto: modoGrupos ? 'Todos los Grupos LPS' : 'Todos los proyectos', orientacion: 'landscape' }));
  pintarPropuestos(pag);

  // Quien solo agrega proyectos (líderes) lo hace en la ventana Activos; eliminar sigue siendo de quien administra proyectos
  for (const [estado] of VENTANAS) grillas[estado] = crearGrilla(pag.querySelector(`[data-grilla="${estado}"]`), configGrilla(estado, esGestor() || (puedeCrear && estado === 'activo')));
  await Promise.all(VENTANAS.map(([e]) => grillas[e].inicializar(proyectosDe(e))));
  pintarCuentas();
}

function proyectosDe(estado) { return store.proyectos.filter(p => !!p.padre_id === modoGrupos && (esStaff() || p.estado === 'activo') && ventanaDe(p) === estado); }
// Proyectos a los que puede pertenecer un Grupo LPS (los que no son a su vez un grupo)
const opcionesProyectoPadre = () => store.proyectos.filter(p => !p.padre_id && !['cerrado', 'rechazado'].includes(p.estado))
  .map(p => ({ value: p.id, label: `${p.codigo} · ${p.nombre_corto}` })).sort((a, b) => a.label.localeCompare(b.label));

function pintarCuentas() {
  for (const [e] of VENTANAS) {
    const c = document.querySelector(`#contenido [data-cuenta="${e}"]`);
    if (c && grillas[e]) c.textContent = grillas[e].filas().filter(p => p.id).length;
  }
}

// Vuelve a cargar las tres ventanas desde el catálogo (p. ej. tras cambiar un estado: el proyecto pasa a su ventana)
async function redistribuir() {
  await cargarCatalogo();
  // Si alguien está editando una celda, se espera: redibujar ahora cerraría su edición
  if (document.querySelector('[data-grilla] .tabulator-cell.tabulator-editing')) { setTimeout(redistribuir, 800); return; }
  await Promise.all(VENTANAS.map(([e]) => {
    const g = grillas[e];
    if (!g) return null;
    const nuevos = proyectosDe(e);
    // Eco de un cambio propio (mismas filas y versiones): no hace falta redibujar
    const firma = l => l.filter(p => p.id).map(p => p.id + p.updated_at).sort().join();
    return firma(g.filas()) === firma(nuevos) ? null : g.setDatos(nuevos);
  }));
  pintarCuentas();
}

function configGrilla(estado, puedeCrear) {
  const grupos = modoGrupos;
  return {
    id: (grupos ? 'grupos_' : 'proyectos_') + estado, tabla: 'proyectos', titulo: VENTANAS.find(v => v[0] === estado)[1], puedeCrear,
    alturaAuto: true,
    columnas: [
      { field: 'codigo', title: 'Código', tipo: 'texto', ancho: 90 },
      { field: 'nombre_corto', title: grupos ? 'Nombre del grupo' : 'Nombre corto', tipo: 'texto', ancho: 200 },
      { field: 'nombre_completo', title: grupos ? 'Descripción' : 'Nombre completo', tipo: 'texto', ancho: 260 },
      ...(grupos ? [{ field: 'padre_id', title: 'Pertenece al proyecto', tipo: 'lista', ancho: 240, opciones: opcionesProyectoPadre }] : [
        { field: 'gerencia_id', title: 'Gerencia', tipo: 'lista', ancho: 200, opciones: () => opciones('gerencias') },
        { field: 'fase_id', title: 'Fase', tipo: 'lista', ancho: 120, opciones: () => opciones('fases') }]),
      { field: 'estado', title: 'Estado', tipo: 'lista', ancho: 115, colorear: true,
        opciones: () => opcionesEstado('estados_proyecto').map(o => ({ ...o, color: colorEstado('estados_proyecto', o.value) })),
        opcionesEdicion: () => opcionesEstado('estados_proyecto').filter(o => ESTADOS_EDITABLES.includes(o.value)) },
      ...(grupos ? [] : [{ field: 'pais_id', title: 'País', tipo: 'lista', ancho: 90, opciones: () => opciones('paises') }]),
      { field: 'fecha_inicio', title: 'Inicio', tipo: 'fecha', ancho: 100 },
      { field: 'fecha_fin', title: 'Fin', tipo: 'fecha', ancho: 100 },
      { field: '_ficha', title: '', tipo: 'texto', ancho: 70, calc: true, filtro: false, formato: (v, p) => p.id ? '<button class="mini-btn">Ficha ›</button>' : '',
        click: (p, e) => { if (p.id && e.target.closest('button')) ir('#/proyectos/' + p.id); } },
      ...(esGestor() ? [{ field: '_borrar', title: '', tipo: 'texto', ancho: 46, calc: true, filtro: false, ordenable: false,
        formato: (v, p) => p.id ? '<button class="mini-btn mini-peligro" title="Eliminar proyecto">🗑</button>' : '',
        click: (p, e) => { if (p.id && e.target.closest('button')) eliminarProyecto(p, { confirmaciones: 2 }).then(r => r && redistribuir()); } }] : []),
      ...columnasPersonalizadas('proyectos'),
    ],
    agrupar: grupos ? [{ field: 'padre_id', label: 'Proyecto' }] : [{ field: 'gerencia_id', label: 'Gerencia' }, { field: 'fase_id', label: 'Fase' }],
    puedeEditarFila: p => !p.id || puedeEditarProyecto(p),
    nuevaFila: () => ({ area_id: store.area.id, estado, codigo: '', nombre_corto: '', extra: {},
      // Grupo LPS nuevo: sugiere el proyecto elegido en el menú (o el del grupo elegido)
      ...(grupos ? { padre_id: (() => { const s = proyecto(store.proyectoSel); return s ? (s.padre_id || s.id) : null; })() } : {}) }),
    // Al cambiar el estado se guarda y el proyecto pasa de inmediato a su ventana
    alEditar: async (p, campo) => {
      if (campo !== 'estado' || ventanaDe(p) === estado) return;
      await grillas[estado].guardarAhora();
      await new Promise(r => setTimeout(r, 150));   // deja cerrar la lista desplegable antes de mover la fila
      await redistribuir();
      toast(`"${p.codigo}" pasó a ${VENTANAS.find(x => x[0] === ventanaDe(p))[1]}.`, 'ok');
    },
    alCambioRemoto: () => { clearTimeout(configGrilla.t); configGrilla.t = setTimeout(redistribuir, 600); },
    listaParaCrear: p => !!(p.codigo && p.nombre_corto && (!grupos || p.padre_id)),
    camposCalc: ['created_at', 'updated_at', 'created_by', 'aprobado_at'],
    alGuardar: () => { cargarCatalogo(); pintarCuentas(); },
    // Eliminar (clic derecho → Eliminar fila): solo sin historial; si lo tiene, se ofrece desactivarlo
    eliminar: p => eliminarProyecto(p, { confirmaciones: 1 }),   // la grilla ya hizo la primera pregunta
    menuFila: p => [
      { label: '📄 Ver ficha', action: () => p.id && ir('#/proyectos/' + p.id) },
      ...(p.id && esGestor() ? [p.estado === 'cerrado'
        ? { label: '▶ Reactivar proyecto', action: () => cambiarEstado(p, 'activo') }
        : { label: '⛔ Desactivar proyecto (Cerrado)', action: () => cambiarEstado(p, 'cerrado') }] : []),
      { label: '👥 Asignar líderes…', action: () => p.id && asignarLideres(p), disabled: !esGestor() },
      { label: '🏗 Seleccionar en el menú', action: () => p.id && seleccionarProyecto(p.id) },
      ...(p.id && esGestor() ? [{ label: '＋ Agregar CET / Servicio a este proyecto…', action: () => nuevoCETServicio({ proyectoId: p.id }) }] : []),
    ],
  };
}

export function destruir() { todasLasGrillas().forEach(g => g.destruir()); grillas = {}; }

// Todas las personas del equipo (todos los roles que planifican, delegado y administradores), por nombre, con su rol
function opcionesEquipo() {
  return lideres().slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => ({ value: p.id, label: p.nombre, nota: ROLES[p.rol] || p.rol }));
}

// ---------- Desactivar / eliminar ----------
// Desactivar (estado "Cerrado") es lo recomendado: el proyecto sale de menús y selectores pero conserva su historial.
async function cambiarEstado(p, estado, { preguntar = true } = {}) {
  const desactiva = estado === 'cerrado';
  if (desactiva && preguntar && !await confirmar(`¿Desactivar "${p.codigo} · ${p.nombre_corto}"? Dejará de aparecer en el menú de proyectos y en los selectores ` +
    '(actividades, CET / Servicio, cartera). Su historial y PAC se conservan y puede reactivarlo cuando quiera.', { titulo: 'Desactivar proyecto', texto: 'Desactivar' })) return false;
  try {
    await api.update('proyectos', p.id, { estado });
    ok(desactiva ? 'Proyecto desactivado.' : 'Proyecto reactivado.');
    await cargarCatalogo();
    refrescarCatalogo();
  } catch (e) { error(mensajeError(e)); }
  return true;
}

/** Cuántos registros usan el proyecto (si hay alguno, no se elimina). */
async function usosDeProyecto(id) {
  const tablas = [['actividades', 'actividad(es)'], ['cartera', 'registro(s) de cartera'], ['restricciones', 'restricción(es)'], ['plantilla_items', 'ítem(s) de plantilla']];
  const n = await Promise.all(tablas.map(([t]) => api.list(t, { eq: { proyecto_id: id }, limit: 1000 }).then(r => r.length).catch(() => 0)));
  return tablas.map(([, t], i) => n[i] ? `${n[i]} ${t}` : '').filter(Boolean);
}

// Proyecto con historial: lo recomendado es desactivarlo. Un administrador puede además eliminarlo con todo su
// historial (p. ej. proyectos de prueba), confirmando con el código del proyecto.
function proyectoConHistorial(p, usos) {
  const puedeBorrarTodo = esAdmin();
  return new Promise(resolver => {
    let resultado = false, siguePregunta = false;   // al pasar a la confirmación por código, cerrar este aviso no responde todavía
    const botones = [{ texto: 'Cancelar' }];
    if (p.estado !== 'cerrado') botones.push({ texto: 'Desactivar (recomendado)', clase: 'btn-primario', accion: async () => { await cambiarEstado(p, 'cerrado', { preguntar: false }); } });
    if (puedeBorrarTodo) botones.push({ texto: 'Eliminar con todo su historial…', clase: 'btn-peligro', accion: async cerrar => {
      siguePregunta = true; cerrar(); resultado = await eliminarConHistorial(p, usos); resolver(resultado); return false; } });
    modal({
      titulo: `"${p.codigo}" tiene historial`, ancho: 620, botones, alCerrar: () => { if (!siguePregunta) resolver(resultado); },
      cuerpo: `<p><b>${esc(p.codigo)} · ${esc(p.nombre_corto)}</b> tiene: ${esc(usos.join(', '))}.</p>
        <p>Lo recomendado es <b>desactivarlo</b>: deja de aparecer en menús y selectores, y conserva su historial y el PAC.</p>
        ${puedeBorrarTodo ? '<p class="nota">Si es un proyecto de prueba o creado por error, puede <b>eliminarlo con todo su historial</b>: se borran también sus actividades (incluso de semanas cerradas), restricciones, cartera y plantillas, y el PAC pasado se recalcula sin ellas.</p>'
          : '<p class="nota">Eliminarlo con su historial solo puede hacerlo un administrador.</p>'}`,
    });
  });
}

async function eliminarConHistorial(p, usos) {
  const cuerpo = html(`<div><p>Se eliminará <b>${esc(p.codigo)} · ${esc(p.nombre_corto)}</b> y todo su historial: ${esc(usos.join(', '))}.
    <b>Esta acción no se puede deshacer.</b></p><p>Para confirmar, escriba el código del proyecto:</p>
    <input class="inp" data-cod style="width:100%" placeholder="${esc(p.codigo)}" autocomplete="off"></div>`);
  let hecho = false;
  await new Promise(res => modal({
    titulo: 'Eliminar proyecto con su historial', cuerpo, ancho: 560, alCerrar: res,
    botones: [{ texto: 'Cancelar' }, { texto: 'Eliminar definitivamente', clase: 'btn-peligro', accion: async () => {
      if (cuerpo.querySelector('[data-cod]').value.trim() !== p.codigo) { error('El código no coincide.'); return false; }
      try {
        const r = await api.rpc('eliminar_proyecto_completo', { p_proyecto: p.id });
        if (store.proyectoSel === p.id) seleccionarProyecto('');
        ok(`Proyecto "${p.codigo}" eliminado con ${r?.actividades ?? 0} actividad(es), ${r?.restricciones ?? 0} restricción(es) y ${r?.cartera ?? 0} registro(s) de cartera.`);
        await cargarCatalogo();
        hecho = true;
      } catch (e) { error(mensajeError(e)); return false; }
    } }],
  }));
  return hecho;
}

// confirmaciones: cuántas preguntas hacer antes de borrar (el botón 🗑 y la ficha hacen dos)
async function eliminarProyecto(p, { confirmaciones = 2 } = {}) {
  if (!esGestor()) throw new Error('No tiene permiso para eliminar proyectos.');
  const hijos = subproyectos(p.id);
  if (hijos.length) {
    error(`"${p.codigo}" tiene ${hijos.length} Grupo(s) LPS. Elimínelos o muévalos primero, o elimínelo con todo desde Administración › Estructura.`);
    return false;
  }
  const usos = await usosDeProyecto(p.id);
  if (usos.length) return proyectoConHistorial(p, usos);
  if (confirmaciones >= 2 && !await confirmar(`¿Eliminar el proyecto "${p.codigo} · ${p.nombre_corto}"? No tiene actividades ni otros registros.`,
    { titulo: 'Eliminar proyecto (1 de 2)', texto: 'Sí, eliminar', peligro: true })) return false;
  if (confirmaciones >= 1 && !await confirmar(`Confirme nuevamente: "${p.codigo} · ${p.nombre_corto}" se eliminará definitivamente. Esta acción no se puede deshacer.`,
    { titulo: `Eliminar proyecto (${confirmaciones >= 2 ? '2 de 2' : 'confirmación final'})`, texto: 'Eliminar definitivamente', peligro: true })) return false;
  // Sin historial: se borra y se quita su asociación en la lista CET / Servicio
  for (const v of valoresLista('servicios', { inactivos: true }).filter(x => x.extra?.proyecto_id === p.id)) {
    await api.update('lista_valores', v.id, { extra: { ...v.extra, proyecto_id: null } });
  }
  await api.remove('proyectos', p.id);
  if (store.proyectoSel === p.id) seleccionarProyecto('');
  ok(`Proyecto "${p.codigo}" eliminado.`);
  await cargarCatalogo();
  return true;
}

function lideresDe(id) { return store.proyectoLideres.filter(l => l.proyecto_id === id).map(l => l.usuario_id); }

function pintarPropuestos(pag) {
  const props = store.proyectos.filter(p => p.estado === 'propuesto');
  const cont = pag.querySelector('[data-propuestos]');
  if (!props.length || !esStaff()) { cont.innerHTML = ''; return; }
  const aprueba = esGestor();
  cont.innerHTML = `<div class="tarjeta" style="margin-bottom:12px;border-left:4px solid var(--amarillo)"><h2>Proyectos propuestos por aprobar (${props.length})</h2>
    <table class="simple"><tr><th>Código</th><th>Nombre</th><th>Gerencia</th><th>Propuesto por</th><th>Observaciones</th><th></th></tr>
    ${props.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre_corto)}</td><td>${esc(etiqueta(p.gerencia_id))}</td><td>${esc(nombre(p.propuesto_por))}</td>
      <td>${esc(p.observaciones || '')}</td><td style="white-space:nowrap">${aprueba ? `<button class="btn btn-sm btn-primario" data-aprobar="${p.id}">Aprobar</button>
      <button class="btn btn-sm" data-rechazar="${p.id}">Rechazar</button>` : '<span class="nota">En revisión</span>'}</td></tr>`).join('')}</table>
    <p class="nota">Mientras está propuesto, el líder ya puede registrar actividades en él (marcadas "por aprobar").</p></div>`;
  cont.querySelectorAll('[data-aprobar]').forEach(b => b.onclick = async () => {
    try {
      await api.update('proyectos', b.dataset.aprobar, { estado: 'activo', aprobado_por: store.usuario.id, aprobado_at: new Date().toISOString() });
      ok('Proyecto aprobado. Ya aparece en el menú.');
      await cargarCatalogo(); refrescarCatalogo();
    } catch (e) { error(mensajeError(e)); }
  });
  cont.querySelectorAll('[data-rechazar]').forEach(b => b.onclick = async () => {
    const d = await pedirDatos({ titulo: 'Rechazar proyecto', texto: 'Rechazar', campos: [{ name: 'motivo', label: 'Motivo (se notifica a quien lo propuso)', type: 'textarea', required: true }] });
    if (!d) return;
    try {
      await api.update('proyectos', b.dataset.rechazar, { estado: 'rechazado', motivo_rechazo: d.motivo });
      ok('Proyecto rechazado.');
      await cargarCatalogo(); refrescarCatalogo();
    } catch (e) { error(mensajeError(e)); }
  });
}

/**
 * CET / Servicio nuevo (pedido 100): Proyecto, CET y Servicio. Lo pueden agregar los líderes (permiso "agregar_cet");
 * queda en la lista compartida "CET / Servicio" y lo ve todo el equipo. Devuelve el id del valor creado.
 */
export async function nuevoCETServicio({ proyectoId = null } = {}) {
  const lista = store.listas.servicios?.lista;
  if (!lista) return null;
  let creado = null;
  await pedirDatos({
    titulo: 'Agregar CET / Servicio', texto: 'Agregar',
    antes: 'El CET / Servicio queda disponible para todo el equipo en el Plan, el Look Ahead, las Plantillas y la Cartera.',
    valores: { proyecto_id: proyectoId || store.proyectoSel || '' },
    campos: [
      { name: 'proyecto_id', label: 'Proyecto', type: 'select', options: opcionesProyectos().map(o => ({ value: o.value ?? '', label: o.label })) },
      { name: 'codigo', label: 'CET', required: true, placeholder: 'Código del servicio (p. ej. CET0594)' },
      { name: 'valor', label: 'Servicio', required: true, full: true },
    ],
    alGuardar: async d => {
      const codigo = String(d.codigo || '').trim(), valor = String(d.valor || '').trim();
      const todos = store.listas.servicios.valores;
      if (todos.some(v => (v.codigo || '').trim().toLowerCase() === codigo.toLowerCase())) throw new Error(`El CET "${codigo}" ya existe.`);
      const orden = Math.max(0, ...todos.map(v => Number(v.orden) || 0)) + 10;
      const [v] = await api.insert('lista_valores', { lista_id: lista.id, codigo, valor, orden, activo: true, extra: d.proyecto_id ? { proyecto_id: d.proyecto_id } : {} });
      creado = v?.id || null;
      await cargarCatalogo();
      ok(`CET / Servicio "${codigo} · ${valor}" agregado.`);
    },
  });
  return creado;
}

/** Alta de proyecto: crea (administrador, delegado o líder con "agregar_proyecto") o propone. */
// sub: alta de un Grupo LPS (botón «+ Agregar» del menú GRUPOS LPS, pedido q10): se elige el proyecto al que
// pertenece y hereda de él la gerencia, el portafolio y el programa
export async function formularioProyecto(p = null, { sub = false } = {}) {
  const crea = puedeAgregarProyecto();
  const raices = store.proyectos.filter(x => !x.padre_id && x.id !== p?.id && !['cerrado', 'rechazado'].includes(x.estado));
  if (sub && !raices.length) { error('Primero cree un proyecto (en Administración › Estructura): el Grupo LPS pertenece a un proyecto.'); return; }
  // Proyecto sugerido: el elegido en el menú (o el padre del Grupo LPS elegido)
  const sel = store.proyectoSel && store.proyectos.find(x => x.id === store.proyectoSel);
  const padreSugerido = sel ? (sel.padre_id || sel.id) : (raices.length === 1 ? raices[0].id : '');
  // Jerarquía de la empresa: Portafolio → Programa → Proyecto (ambos opcionales)
  const [portafolios, programas] = await Promise.all([
    api.list('portafolios', { eq: { area_id: store.area.id }, order: [['nombre', true]] }).catch(() => []),
    api.list('programas', { eq: { area_id: store.area.id }, order: [['nombre', true]] }).catch(() => []),
  ]);
  const nomPort = id => portafolios.find(x => x.id === id)?.nombre;
  const d = await pedirDatos({
    titulo: p ? 'Editar proyecto' : sub ? (crea ? 'Nuevo Grupo LPS' : 'Proponer Grupo LPS') : crea ? 'Nuevo proyecto' : 'Proponer proyecto',
    texto: p ? 'Guardar' : crea ? 'Crear' : 'Enviar propuesta',
    antes: [sub ? 'El Grupo LPS pertenece a un proyecto: hereda su gerencia, portafolio, programa y líderes. En él se registra el LPS (Look Ahead y Plan semanal).' : '',
      !crea && !p ? 'Quedará "Propuesto" hasta que el administrador lo apruebe. Mientras tanto ya puede registrar actividades en él.' : ''].filter(Boolean).join(' '),
    valores: p || { estado: 'activo', ...(sub ? { padre_id: padreSugerido } : {}) },
    campos: sub ? [
      { name: 'padre_id', label: 'Proyecto al que pertenece', type: 'select', required: true, full: true,
        options: [{ value: '', label: '— Elija el proyecto —' }, ...raices.map(x => ({ value: x.id, label: `${x.codigo} · ${x.nombre_corto}` }))] },
      { name: 'codigo', label: 'Código', required: true, placeholder: 'Ej.: GT-OT-003' },
      { name: 'nombre_corto', label: 'Nombre corto (menú)', required: true },
      { name: 'nombre_completo', label: 'Nombre completo' },
      { name: 'fase_id', label: 'Fase', type: 'select', options: opciones('fases') },
      { name: 'fecha_inicio', label: 'Inicio previsto', type: 'date' },
      { name: 'fecha_fin', label: 'Fin previsto', type: 'date' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
    ] : [
      { name: 'codigo', label: 'Código', required: true, placeholder: 'Ej.: 3126 o INT-012' },
      { name: 'nombre_corto', label: 'Nombre corto (menú)', required: true },
      { name: 'nombre_completo', label: 'Nombre completo' },
      { name: 'gerencia_id', label: 'Gerencia', type: 'select', required: true, options: opciones('gerencias') },
      { name: 'fase_id', label: 'Fase', type: 'select', options: opciones('fases') },
      { name: 'pais_id', label: 'País', type: 'select', options: opciones('paises') },
      // Grupo LPS (pedido a7): el LPS se registra en los Grupos LPS; heredan portafolio, programa y líderes
      ...(store.proyectos.some(x => x.padre_id === p?.id) ? [] : [{ name: 'padre_id', label: 'Grupo LPS de (opcional)', type: 'select',
        options: store.proyectos.filter(x => !x.padre_id && x.id !== p?.id && !['cerrado', 'rechazado'].includes(x.estado))
          .map(x => ({ value: x.id, label: `${x.codigo} · ${x.nombre_corto}` })) }]),
      { name: 'portafolio_id', label: 'Portafolio', type: 'select',
        options: portafolios.filter(x => x.estado !== 'inactivo' || x.id === p?.portafolio_id).map(x => ({ value: x.id, label: x.nombre })) },
      { name: 'programa_id', label: 'Programa', type: 'select',
        options: programas.filter(x => x.estado !== 'inactivo' || x.id === p?.programa_id)
          .map(x => ({ value: x.id, label: nomPort(x.portafolio_id) ? `${nomPort(x.portafolio_id)} › ${x.nombre}` : x.nombre })) },
      { name: 'fecha_inicio', label: 'Inicio previsto', type: 'date' },
      { name: 'fecha_fin', label: 'Fin previsto', type: 'date' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
    ],
    alGuardar: async v => {
      const datos = { ...v, portafolio_id: v.portafolio_id || null, programa_id: v.programa_id || null };
      if ('padre_id' in v) datos.padre_id = v.padre_id || null;
      // Un Grupo LPS hereda la ubicación de su proyecto (en la base lo asegura public.tg_subproyecto)
      const padre = datos.padre_id && store.proyectos.find(x => x.id === datos.padre_id);
      if (padre) {
        datos.portafolio_id = padre.portafolio_id || null; datos.programa_id = padre.programa_id || null;
        if (!datos.gerencia_id) datos.gerencia_id = padre.gerencia_id || null;
        if (!datos.pais_id && padre.pais_id) datos.pais_id = padre.pais_id;
      }
      // El programa define su portafolio
      const prog = programas.find(x => x.id === datos.programa_id);
      if (prog?.portafolio_id) datos.portafolio_id = prog.portafolio_id;
      if (store.proyectos.some(x => x.codigo === datos.codigo && x.id !== p?.id)) throw new Error('Ya existe un proyecto con ese código.');
      let reg;
      if (p) reg = await api.update('proyectos', p.id, datos);
      else [reg] = await api.insert('proyectos', { ...datos, area_id: store.area.id, estado: crea ? 'activo' : 'propuesto', propuesto_por: crea ? null : store.usuario.id });
      // Los líderes se asignan aparte (clic derecho → "Asignar líderes…"); quien propone queda como líder
      if (!crea && !p) {
        await api.insert('proyecto_lideres', { proyecto_id: reg.id, usuario_id: store.usuario.id }).catch(() => {});
      }
      ok(crea || p ? (sub ? 'Grupo LPS guardado.' : 'Proyecto guardado.') : 'Propuesta enviada al administrador.');
      await cargarCatalogo();
    },
  });
  if (d) refrescarCatalogo();
}

async function asignarLideres(p) {
  await pedirDatos({
    titulo: `Líderes de ${p.nombre_corto}`, texto: 'Guardar',
    campos: [{ name: 'lideres', label: 'Líderes', type: 'multiselect', unaColumna: true, options: opcionesEquipo(), value: lideresDe(p.id) }],
    alGuardar: async v => {
      await api.removeWhere('proyecto_lideres', { eq: { proyecto_id: p.id } });
      if (v.lideres.length) await api.insert('proyecto_lideres', v.lideres.map(u => ({ proyecto_id: p.id, usuario_id: u })));
      await cargarCatalogo();
      todasLasGrillas().forEach(g => g.refrescar());
    },
  });
}

async function ficha(el, id) {
  const p = proyecto(id);
  if (!p) { el.innerHTML = vacio('Proyecto no encontrado o sin permiso para verlo.'); return; }
  // Un proyecto con Grupos LPS suma lo registrado en ellos (el LPS se registra en los Grupos LPS)
  const ids = { in: { proyecto_id: [id, ...subproyectos(id).map(s => s.id)] } };
  const [acts, rests, hitos, cartera] = await Promise.all([
    api.list('actividades', ids),
    esStaff() ? api.list('restricciones', ids) : Promise.resolve([]),
    esStaff() ? api.list('hitos', { eq: { proyecto_id: id }, order: [['fecha', true]] }) : Promise.resolve([]),
    esStaff() ? api.list('cartera', ids) : Promise.resolve([]),
  ]);
  const r = resumenPAC(acts);
  const rr = resumenRestricciones(rests);
  const ult = acts.filter(a => a.semana >= sumarSemanas(lunes(), -4) && a.semana < lunes());
  const r4 = resumenPAC(ult);
  const pag = html(`<div>
    <div class="pagina-cab"><a href="${rutaCatalogo()}" class="btn btn-sm">‹ Proyectos</a>
      <h1>${esc(p.codigo)} · ${esc(p.nombre_corto)}</h1>${badge(textoEstado('estados_proyecto', p.estado), colorEstado('estados_proyecto', p.estado))}
      <span class="flex"></span>
      <button class="btn btn-sm" data-a="menu">🏗 Seleccionar en el menú</button>
      ${puedeEditarProyecto(p) ? '<button class="btn btn-sm" data-a="editar">✏ Editar</button>' : ''}
      ${esGestor() ? (p.estado === 'cerrado' ? '<button class="btn btn-sm" data-a="reactivar">▶ Reactivar</button>'
        : '<button class="btn btn-sm" data-a="desactivar" title="Recomendado: sale de menús y selectores y conserva el historial">⛔ Desactivar</button>') +
        '<button class="btn btn-sm btn-peligro-borde" data-a="eliminar" title="Solo si no tiene actividades ni otros registros">🗑 Eliminar</button>' : ''}
      <button class="btn btn-sm" data-a="pdf">🖨 PDF</button></div>
    <p class="pagina-sub">${esc(p.nombre_completo || '')}</p>
    <div class="kpis">
      ${kpi('PAC histórico', pct(r.pac), { color: colorPAC(r.pac), sub: `${r.completadas} de ${r.completadas + r.noCompletadas}` })}
      ${kpi('PAC últimas 4 semanas', pct(r4.pac), { color: colorPAC(r4.pac) })}
      ${kpi('HH planificadas', num(r.hhPlan))}
      ${kpi('HH reales', r.hhReal == null ? '—' : num(r.hhReal))}
      ${kpi('Restricciones abiertas', rr.abiertas, { color: rr.abiertas ? '#EDC948' : '#59A14F', sub: `${rr.vencidas} vencidas` })}
      ${kpi('Cartera abierta', cartera.filter(c => ['abierta', 'en_proceso', 'nueva'].includes(c.estado)).length)}
    </div>
    <div class="grid-2">
      <div class="tarjeta"><h2>Datos</h2><table class="simple">
        <tr><td>Gerencia</td><td>${esc(etiqueta(p.gerencia_id))}</td></tr>
        <tr><td>Fase</td><td>${esc(etiqueta(p.fase_id))}</td></tr>
        <tr><td>País</td><td>${esc(etiqueta(p.pais_id))}</td></tr><tr><td>Fechas</td><td>${fmtFecha(p.fecha_inicio)} – ${fmtFecha(p.fecha_fin)}</td></tr>
        <tr><td>Estado</td><td>${esc(textoEstado('estados_proyecto', p.estado))}</td></tr>
        ${p.propuesto_por ? `<tr><td>Propuesto por</td><td>${esc(nombre(p.propuesto_por))}${p.aprobado_at ? ` · aprobado el ${fmtFecha(p.aprobado_at)}` : ''}</td></tr>` : ''}
        ${p.motivo_rechazo ? `<tr><td>Motivo de rechazo</td><td>${esc(p.motivo_rechazo)}</td></tr>` : ''}
        <tr><td>Observaciones</td><td>${esc(p.observaciones || '')}</td></tr></table></div>
      <div class="tarjeta"><h2>Hitos</h2><div data-hitos></div>
        ${esStaff() ? '<button class="btn btn-sm" data-a="hito" style="margin-top:8px">＋ Agregar hito</button>' : ''}</div>
    </div>
    ${esStaff() ? '<div class="tarjeta" style="margin-top:14px"><h2>Comentarios y documentos</h2><div data-colab></div></div>' : ''}
  </div>`);
  el.append(pag);
  const pintarHitos = lista => {
    pag.querySelector('[data-hitos]').innerHTML = lista.length ? `<table class="simple"><tr><th>Hito / entregable</th><th>Fecha</th><th>Estado</th><th></th></tr>
      ${lista.map(h => `<tr><td>${esc(h.nombre)}</td><td>${fmtFecha(h.fecha)}</td><td>${badge(h.estado, { pendiente: '#EDC948', cumplido: '#59A14F', atrasado: '#E15759', cancelado: '#BAB0AC' }[h.estado])}</td>
        <td>${esStaff() ? `<select class="sel" data-hito="${h.id}">${['pendiente', 'cumplido', 'atrasado', 'cancelado'].map(e => `<option${e === h.estado ? ' selected' : ''}>${e}</option>`).join('')}</select>` : ''}</td></tr>`).join('')}</table>`
      : '<p class="nota">Sin hitos. Úselos solo cuando el proyecto lo amerite.</p>';
    pag.querySelectorAll('[data-hito]').forEach(s => s.onchange = async () => {
      try { await api.update('hitos', s.dataset.hito, { estado: s.value }); ok('Hito actualizado.'); } catch (e) { error(mensajeError(e)); }
    });
  };
  pintarHitos(hitos.map(h => (h.estado === 'pendiente' && h.fecha && h.fecha < hoy() ? { ...h, estado: 'atrasado' } : h)));
  pag.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'menu') { seleccionarProyecto(id); ok('Proyecto seleccionado en el menú.'); }
    if (a === 'editar') { await formularioProyecto(p); el.innerHTML = ''; ficha(el, id); }
    if (a === 'desactivar' || a === 'reactivar') { if (await cambiarEstado(p, a === 'desactivar' ? 'cerrado' : 'activo') !== false) { el.innerHTML = ''; ficha(el, id); } }
    if (a === 'eliminar') {
      try { if (await eliminarProyecto(p, { confirmaciones: 2 })) ir(rutaCatalogo()); else { el.innerHTML = ''; ficha(el, id); } } catch (err) { error(mensajeError(err)); }
    }
    if (a === 'hito') {
      await pedirDatos({ titulo: 'Nuevo hito', campos: [{ name: 'nombre', label: 'Hito / entregable', required: true, full: true }, { name: 'fecha', label: 'Fecha', type: 'date', required: true }],
        alGuardar: async v => { await api.insert('hitos', { ...v, area_id: store.area.id, proyecto_id: id }); } });
      pintarHitos(await api.list('hitos', { eq: { proyecto_id: id }, order: [['fecha', true]] }));
    }
    if (a === 'pdf') imprimirPDF('Ficha de proyecto', kpisPDF([['PAC', pct(r.pac), colorPAC(r.pac)], ['HH plan', num(r.hhPlan)], ['Restricciones abiertas', rr.abiertas]]) +
      tablaPDF([{ titulo: 'Campo', valor: x => x[0] }, { titulo: 'Valor', valor: x => x[1] }], [['Código', p.codigo], ['Nombre', p.nombre_completo || p.nombre_corto],
        ['Gerencia', etiqueta(p.gerencia_id)], ['Fase', etiqueta(p.fase_id)], ['País', etiqueta(p.pais_id)],
        ['Fechas', `${fmtFecha(p.fecha_inicio)} – ${fmtFecha(p.fecha_fin)}`], ['Estado', textoEstado('estados_proyecto', p.estado)]]) +
      '<h2>Hitos</h2>' + tablaPDF([{ titulo: 'Hito', valor: h => h.nombre }, { titulo: 'Fecha', valor: h => fmtFecha(h.fecha) }, { titulo: 'Estado', valor: h => h.estado }], hitos),
      { proyectoTexto: `${p.codigo} · ${p.nombre_corto}` });
  });
  const colab = pag.querySelector('[data-colab]');
  if (colab) colab.append(await panelColaboracion('proyecto', id));
}
