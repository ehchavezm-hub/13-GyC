// Programa de Arranque (CR-PG-SGP-01-F1 r1, pestañas "0.Datos", "1.Programa de arranque" y "3.Listas").
// Diseño basado en herramientas de referencia:
//   · Procore (checklists): ítems agrupados por sección con avance "x/y" por sección y ficha del ítem con historial.
//   · Smartsheet: filas agrupadas por fase (aquí, por Proceso), barras de avance en lugar de números.
//   · Monday / tablas empresariales: estado en pastillas de color y edición en la misma celda.
//   · Linear / Notion: panel lateral con el detalle del ítem.
// Dos vistas, una por tipo de reunión (cabeceras con los mismos nombres que el Excel):
//   · Definición (amarillo): Area, Aplica (Si / N/A), Resp., Inicio prog., Fin prog., Comentarios — un valor por ítem.
//   · Seguimiento (verde): Fecha rev., % Ava. Acu., Comentarios, Fin re-prog. — un registro por ítem y reunión.
import { medir } from '../core/monitoreo.js';
import { api, mensajeError } from '../data/api.js';
import { store, haySeleccion, nombreSeleccion, proyecto, lideresHeredados, nombre } from '../core/store.js';
import { esc, html, fmtFecha, hoy, sumarDias, libExcel, libGraficos, normalizar } from '../core/util.js';
import { icono } from '../ui/iconos.js';
import { error as mostrarError, pedirDatos, ok, confirmar } from '../ui/ui.js';
import { CAMPOS_INFO, puedeEditarProyecto } from './informacion-proyecto.js';

const DIAS_FIN_POR_DEFECTO = 90;   // como el formato: Fin prog. = Inicio prog. + 90
const PROXIMOS_DIAS = 14;          // "por vencer": fin vigente dentro de 14 días

// Lista "Aplicabilidad" de la pestaña 3.Listas
const APLICA = [{ value: 'si', label: 'Si' }, { value: 'na', label: 'N/A' }];

let estado = {};

// Columnas de cada vista (nombres del Excel) con su ancho por defecto (px). El ancho se cambia arrastrando el borde
// del encabezado, como en Excel; doble clic lo restablece. Se recuerda por vista en este navegador.
const COLUMNAS = {
  definicion: [
    { k: 'cod', txt: 'It', w: 42 }, { k: 'area', txt: 'Area', w: 150 },
    { k: 'act', txt: 'Descripción de actividad', w: 340 }, { k: 'apl', txt: 'Aplica', w: 76, cls: 'def' }, { k: 'resp', txt: 'Resp.', w: 160, cls: 'def' },
    { k: 'ini', txt: 'Inicio prog.', w: 104, cls: 'def' }, { k: 'fin', txt: 'Fin prog.', w: 104, cls: 'def' },
    { k: 'com', txt: 'Comentarios', w: 220, cls: 'def' }, { k: 'mas', txt: '', w: 44, fija: true },
  ],
  seguimiento: [
    { k: 'cod', txt: 'It', w: 42 }, { k: 'act', txt: 'Descripción de actividad', w: 300 }, { k: 'resp', txt: 'Resp.', w: 150 },
    { k: 'frev', txt: 'Fecha rev.', w: 96, cls: 'seg' }, { k: 'avant', txt: '% Ava. ant.', w: 92, cls: 'seg' }, { k: 'av', txt: '% Ava. Acu.', w: 150, cls: 'seg' },
    { k: 'com', txt: 'Comentarios', w: 200, cls: 'seg' }, { k: 'finr', txt: 'Fin re-prog.', w: 100, cls: 'seg' },
    { k: 'est', txt: 'Estado', w: 120 }, { k: 'mas', txt: '', w: 44, fija: true },
  ],
};
const ANCHO_MIN = 40;
const claveAnchos = modo => `gyc-arr-anchos2-${modo}`;
function anchos(modo) {
  let guardados = {};
  try { guardados = JSON.parse(localStorage.getItem(claveAnchos(modo)) || '{}'); } catch { /* sin almacenamiento */ }
  return COLUMNAS[modo].map(c => Math.max(ANCHO_MIN, Number(guardados[c.k]) || c.w));
}
function guardarAnchos(modo, lista) {
  try { localStorage.setItem(claveAnchos(modo), JSON.stringify(Object.fromEntries(COLUMNAS[modo].map((c, i) => [c.k, lista[i]])))); } catch { /* opcional */ }
}
const filtros = { texto: '', proceso: '', resp: '', aplica: '', estado: '' };
const plegados = new Set();
const leerModo = () => { try { return localStorage.getItem('gyc-arr-modo'); } catch { return null; } };
const guardarModo = m => { try { localStorage.setItem('gyc-arr-modo', m); } catch { /* opcional */ } };

export async function render(el) {
  el.innerHTML = '';
  const proyId = store.proyectoSel;
  if (!haySeleccion() || !proyId) {
    el.innerHTML = '<div class="aviso-vacio"><p>Selecciona un proyecto en el menú para ver su Programa de Arranque.</p></div>';
    return;
  }
  estado = { proyId, programa: null, items: [], detalle: new Map(), seguimientos: [], reunion: null, reuniones: [],
    editable: puedeEditarProyecto(proyId), modo: 'seguimiento' };

  const wrap = html(`<div class="pa">
    <div class="pa-cab">
      <h1>Programa de Arranque</h1><span class="proy-badge">${esc(nombreSeleccion())}</span>
      <span class="flex"></span>
      ${estado.editable ? '<button class="btn" data-a="importar" title="Cargar un Excel con el formato CR-PG-SGP-01-F1">⬆ Importar Excel</button>' : ''}
      <button class="btn" data-a="excel" title="Descargar en el formato CR-PG-SGP-01-F1">⬇ Excel</button>
    </div>
    <div data-kpis class="pa-kpis"></div>
    <div data-barra class="pa-barra"></div>
    <div data-tabla class="pa-tabla-wrap"></div>
  </div>`);
  el.append(wrap);
  wrap.querySelector('[data-a="excel"]').addEventListener('click', () => exportarExcel().catch(e => mostrarError(mensajeError(e))));
  wrap.querySelector('[data-a="importar"]')?.addEventListener('click', () => importarExcel().catch(e => mostrarError(mensajeError(e))));
  estado.wrap = wrap;

  try {
    await medir('programa-arranque.cargar', () => cargarDatos(proyId));
  } catch (e) {
    mostrarError(mensajeError(e));
    return;
  }
  estado.modo = leerModo() || (estado.reuniones.length ? 'seguimiento' : 'definicion');
  pintarTodo();
}

function pintarTodo() {
  pintarKpis();
  pintarBarra();
  pintarTabla();
}

// ── Datos ─────────────────────────────────────────────────────────────────────

async function cargarDatos(proyId) {
  const [items, programas] = await Promise.all([
    api.list('programa_arranque_items', { order: [['orden', true]] }),
    api.list('programa_arranque', { eq: { proyecto_id: proyId } }),
  ]);
  estado.items = items;
  if (programas.length) estado.programa = programas[0];
  else [estado.programa] = await api.insert('programa_arranque', { proyecto_id: proyId });
  const [detalles, seguimientos] = await Promise.all([
    api.list('programa_arranque_detalle', { eq: { programa_id: estado.programa.id } }),
    api.list('programa_arranque_seguimiento', { eq: { programa_id: estado.programa.id }, order: [['fecha_revision', true]] }),
  ]);
  estado.detalle = new Map(detalles.map(d => [d.item_codigo, d]));
  estado.seguimientos = seguimientos;
  estado.reuniones = [...new Set(seguimientos.map(s => s.fecha_revision))].sort();
  estado.reunion = estado.reuniones.at(-1) || hoy();
}

const det = c => estado.detalle.get(c) || {};
const item = c => estado.items.find(i => i.item_codigo === c);
/** Aplicabilidad en este proyecto: la elegida, o la del formato (Si para obligatorios, N/A para opcionales). */
const aplicaDe = c => det(c).aplica || (item(c)?.obligatorio ? 'si' : 'na');
const aplica = c => aplicaDe(c) === 'si';
const segDe = (c, fecha = estado.reunion) => estado.seguimientos.find(s => s.item_codigo === c && s.fecha_revision === fecha);
/** Último registro de una reunión ANTERIOR a la elegida (columna "% Ava. ant."). */
const segAnterior = (c, fecha = estado.reunion) => estado.seguimientos.filter(s => s.item_codigo === c && s.fecha_revision < fecha).at(-1);
const segVigente = (c, hasta = estado.reunion) => estado.seguimientos.filter(s => s.item_codigo === c && s.fecha_revision <= hasta).at(-1);
const avanceDe = c => Number(segVigente(c)?.avance ?? 0);
const finVigente = c => segVigente(c)?.fin_reprogramado || det(c).fin_programado || null;
const respDe = c => { const d = det(c); return d.responsable_id ? (nombre(d.responsable_id) || d.responsable) : d.responsable; };

/** Estado del ítem a la fecha de la reunión elegida. */
const ESTADOS = {
  terminado: { txt: 'Terminado', cls: 'ok' },
  atrasado: { txt: 'Atrasado', cls: 'mal' },
  por_vencer: { txt: 'Por vencer', cls: 'aviso' },
  en_curso: { txt: 'En curso', cls: 'curso' },
  por_iniciar: { txt: 'Por iniciar', cls: 'neutro' },
  sin_definir: { txt: 'Sin definir', cls: 'vacio' },
  no_aplica: { txt: 'N/A', cls: 'na' },
};
function estadoDe(c) {
  if (!aplica(c)) return 'no_aplica';
  const d = det(c), av = avanceDe(c), fin = finVigente(c), ref = estado.reunion;
  if (av >= 100) return 'terminado';
  if (fin && fin < ref) return 'atrasado';
  if (fin && fin <= sumarDias(ref, PROXIMOS_DIAS)) return 'por_vencer';
  if (av > 0) return 'en_curso';
  if (!(d.responsable_id || d.responsable) || !d.inicio_programado || !d.fin_programado) return 'sin_definir';
  return 'por_iniciar';
}

function usuariosProyecto() {
  const ids = new Set(lideresHeredados(estado.proyId));
  const activos = store.perfiles.filter(p => p.activo && !p.eliminado && p.rol !== 'pendiente');
  const delProyecto = activos.filter(p => ids.has(p.id));
  return { lista: (delProyecto.length ? delProyecto : activos).sort((a, b) => a.nombre.localeCompare(b.nombre)), soloProyecto: delProyecto.length > 0 };
}

const barra = (pct, cls = '') => `<span class="pa-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>`;

// ── Indicadores (solo los ítems que aplican) ──────────────────────────────────

function pintarKpis() {
  const items = estado.items.filter(i => aplica(i.item_codigo)), n = items.length || 1;
  const est = items.map(i => estadoDe(i.item_codigo));
  const cuenta = k => est.filter(x => x === k).length;
  const promedio = Math.round(items.reduce((s, i) => s + avanceDe(i.item_codigo), 0) / n);
  const noAplican = estado.items.length - items.length;
  const sinResp = items.filter(i => !(det(i.item_codigo).responsable_id || det(i.item_codigo).responsable)).length;
  const tarjeta = (clave, valor, etiqueta, pie, cls = '') => `<button class="pa-kpi ${cls}${filtros.estado === clave ? ' activo' : ''}" data-kpi="${clave}" title="Filtrar la tabla">
    <span class="pa-kpi-linea"><span class="pa-kpi-val">${valor}</span><span class="pa-kpi-lbl">${etiqueta}</span></span>${pie ? `<span class="pa-kpi-pie">${pie}</span>` : ''}</button>`;
  const caja = estado.wrap.querySelector('[data-kpis]');
  caja.innerHTML = `<div class="pa-kpi pa-kpi-avance">
      <span class="pa-kpi-linea"><span class="pa-kpi-val">${promedio}%</span><span class="pa-kpi-lbl">Avance al ${fmtFecha(estado.reunion)}</span></span>${barra(promedio, 'grande')}
      <span class="pa-kpi-pie">${cuenta('terminado')}/${items.length} terminados · ${noAplican} N/A</span></div>
    ${tarjeta('atrasado', cuenta('atrasado'), 'Atrasados', 'fin vencido sin 100%', 'mal')}
    ${tarjeta('por_vencer', cuenta('por_vencer'), 'Por vencer', `próximos ${PROXIMOS_DIAS} días`, 'aviso')}
    ${tarjeta('en_curso', cuenta('en_curso'), 'En curso', 'con avance', 'curso')}
    ${tarjeta('sin_definir', cuenta('sin_definir'), 'Sin definir', `${sinResp} sin responsable`, 'vacio')}`;
  caja.onclick = e => {
    const k = e.target.closest('[data-kpi]')?.dataset.kpi;
    if (!k) return;
    filtros.estado = filtros.estado === k ? '' : k;
    pintarKpis(); pintarTabla();
  };
}

// ── Barra de herramientas: vista, reunión y filtros ───────────────────────────

function pintarBarra() {
  const procesos = [...new Set(estado.items.map(i => i.proceso))];
  const { lista } = usuariosProyecto();
  const fechas = [...new Set([...estado.reuniones, estado.reunion])].sort().reverse();
  const seg = estado.modo === 'seguimiento';
  const curva = estado.modo === 'curva';
  const conReunion = seg || curva;
  const caja = estado.wrap.querySelector('[data-barra]');
  caja.innerHTML = `
    <div class="pa-vistas" role="tablist">
      <button role="tab" data-modo="definicion" class="def${estado.modo === 'definicion' ? ' activo' : ''}" aria-selected="${estado.modo === 'definicion'}">Definición</button>
      <button role="tab" data-modo="seguimiento" class="seg${seg ? ' activo' : ''}" aria-selected="${seg}">Seguimiento</button>
    </div>
    ${conReunion ? `<label class="pa-reunion">Reunión del
        <select data-f="reunion">${fechas.map(f => `<option value="${f}"${f === estado.reunion ? ' selected' : ''}>${fmtFecha(f)}${estado.reuniones.includes(f) ? '' : ' (nueva)'}</option>`).join('')}</select></label>
      ${estado.editable ? '<button class="btn btn-sm" data-a="nueva" title="Nueva reunión de seguimiento">＋ Reunión</button>' : ''}`
      : '<span class="pa-nota">Reunión de definición</span>'}
    <button role="tab" class="pa-tab-curva${curva ? ' activo' : ''}" data-modo="curva" aria-selected="${curva}" title="Avance programado vs. real">${icono('grafico')} Curva S</button>
    <span class="flex"></span>
    <input type="search" class="pa-buscar" data-f="texto" placeholder="Buscar…" value="${esc(filtros.texto)}">
    <select data-f="proceso"><option value="">Proceso: todos</option>${procesos.map(p => `<option${p === filtros.proceso ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
    <select data-f="resp"><option value="">Resp.: todos</option><option value="-"${filtros.resp === '-' ? ' selected' : ''}>Sin responsable</option>
      ${lista.map(u => `<option value="${esc(u.id)}"${u.id === filtros.resp ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>
    <select data-f="aplica" title="Aplica (lista de aplicabilidad)">
      <option value="si"${filtros.aplica === 'si' ? ' selected' : ''}>Aplica: Si</option>
      <option value="na"${filtros.aplica === 'na' ? ' selected' : ''}>Aplica: N/A</option>
      <option value=""${filtros.aplica === '' ? ' selected' : ''}>Aplica: todos</option></select>`;
  caja.onclick = async e => {
    const m = e.target.closest('[data-modo]')?.dataset.modo;
    if (m && m !== estado.modo) { estado.modo = m; guardarModo(m === 'curva' ? 'seguimiento' : m); pintarBarra(); pintarTabla(); return; }
    if (e.target.closest('[data-a="nueva"]')) {
      const d = await pedirDatos({
        titulo: 'Nueva reunión de seguimiento',
        antes: 'El avance, los comentarios y el fin re-programado se registrarán para esta fecha. Las reuniones anteriores quedan en el historial de cada ítem.',
        campos: [{ name: 'fecha', label: 'Fecha rev.', type: 'date', required: true }], valores: { fecha: hoy() },
      });
      if (!d?.fecha) return;
      estado.reunion = d.fecha;
      pintarTodo();
    }
  };
  caja.oninput = e => { if (e.target.dataset.f === 'texto') { filtros.texto = e.target.value; pintarTabla(); } };
  caja.onchange = e => {
    const f = e.target.dataset.f;
    if (!f || f === 'texto') return;
    if (f === 'reunion') { estado.reunion = e.target.value; pintarTodo(); return; }
    filtros[f] = e.target.value;
    pintarTabla();
  };
}

// ── Tabla agrupada por Proceso ────────────────────────────────────────────────

function filtrados() {
  const t = filtros.texto.trim().toLowerCase();
  return estado.items.filter(i => {
    const d = det(i.item_codigo);
    return (!filtros.proceso || i.proceso === filtros.proceso) && (!filtros.aplica || aplicaDe(i.item_codigo) === filtros.aplica) &&
      (!filtros.resp || (filtros.resp === '-' ? !d.responsable_id && !d.responsable : d.responsable_id === filtros.resp)) &&
      (!filtros.estado || estadoDe(i.item_codigo) === filtros.estado) &&
      (!t || `${i.item_codigo} ${i.descripcion} ${i.area_lider} ${i.proceso}`.toLowerCase().includes(t));
  });
}

function pintarTabla() {
  if (estado.modo === 'curva') return pintarCurva();
  const seg = estado.modo === 'seguimiento';
  const ed = estado.editable ? ' data-editable' : '';
  const items = filtrados();
  const grupos = [];
  for (const i of items) {
    let g = grupos.find(x => x.proceso === i.proceso);
    if (!g) grupos.push(g = { proceso: i.proceso, items: [] });
    g.items.push(i);
  }
  const modo = seg ? 'seguimiento' : 'definicion';
  const cols = COLUMNAS[modo], ws = anchos(modo), ncols = cols.length;
  const colgroup = `<colgroup>${ws.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
  const cab = `<tr>${cols.map((c, n) => `<th class="${c.cls || ''}">${esc(c.txt)}${c.fija ? '' : `<span class="pa-resize" data-col="${n}" title="Arrastre para cambiar el ancho · doble clic: ajustar al contenido"></span>`}</th>`).join('')}</tr>`;

  const fila = i => {
    const c = i.item_codigo, d = det(c), r = respDe(c), k = estadoDe(c), apl = aplica(c);
    const clase = apl ? '' : 'na';
    const desc = `<td class="c-act"><div class="pa-desc">${esc(i.descripcion)}</div>${seg ? `<div class="pa-meta">${esc(i.area_lider)}${apl ? '' : '<span class="pa-na">N/A</span>'}</div>` : ''}</td>`;
    const resp = `<td class="c-resp"${ed} data-campo="responsable_id">${r ? `<span class="pa-resp-n">${esc(r)}</span>` : `<span class="pa-vacio">${apl ? 'Asignar' : ''}</span>`}</td>`;
    const mas = `<td class="c-mas"><button class="pa-mas" data-ficha="${esc(c)}" title="Abrir ficha del ítem e historial">›</button></td>`;
    if (!seg) {
      return `<tr data-item-row="${esc(c)}" class="${clase}">
        <td class="c-cod"><span class="pa-cod">${esc(c)}</span></td>
        <td class="c-area">${esc(i.area_lider)}</td>
        ${desc}
        <td class="c-apl"${ed} data-campo="aplica"><span class="pa-aplica ${aplicaDe(c)}">${aplicaDe(c) === 'si' ? 'Si' : 'N/A'}</span></td>
        ${resp}
        <td class="c-fecha"${ed} data-campo="inicio_programado">${d.inicio_programado ? fmtFecha(d.inicio_programado) : '<span class="pa-vacio">—</span>'}</td>
        <td class="c-fecha"${ed} data-campo="fin_programado">${d.fin_programado ? fmtFecha(d.fin_programado) : '<span class="pa-vacio">—</span>'}</td>
        <td class="c-com"${ed} data-campo="comentarios">${esc(d.comentarios || '')}</td>${mas}</tr>`;
    }
    const s = segDe(c), ref = !s && segVigente(c), v = s || ref || {};
    const av = v.avance != null ? Number(v.avance) : null;
    const ant = segAnterior(c), avAnt = ant?.avance != null ? Number(ant.avance) : null;
    const delta = s && av !== null && avAnt !== null ? Math.round((av - avAnt) * 10) / 10 : null;
    return `<tr data-item-row="${esc(c)}" class="${clase}">
      <td class="c-cod"><span class="pa-cod">${esc(c)}</span></td>${desc}${resp}
      <td class="c-fecha${ref ? ' ref' : ''}" title="${ref ? `Sin registro en esta reunión: se muestra la del ${fmtFecha(ref.fecha_revision)}` : ''}">${v.fecha_revision ? fmtFecha(v.fecha_revision) : ''}</td>
      <td class="c-avant" title="${ant ? `Reunión del ${fmtFecha(ant.fecha_revision)}` : 'Sin reunión anterior'}">${avAnt !== null ? `${avAnt}%` : '<span class="pa-vacio">—</span>'}</td>
      <td class="c-av${ref ? ' ref' : ''}"${apl ? ed : ''} data-seg data-campo="avance">
        ${av !== null ? `<span class="pa-av">${barra(av, av >= 100 ? 'ok' : '')}<b>${av}%</b>${delta ? `<small class="pa-delta ${delta > 0 ? 'sube' : 'baja'}" title="Respecto a la reunión anterior">${delta > 0 ? '+' : ''}${delta}</small>` : ''}</span>` : `<span class="pa-vacio">${apl ? '0%' : ''}</span>`}</td>
      <td class="c-com${ref ? ' ref' : ''}"${apl ? ed : ''} data-seg data-campo="comentarios">${esc(v.comentarios || '')}</td>
      <td class="c-fecha${ref ? ' ref' : ''}${k === 'atrasado' ? ' tarde' : ''}"${apl ? ed : ''} data-seg data-campo="fin_reprogramado">${v.fin_reprogramado ? fmtFecha(v.fin_reprogramado) : ''}</td>
      <td class="c-est"><span class="pa-estado ${ESTADOS[k].cls}">${ESTADOS[k].txt}</span></td>${mas}</tr>`;
  };

  const cuerpo = grupos.map(g => {
    const apl = g.items.filter(i => aplica(i.item_codigo));
    const terminados = apl.filter(i => avanceDe(i.item_codigo) >= 100).length;
    const prom = apl.length ? Math.round(apl.reduce((s, i) => s + avanceDe(i.item_codigo), 0) / apl.length) : 0;
    const atr = apl.filter(i => estadoDe(i.item_codigo) === 'atrasado').length;
    const cerrado = plegados.has(g.proceso);
    return `<tbody class="pa-grupo${cerrado ? ' plegado' : ''}">
      <tr class="pa-grupo-cab" data-grupo="${esc(g.proceso)}"><td colspan="${ncols}"><div class="pa-grupo-in">
        <span class="pa-flecha">${cerrado ? '▸' : '▾'}</span><b>${esc(g.proceso)}</b>
        <span class="pa-grupo-n">${terminados}/${apl.length} terminados</span>${barra(prom)}<span class="pa-grupo-n">${prom}%</span>
        ${atr ? `<span class="pa-estado mal">${atr} atrasado${atr > 1 ? 's' : ''}</span>` : ''}</div></td></tr>
      ${cerrado ? '' : g.items.map(fila).join('')}</tbody>`;
  }).join('');

  const tabla = estado.wrap.querySelector('[data-tabla]');
  tabla.innerHTML = `<table class="pa-tabla ${seg ? 'modo-seg' : 'modo-def'}" style="width:${ws.reduce((a, b) => a + b, 0)}px">${colgroup}<thead>${cab}</thead>
    ${cuerpo || `<tbody><tr><td colspan="${ncols}" class="pa-sin">No hay ítems con estos filtros.</td></tr></tbody>`}</table>
    <p class="pa-pie">${items.length} de ${estado.items.length} ítems${estado.editable ? ' · Haga clic en una celda para editarla; «›» abre la ficha del ítem con su historial.' : ' · Solo lectura.'}</p>`;
  activarRedimension(tabla, modo);
  tabla.onclick = e => {
    if (e.target.closest('.pa-resize')) return;
    const g = e.target.closest('[data-grupo]');
    if (g) { const p = g.dataset.grupo; plegados.has(p) ? plegados.delete(p) : plegados.add(p); pintarTabla(); return; }
    const f = e.target.closest('[data-ficha]');
    if (f) return abrirFicha(f.dataset.ficha);
    const td = e.target.closest('[data-editable]');
    if (td && !td.querySelector('input,select,textarea')) editarCelda(td);
  };
}

// ── Curva S: avance programado vs. real ───────────────────────────────────────
// Programado: cada ítem que aplica avanza linealmente de 0 % (Inicio prog.) a 100 % (Fin prog.); la curva es el
// promedio de los ítems. Real: el % Ava. Acu. promedio registrado en cada reunión de seguimiento.

const fechaMas = (f, d) => sumarDias(f, d);
function planItem(d, t) {
  if (!d.inicio_programado || !d.fin_programado) return 0;
  if (t <= d.inicio_programado) return 0;
  if (t >= d.fin_programado) return 100;
  const total = (new Date(d.fin_programado) - new Date(d.inicio_programado)) / 86400000;
  return total > 0 ? ((new Date(t) - new Date(d.inicio_programado)) / 86400000) / total * 100 : 100;
}
function datosCurva() {
  const items = filtrados().filter(i => aplica(i.item_codigo));
  const n = items.length || 1;
  const conFechas = items.filter(i => det(i.item_codigo).inicio_programado && det(i.item_codigo).fin_programado);
  const fechasPlan = conFechas.flatMap(i => [det(i.item_codigo).inicio_programado, det(i.item_codigo).fin_programado]);
  const extremos = [...fechasPlan, ...estado.reuniones, estado.reunion].sort();
  if (!extremos.length) return null;
  const desde = extremos[0], hasta = extremos.at(-1);
  const fechas = new Set([...estado.reuniones, estado.reunion]);
  for (let f = desde; f <= hasta; f = fechaMas(f, 7)) fechas.add(f);
  fechas.add(hasta);
  const eje = [...fechas].filter(f => f >= desde && f <= hasta).sort();
  const prog = f => Math.round(items.reduce((s, i) => s + planItem(det(i.item_codigo), f), 0) / n * 10) / 10;
  const real = f => Math.round(items.reduce((s, i) => s + Number(segVigente(i.item_codigo, f)?.avance ?? 0), 0) / n * 10) / 10;
  return {
    items, sinFechas: items.length - conFechas.length, eje,
    programado: eje.map(prog),
    real: eje.map(f => (estado.reuniones.includes(f) && f <= estado.reunion ? real(f) : null)),
    reuniones: estado.reuniones.filter(f => f <= estado.reunion).map(f => ({ f, p: prog(f), r: real(f) })),
  };
}

async function pintarCurva() {
  const caja = estado.wrap.querySelector('[data-tabla]');
  estado.grafico?.destroy?.();
  const c = datosCurva();
  if (!c || !c.items.length) {
    caja.innerHTML = '<p class="pa-sin">No hay ítems que apliquen con estos filtros.</p>';
    return;
  }
  const ultima = c.reuniones.at(-1);
  const p = c.programado[c.eje.indexOf(estado.reunion)] ?? 0;
  const r = ultima ? ultima.r : 0;
  const desv = Math.round((r - p) * 10) / 10;
  const indice = p > 0 ? Math.round(r / p * 100) / 100 : null;
  caja.innerHTML = `<div class="pa-curva">
    <div class="pa-curva-res">
      <span><i class="pa-ley prog"></i>Programado al ${fmtFecha(estado.reunion)}: <b>${p}%</b></span>
      <span><i class="pa-ley real"></i>Real: <b>${r}%</b></span>
      <span>Desviación: <b class="${desv < 0 ? 'baja' : 'sube'}">${desv > 0 ? '+' : ''}${desv} pts</b></span>
      <span title="Real ÷ Programado (1,00 = según lo programado)">Índice de desempeño: <b class="${indice !== null && indice < 1 ? 'baja' : 'sube'}">${indice === null ? '—' : indice.toFixed(2)}</b></span>
      <span class="pa-vacio">${c.items.length} ítems que aplican${c.sinFechas ? ` · ${c.sinFechas} sin fechas programadas (cuentan 0 % programado)` : ''}</span>
    </div>
    <div class="pa-curva-graf"><canvas data-g="curva"></canvas></div>
    <table class="pa-curva-tabla"><thead><tr><th>Fecha rev.</th><th>% Programado</th><th>% Real</th><th>Desviación</th><th>Índice</th></tr></thead>
      <tbody>${c.reuniones.length ? c.reuniones.slice().reverse().map(x => {
        const d = Math.round((x.r - x.p) * 10) / 10;
        return `<tr><td>${fmtFecha(x.f)}</td><td>${x.p}%</td><td>${x.r}%</td><td class="${d < 0 ? 'baja' : 'sube'}">${d > 0 ? '+' : ''}${d}</td><td>${x.p > 0 ? (x.r / x.p).toFixed(2) : '—'}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="pa-vacio">Aún no hay reuniones de seguimiento.</td></tr>'}</tbody></table>
  </div>`;
  const Chart = await libGraficos();
  if (estado.modo !== 'curva') return;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const iReunion = c.eje.indexOf(estado.reunion);
  const lineaReunion = {
    id: 'lineaReunion',
    afterDatasetsDraw(ch) {
      if (iReunion < 0) return;
      const x = ch.scales.x.getPixelForValue(iReunion), { top, bottom } = ch.chartArea, g = ch.ctx;
      g.save(); g.strokeStyle = css('--dark'); g.setLineDash([4, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke();
      g.setLineDash([]); g.fillStyle = css('--dark'); g.font = '11px sans-serif'; g.fillText(`Reunión ${fmtFecha(estado.reunion)}`, x + 4, top + 12);
      g.restore();
    },
  };
  estado.grafico = new Chart(caja.querySelector('[data-g="curva"]'), {
    type: 'line',
    data: {
      labels: c.eje.map(fmtFecha),
      datasets: [
        { label: 'Programado', data: c.programado, borderColor: css('--azul'), backgroundColor: css('--azul'), borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: 'Real', data: c.real, borderColor: css('--naranja'), backgroundColor: css('--naranja'), borderWidth: 3, pointRadius: 4, spanGaps: true, tension: 0.2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { y: { min: 0, max: 100, ticks: { callback: v => `${v}%` } }, x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } } },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.parsed.y}%` } } },
    },
    plugins: [lineaReunion],
  });
}

// ── Ancho de columnas con el mouse (como Excel) ───────────────────────────────

function activarRedimension(tabla, modo) {
  const t = tabla.querySelector('table');
  const cols = [...t.querySelectorAll('col')];
  const total = () => cols.reduce((s, c) => s + parseFloat(c.style.width), 0);
  tabla.querySelectorAll('.pa-resize').forEach(asa => {
    const n = Number(asa.dataset.col);
    asa.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.pageX, w0 = parseFloat(cols[n].style.width);
      asa.classList.add('activo');
      document.body.classList.add('pa-redimensionando');
      const mover = ev => {
        cols[n].style.width = `${Math.max(ANCHO_MIN, Math.round(w0 + ev.pageX - x0))}px`;
        t.style.width = `${total()}px`;
      };
      const soltar = () => {
        document.removeEventListener('mousemove', mover);
        document.removeEventListener('mouseup', soltar);
        asa.classList.remove('activo');
        document.body.classList.remove('pa-redimensionando');
        guardarAnchos(modo, cols.map(c => parseFloat(c.style.width)));
      };
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', soltar);
    });
    // Doble clic: ajusta la columna a su contenido, como en Excel
    asa.addEventListener('dblclick', e => {
      e.stopPropagation();
      cols[n].style.width = `${anchoAjustado(t, n)}px`;
      t.style.width = `${total()}px`;
      guardarAnchos(modo, cols.map(c => parseFloat(c.style.width)));
    });
  });
}

const ANCHO_MAX_AJUSTE = 520;
/** Ancho para que el contenido de la columna n quepa en una línea (encabezado y filas visibles). */
function anchoAjustado(t, n) {
  const medidor = document.createElement('div');
  medidor.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;display:inline-block';
  t.parentElement.append(medidor);
  let max = ANCHO_MIN;
  const celdas = [t.querySelector('thead tr')?.children[n], ...[...t.querySelectorAll('tbody tr[data-item-row]')].map(r => r.children[n])];
  for (const c of celdas) {
    if (!c) continue;
    const cs = getComputedStyle(c);
    medidor.style.font = cs.font;
    medidor.style.textTransform = cs.textTransform;
    medidor.style.letterSpacing = cs.letterSpacing;
    medidor.innerHTML = c.innerHTML;
    medidor.querySelectorAll('.pa-resize').forEach(x => x.remove());
    medidor.querySelectorAll('.pa-desc').forEach(x => { x.style.display = 'inline'; x.style.webkitLineClamp = 'unset'; });
    medidor.querySelectorAll('.pa-meta').forEach(x => x.remove());
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    max = Math.max(max, Math.ceil(medidor.getBoundingClientRect().width + pad + 2));
  }
  medidor.remove();
  return Math.min(ANCHO_MAX_AJUSTE, max);
}

// ── Edición en la celda ───────────────────────────────────────────────────────

function control(campo, actual) {
  if (campo === 'responsable_id') {
    const { lista, soloProyecto } = usuariosProyecto();
    return `<select class="cel-input"><option value="">— Sin asignar —</option>
      ${lista.map(u => `<option value="${esc(u.id)}"${u.id === actual ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}
      ${soloProyecto ? '' : '<option disabled>(el proyecto aún no tiene miembros: se listan todos)</option>'}</select>`;
  }
  if (campo === 'aplica') return `<select class="cel-input">${APLICA.map(o => `<option value="${o.value}"${o.value === actual ? ' selected' : ''}>${o.label}</option>`).join('')}</select>`;
  if (campo === 'avance') return `<input type="number" class="cel-input" min="0" max="100" step="5" value="${actual ?? ''}" placeholder="%">`;
  if (/programado|reprogramado/.test(campo)) return `<input type="date" class="cel-input" value="${actual || ''}">`;
  // Texto (comentarios): crece hacia abajo mientras se escribe
  return `<textarea class="cel-input cel-texto" rows="1">${esc(actual || '')}</textarea>`;
}

/** Ajusta la altura del cuadro de texto a su contenido. */
function crecer(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

function editarCelda(td) {
  const codigo = td.closest('[data-item-row]').dataset.itemRow;
  const campo = td.dataset.campo;
  const esSeg = td.hasAttribute('data-seg');
  const actual = campo === 'aplica' ? aplicaDe(codigo) : esSeg ? segDe(codigo)?.[campo] : det(codigo)[campo];
  td.innerHTML = control(campo, actual);
  const inp = td.querySelector('input,select,textarea');
  inp.focus();
  if (inp.tagName === 'TEXTAREA') {
    crecer(inp);
    inp.setSelectionRange(inp.value.length, inp.value.length);
    inp.addEventListener('input', () => crecer(inp));
  }
  let terminado = false;
  const terminar = async guardar => {
    if (terminado) return;
    terminado = true;
    if (guardar) {
      try {
        if (esSeg) await guardarSeguimiento(codigo, { [campo]: inp.value.trim() });
        else await guardarDefinicion(codigo, { [campo]: inp.value.trim() });
      } catch (e) { mostrarError(mensajeError(e)); }
    }
    pintarKpis(); pintarTabla();
  };
  inp.addEventListener('blur', () => terminar(true));
  if (inp.tagName === 'SELECT') inp.addEventListener('change', () => inp.blur());
  inp.addEventListener('keydown', ev => {
    // En el cuadro de texto, Shift+Enter hace un salto de línea; Enter guarda
    if (ev.key === 'Enter' && !(inp.tagName === 'TEXTAREA' && ev.shiftKey)) { ev.preventDefault(); inp.blur(); }
    if (ev.key === 'Escape') terminar(false);
  });
}

async function guardarDefinicion(codigo, valores) {
  const d = det(codigo);
  const cambios = {};
  for (const [k, v] of Object.entries(valores)) cambios[k] = v === '' || v == null ? null : v;
  if ('responsable_id' in cambios && !('responsable' in valores)) cambios.responsable = cambios.responsable_id ? nombre(cambios.responsable_id) : null;
  const inicio = cambios.inicio_programado !== undefined ? cambios.inicio_programado : d.inicio_programado;
  let fin = cambios.fin_programado !== undefined ? cambios.fin_programado : d.fin_programado;
  // Como en el formato: si no tiene fin prog., se propone inicio + 90 días
  if (cambios.inicio_programado && !fin) fin = cambios.fin_programado = sumarDias(cambios.inicio_programado, DIAS_FIN_POR_DEFECTO);
  if (inicio && fin && fin < inicio) throw new Error('El fin programado no puede ser anterior al inicio programado.');
  const [g] = await api.upsert('programa_arranque_detalle',
    { programa_id: estado.programa.id, item_codigo: codigo, ...cambios }, 'programa_id,item_codigo');
  estado.detalle.set(codigo, { ...d, ...g });
}

async function guardarSeguimiento(codigo, valores, fecha = estado.reunion) {
  const cambios = {};
  for (const [k, v] of Object.entries(valores)) cambios[k] = v === '' || v == null ? null : v;
  if (cambios.avance != null) {
    cambios.avance = Number(cambios.avance);
    if (!(cambios.avance >= 0 && cambios.avance <= 100)) throw new Error('El % de avance debe estar entre 0 y 100.');
    const previo = estado.seguimientos.filter(s => s.item_codigo === codigo && s.fecha_revision < fecha).at(-1);
    if (previo?.avance != null && cambios.avance < Number(previo.avance)) {
      ok(`Atención: el avance acumulado baja de ${Number(previo.avance)}% a ${cambios.avance}%.`);
    }
  }
  const [g] = await api.upsert('programa_arranque_seguimiento',
    { programa_id: estado.programa.id, item_codigo: codigo, fecha_revision: fecha, ...cambios }, 'programa_id,item_codigo,fecha_revision');
  estado.seguimientos = estado.seguimientos.filter(s => s.id !== g.id).concat(g)
    .sort((a, b) => a.fecha_revision.localeCompare(b.fecha_revision));
  if (!estado.reuniones.includes(fecha)) estado.reuniones = [...estado.reuniones, fecha].sort();
}

// ── Ficha del ítem (panel lateral) ────────────────────────────────────────────

function abrirFicha(codigo) {
  document.querySelector('.pa-ficha-fondo')?.remove();
  const i = item(codigo);
  const d = det(codigo), k = estadoDe(codigo), av = avanceDe(codigo);
  const hist = estado.seguimientos.filter(s => s.item_codigo === codigo).slice().reverse();
  const s = segDe(codigo) || {};
  const { lista } = usuariosProyecto();
  const dis = estado.editable ? '' : ' disabled';
  const fondo = html(`<div class="pa-ficha-fondo"><aside class="pa-ficha" role="dialog" aria-label="Ficha del ítem ${esc(codigo)}">
    <div class="pa-ficha-cab"><span class="pa-cod">${esc(codigo)}</span><span class="pa-estado ${ESTADOS[k].cls}">${ESTADOS[k].txt}</span>
      <span class="flex"></span><button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>
    <h2>${esc(i.descripcion)}</h2>
    <div class="pa-ficha-meta"><span>${esc(i.proceso)}</span><span>${esc(i.area_lider)}</span><span>Formato: ${i.obligatorio ? 'Si' : 'N/A'}</span></div>
    <div class="pa-ficha-av">${barra(av, 'grande')}<b>${av}%</b><span class="pa-vacio">% Ava. Acu. al ${fmtFecha(estado.reunion)}</span></div>

    <section class="pa-sec def"><h3>Definición</h3>
      <form data-form="def" class="pa-form">
        <label>Aplica<select name="aplica"${dis}>${APLICA.map(o => `<option value="${o.value}"${o.value === aplicaDe(codigo) ? ' selected' : ''}>${o.label}</option>`).join('')}</select></label>
        <label>Resp.<select name="responsable_id"${dis}><option value="">— Sin asignar —</option>
          ${lista.map(u => `<option value="${esc(u.id)}"${u.id === d.responsable_id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></label>
        <label>Inicio prog.<input type="date" name="inicio_programado" value="${d.inicio_programado || ''}"${dis}></label>
        <label>Fin prog.<input type="date" name="fin_programado" value="${d.fin_programado || ''}"${dis}></label>
        <label class="full">Comentarios<textarea name="comentarios" rows="2"${dis}>${esc(d.comentarios || '')}</textarea></label>
        ${estado.editable ? '<button class="btn btn-primario" type="submit">Guardar definición</button>' : ''}
      </form></section>

    <section class="pa-sec seg"><h3>Seguimiento · Fecha rev. ${fmtFecha(estado.reunion)}</h3>
      <form data-form="seg" class="pa-form">
        <label>% Ava. Acu.<input type="number" name="avance" min="0" max="100" step="5" value="${s.avance ?? ''}"${dis}></label>
        <label>Fin re-prog.<input type="date" name="fin_reprogramado" value="${s.fin_reprogramado || ''}"${dis}></label>
        <label class="full">Comentarios<textarea name="comentarios" rows="2"${dis}>${esc(s.comentarios || '')}</textarea></label>
        ${estado.editable ? '<button class="btn btn-primario" type="submit">Guardar seguimiento</button>' : ''}
      </form></section>

    <section class="pa-sec"><h3>Historial de seguimiento</h3>
      ${hist.length ? `<ol class="pa-linea">${hist.map(h => `<li><div class="pa-linea-cab"><b>${fmtFecha(h.fecha_revision)}</b>
          ${h.avance != null ? `<span class="pa-av">${barra(Number(h.avance))}<b>${Number(h.avance)}%</b></span>` : ''}</div>
          ${h.comentarios ? `<p>${esc(h.comentarios)}</p>` : ''}
          <small>${h.fin_reprogramado ? `Fin re-prog.: ${fmtFecha(h.fin_reprogramado)} · ` : ''}${esc(nombre(h.created_by) || '')}</small></li>`).join('')}</ol>`
        : '<p class="pa-vacio">Sin registros de seguimiento todavía.</p>'}
    </section></aside></div>`);
  document.body.append(fondo);
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', tecla);
  fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(); });
  fondo.querySelector('[data-cerrar]').onclick = cerrar;
  fondo.querySelectorAll('form').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(f));
    try {
      if (f.dataset.form === 'def') await guardarDefinicion(codigo, datos);
      else await guardarSeguimiento(codigo, datos);
      ok('Guardado.');
      pintarTodo();
      cerrar();
      abrirFicha(codigo);
    } catch (err) { mostrarError(mensajeError(err)); }
  }));
}

// ── Importar un Excel con el formato CR-PG-SGP-01-F1 ──────────────────────────

const clave = s => normalizar(String(s ?? '')).replace(/[^a-z0-9%]/g, '');
// Cabecera del Excel → campo (versiones r1 anterior y actual del formato)
const CABECERAS = {
  item: 'item', proceso: 'proceso', area: 'area', arealider: 'area', aplica: 'aplica', obligatorio: 'aplica',
  descripciondeactividad: 'descripcion', descripciondeactividades: 'descripcion',
  resp: 'resp', responsable: 'resp', inicioprog: 'inicio', inicioprogramado: 'inicio', finprog: 'fin', finprogramado: 'fin',
  fecharev: 'frev', fechaderevision: 'frev', '%avaacu': 'avance', '%avanceacumulado': 'avance', finreprog: 'finr', finreprogramado: 'finr',
};
const fechaIso = v => {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
};

async function importarExcel() {
  const archivo = await new Promise(res => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx,.xlsm,.xls' });
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
  if (!archivo) return;
  const XLSX = await libExcel();
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellDates: true });
  const hoja = libro.SheetNames.find(n => /^1\.?\s*programa/i.test(n)) || libro.SheetNames.find(n => /programa/i.test(n));
  if (!hoja) throw new Error('El archivo no tiene la pestaña "1.Programa de arranque".');
  const filas = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, defval: null });

  // Cabeceras: la fila que contiene "Ítem". Hay dos columnas "Comentarios": la primera es de definición y la segunda de seguimiento
  const iCab = filas.findIndex(f => f.some(v => clave(v) === 'item'));
  if (iCab < 0) throw new Error('No se encontró la fila de cabeceras (columna "Ítem").');
  const col = {};
  filas[iCab].forEach((v, n) => {
    const k = clave(v);
    if (k === 'comentarios') { if (col.comdef == null) col.comdef = n; else col.comseg = n; return; }
    if (CABECERAS[k] && col[CABECERAS[k]] == null) col[CABECERAS[k]] = n;
  });
  if (col.item == null) throw new Error('No se encontró la columna "Ítem".');

  // Responsables: por nombre (sin tildes) entre los usuarios de la empresa
  const porNombre = new Map(store.perfiles.map(p => [clave(p.nombre), p]));
  const codigos = new Set(estado.items.map(i => i.item_codigo));
  const defs = [], segs = [], sinUsuario = new Set(), desconocidos = [];
  for (const f of filas.slice(iCab + 1)) {
    const cod = f[col.item] == null ? '' : String(f[col.item]).trim();
    if (!cod) continue;
    if (!codigos.has(cod)) { desconocidos.push(cod); continue; }
    const val = k => (col[k] == null ? undefined : f[col[k]]);
    const d = { programa_id: estado.programa.id, item_codigo: cod };
    if (col.aplica != null) { const a = clave(val('aplica')); d.aplica = a === 'na' || a === 'no' ? 'na' : a === 'si' ? 'si' : null; }
    if (col.resp != null) {
      const nom = String(val('resp') ?? '').trim();
      const p = porNombre.get(clave(nom));
      d.responsable_id = p?.id || null;
      d.responsable = nom || null;
      if (nom && !p) sinUsuario.add(nom);
    }
    if (col.inicio != null) d.inicio_programado = fechaIso(val('inicio'));
    if (col.fin != null) d.fin_programado = fechaIso(val('fin'));
    if (col.comdef != null) d.comentarios = f[col.comdef] == null ? null : String(f[col.comdef]);
    defs.push(d);
    const frev = fechaIso(val('frev'));
    if (frev) {
      let av = val('avance');
      av = av == null || av === '' ? null : Number(av);
      if (av !== null && av <= 1) av = Math.round(av * 1000) / 10;   // 0,25 en Excel = 25 %
      segs.push({ programa_id: estado.programa.id, item_codigo: cod, fecha_revision: frev, avance: av,
        comentarios: col.comseg == null || f[col.comseg] == null ? null : String(f[col.comseg]), fin_reprogramado: fechaIso(val('finr')) });
    }
  }
  if (!defs.length) throw new Error('El archivo no tiene ítems del programa de arranque.');

  // Pestaña 0.Datos: información del proyecto
  const hojaDatos = libro.SheetNames.find(n => /^0\.?\s*datos/i.test(n));
  const info = {};
  if (hojaDatos) {
    const MAPA = { cr: 'cr', proyecto: 'nombre_completo', iniciocontractual: 'inicio_contractual', fincontractual: 'fin_contractual',
      fechainiciomovilizacion: 'fecha_movilizacion', fechainiciodeconstruccion: 'fecha_construccion' };
    for (const f of XLSX.utils.sheet_to_json(libro.Sheets[hojaDatos], { header: 1, raw: true, defval: null })) {
      const n = f.findIndex(v => MAPA[clave(v)]);
      if (n < 0) continue;
      const campo = MAPA[clave(f[n])], v = f[n + 1];
      if (v == null || v === '') continue;
      info[campo] = campo === 'cr' || campo === 'nombre_completo' ? String(v).trim() : fechaIso(v);
    }
  }

  const reuniones = [...new Set(segs.map(s => s.fecha_revision))].sort();
  const nInfo = Object.keys(info).length;
  const si = await confirmar(`Se cargará "${archivo.name}" en ${nombreSeleccion()}:
    · ${defs.length} ítems de definición (Aplica, Resp., Inicio prog., Fin prog., Comentarios)
    · ${segs.length} registros de seguimiento${reuniones.length ? ` (reunión${reuniones.length > 1 ? 'es' : ''} del ${reuniones.map(fmtFecha).join(', ')})` : ''}
    ${nInfo ? `· ${nInfo} dato(s) de la información del proyecto (pestaña 0.Datos)` : ''}
    ${sinUsuario.size ? `· Responsables que no son usuarios de la empresa (quedan como texto): ${[...sinUsuario].join(', ')}` : ''}
    ${desconocidos.length ? `· Ítems que no existen en el formato y se omiten: ${desconocidos.join(', ')}` : ''}
    Los valores actuales de esos ítems se reemplazan. ¿Continuar?`, { titulo: 'Importar Excel', texto: 'Importar' });
  if (!si) return;

  for (let n = 0; n < defs.length; n += 100) await api.upsert('programa_arranque_detalle', defs.slice(n, n + 100), 'programa_id,item_codigo');
  for (let n = 0; n < segs.length; n += 100) await api.upsert('programa_arranque_seguimiento', segs.slice(n, n + 100), 'programa_id,item_codigo,fecha_revision');
  if (nInfo) {
    const p = proyecto(estado.proyId);
    Object.assign(p, await api.update('proyectos', estado.proyId, info));
  }
  ok(`Importado: ${defs.length} ítems y ${segs.length} registros de seguimiento.`);
  await cargarDatos(estado.proyId);
  pintarTodo();
}

// ── Excel en el formato CR-PG-SGP-01-F1 ───────────────────────────────────────

async function exportarExcel() {
  const XLSX = await libExcel();
  const p = proyecto(estado.proyId) || {};
  const libro = XLSX.utils.book_new();
  const datos = CAMPOS_INFO.map(c => [c.label, c.name === 'nombre_completo' ? (p.nombre_completo || p.nombre_corto) : (p[c.name] || '')]);
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[], ...datos.map(r => ['', ...r])]), '0.Datos');
  const cab = ['Ítem', 'Proceso', 'Area', 'Aplica', 'Descripción de actividad', 'Resp.', 'Inicio prog.', 'Fin prog.', 'Comentarios', '',
    'Fecha rev.', '% Ava. Acu.', 'Comentarios', 'Fin re-prog.', 'Estado'];
  const filas = estado.items.map(i => {
    const d = det(i.item_codigo), s = segVigente(i.item_codigo) || {};
    return [i.item_codigo, i.proceso, i.area_lider, aplicaDe(i.item_codigo) === 'si' ? 'Sí' : 'N/A', i.descripcion, respDe(i.item_codigo) || '',
      d.inicio_programado || '', d.fin_programado || '', d.comentarios || '', '', s.fecha_revision || '',
      s.avance != null ? Number(s.avance) / 100 : '', s.comentarios || '', s.fin_reprogramado || '', ESTADOS[estadoDe(i.item_codigo)].txt];
  });
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[], cab, ...filas]), '1.Programa de arranque');
  const hist = estado.seguimientos.map(s => [s.item_codigo, s.fecha_revision, s.avance != null ? Number(s.avance) / 100 : '', s.comentarios || '',
    s.fin_reprogramado || '', nombre(s.created_by) || '']);
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Ítem', 'Fecha rev.', '% Ava. Acu.', 'Comentarios',
    'Fin re-prog.', 'Registró'], ...hist]), 'Historial de seguimiento');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[], [], [], ['', '', 'Aplicabilidad'], ['', '', 'Si'], ['', '', 'N/A']]), '3.Listas');
  XLSX.writeFile(libro, `CR-PG-SGP-01-F1 Programa de Arranque ${p.codigo || ''} ${fmtFecha(estado.reunion).replaceAll('/', '-')}.xlsx`);
}
