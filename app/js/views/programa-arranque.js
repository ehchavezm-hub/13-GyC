// Programa de Arranque (CR-PG-SGP-01-F1 r1, pestaña "1.Programa de arranque").
// Diseño basado en herramientas de referencia:
//   · Procore (checklists): ítems agrupados por sección con avance "x/y" por sección y ficha del ítem con historial.
//   · Smartsheet: filas agrupadas por fase (aquí, por Proceso), barras de avance en lugar de números.
//   · Monday / tablas empresariales: estado en pastillas de color y edición en la misma celda.
//   · Linear / Notion: panel lateral con el detalle del ítem.
// Dos vistas, una por tipo de reunión:
//   · Definición (amarillo): responsable, inicio y fin programado, comentarios — un valor por ítem.
//   · Seguimiento (verde): % avance acumulado, comentario y fin re-programado — un registro por ítem y reunión.
import { medir } from '../core/monitoreo.js';
import { api, mensajeError } from '../data/api.js';
import { store, haySeleccion, nombreSeleccion, proyecto, lideresHeredados, nombre } from '../core/store.js';
import { esc, html, fmtFecha, hoy, sumarDias, libExcel } from '../core/util.js';
import { error as mostrarError, pedirDatos, ok } from '../ui/ui.js';
import { CAMPOS_INFO, puedeEditarProyecto } from './informacion-proyecto.js';

const DIAS_FIN_POR_DEFECTO = 90;   // como el formato: Fin programado = Inicio programado + 90
const PROXIMOS_DIAS = 14;          // "por vencer": fin vigente dentro de 14 días

let estado = {};

// Columnas de cada vista con su ancho por defecto (px). El ancho se cambia arrastrando el borde del encabezado,
// como en Excel; doble clic en el borde lo restablece. Se recuerda por vista en este navegador.
const COLUMNAS = {
  seguimiento: [
    { k: 'cod', txt: 'Ítem', w: 56 }, { k: 'act', txt: 'Actividad', w: 330 }, { k: 'resp', txt: 'Responsable', w: 150 },
    { k: 'finv', txt: 'Fin vigente', w: 100 }, { k: 'est', txt: 'Estado', w: 110 },
    { k: 'av', txt: '% Avance acumulado', w: 135, cls: 'seg' }, { k: 'com', txt: 'Comentario de la reunión', w: 190, cls: 'seg' },
    { k: 'finr', txt: 'Fin re-programado', w: 105, cls: 'seg' }, { k: 'mas', txt: '', w: 44, fija: true },
  ],
  definicion: [
    { k: 'cod', txt: 'Ítem', w: 56 }, { k: 'act', txt: 'Actividad', w: 380 }, { k: 'resp', txt: 'Responsable', w: 160, cls: 'def' },
    { k: 'ini', txt: 'Inicio programado', w: 112, cls: 'def' }, { k: 'fin', txt: 'Fin programado', w: 112, cls: 'def' },
    { k: 'dur', txt: 'Duración', w: 80 }, { k: 'com', txt: 'Comentarios', w: 250, cls: 'def' }, { k: 'mas', txt: '', w: 44, fija: true },
  ],
};
const ANCHO_MIN = 40;
const claveAnchos = modo => `gyc-arr-anchos-${modo}`;
function anchos(modo) {
  let guardados = {};
  try { guardados = JSON.parse(localStorage.getItem(claveAnchos(modo)) || '{}'); } catch { /* sin almacenamiento */ }
  return COLUMNAS[modo].map(c => Math.max(ANCHO_MIN, Number(guardados[c.k]) || c.w));
}
function guardarAnchos(modo, lista) {
  try { localStorage.setItem(claveAnchos(modo), JSON.stringify(Object.fromEntries(COLUMNAS[modo].map((c, i) => [c.k, lista[i]])))); } catch { /* opcional */ }
}
const filtros = { texto: '', proceso: '', resp: '', oblig: false, estado: '' };
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
      <button class="btn" data-a="excel" title="Descargar en el formato CR-PG-SGP-01-F1">⬇ Excel</button>
    </div>
    <div data-kpis class="pa-kpis"></div>
    <div data-barra class="pa-barra"></div>
    <div data-tabla class="pa-tabla-wrap"></div>
  </div>`);
  el.append(wrap);
  wrap.querySelector('[data-a="excel"]').addEventListener('click', () => exportarExcel().catch(e => mostrarError(mensajeError(e))));
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
const segDe = (c, fecha = estado.reunion) => estado.seguimientos.find(s => s.item_codigo === c && s.fecha_revision === fecha);
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
};
function estadoDe(c) {
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

const iniciales = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const barra = (pct, cls = '') => `<span class="pa-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>`;

// ── Indicadores ───────────────────────────────────────────────────────────────

function pintarKpis() {
  const items = estado.items, n = items.length || 1;
  const est = items.map(i => estadoDe(i.item_codigo));
  const cuenta = k => est.filter(x => x === k).length;
  const promedio = Math.round(items.reduce((s, i) => s + avanceDe(i.item_codigo), 0) / n);
  const oblig = items.filter(i => i.obligatorio);
  const obligOk = oblig.filter(i => avanceDe(i.item_codigo) >= 100).length;
  const sinResp = items.filter(i => !(det(i.item_codigo).responsable_id || det(i.item_codigo).responsable)).length;
  const tarjeta = (clave, valor, etiqueta, pie, cls = '') => `<button class="pa-kpi ${cls}${filtros.estado === clave ? ' activo' : ''}" data-kpi="${clave}" title="Filtrar la tabla">
    <span class="pa-kpi-linea"><span class="pa-kpi-val">${valor}</span><span class="pa-kpi-lbl">${etiqueta}</span></span>${pie ? `<span class="pa-kpi-pie">${pie}</span>` : ''}</button>`;
  const caja = estado.wrap.querySelector('[data-kpis]');
  caja.innerHTML = `<div class="pa-kpi pa-kpi-avance">
      <span class="pa-kpi-linea"><span class="pa-kpi-val">${promedio}%</span><span class="pa-kpi-lbl">Avance del programa · al ${fmtFecha(estado.reunion)}</span></span>${barra(promedio, 'grande')}
      <span class="pa-kpi-pie">${cuenta('terminado')} de ${items.length} ítems terminados · obligatorios ${obligOk}/${oblig.length}</span></div>
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
  const caja = estado.wrap.querySelector('[data-barra]');
  caja.innerHTML = `
    <div class="pa-vistas" role="tablist">
      <button role="tab" data-modo="definicion" class="def${seg ? '' : ' activo'}" aria-selected="${!seg}">Definición</button>
      <button role="tab" data-modo="seguimiento" class="seg${seg ? ' activo' : ''}" aria-selected="${seg}">Seguimiento</button>
    </div>
    ${seg ? `<label class="pa-reunion">Reunión del
        <select data-f="reunion">${fechas.map(f => `<option value="${f}"${f === estado.reunion ? ' selected' : ''}>${fmtFecha(f)}${estado.reuniones.includes(f) ? '' : ' (nueva)'}</option>`).join('')}</select></label>
      ${estado.editable ? '<button class="btn btn-sm" data-a="nueva">＋ Nueva reunión</button>' : ''}`
      : '<span class="pa-nota">Se completa en la reunión de definición.</span>'}
    <span class="flex"></span>
    <input type="search" class="pa-buscar" data-f="texto" placeholder="Buscar ítem o actividad…" value="${esc(filtros.texto)}">
    <select data-f="proceso"><option value="">Todos los procesos</option>${procesos.map(p => `<option${p === filtros.proceso ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
    <select data-f="resp"><option value="">Todos los responsables</option><option value="-"${filtros.resp === '-' ? ' selected' : ''}>Sin responsable</option>
      ${lista.map(u => `<option value="${esc(u.id)}"${u.id === filtros.resp ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>
    <label class="pa-chip"><input type="checkbox" data-f="oblig"${filtros.oblig ? ' checked' : ''}> Solo obligatorios</label>`;
  caja.onclick = async e => {
    const m = e.target.closest('[data-modo]')?.dataset.modo;
    if (m && m !== estado.modo) { estado.modo = m; guardarModo(m); pintarBarra(); pintarTabla(); return; }
    if (e.target.closest('[data-a="nueva"]')) {
      const d = await pedirDatos({
        titulo: 'Nueva reunión de seguimiento',
        antes: 'El avance, los comentarios y el fin re-programado se registrarán para esta fecha. Las reuniones anteriores quedan en el historial de cada ítem.',
        campos: [{ name: 'fecha', label: 'Fecha de revisión', type: 'date', required: true }], valores: { fecha: hoy() },
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
    filtros[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    pintarTabla();
  };
}

// ── Tabla agrupada por Proceso ────────────────────────────────────────────────

function filtrados() {
  const t = filtros.texto.trim().toLowerCase();
  return estado.items.filter(i => {
    const d = det(i.item_codigo);
    return (!filtros.proceso || i.proceso === filtros.proceso) && (!filtros.oblig || i.obligatorio) &&
      (!filtros.resp || (filtros.resp === '-' ? !d.responsable_id && !d.responsable : d.responsable_id === filtros.resp)) &&
      (!filtros.estado || estadoDe(i.item_codigo) === filtros.estado) &&
      (!t || `${i.item_codigo} ${i.descripcion} ${i.area_lider} ${i.proceso}`.toLowerCase().includes(t));
  });
}

function pintarTabla() {
  const seg = estado.modo === 'seguimiento';
  const ed = estado.editable ? ' data-editable' : '';
  const items = filtrados();
  const grupos = [];
  for (const i of items) {
    let g = grupos.find(x => x.proceso === i.proceso);
    if (!g) grupos.push(g = { proceso: i.proceso, items: [] });
    g.items.push(i);
  }
  const ncols = seg ? 9 : 8;

  const modo = seg ? 'seguimiento' : 'definicion';
  const cols = COLUMNAS[modo], ws = anchos(modo);
  const colgroup = `<colgroup>${ws.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
  const cab = `<tr>${cols.map((c, n) => `<th class="${c.cls || ''}">${esc(c.txt)}${c.fija ? '' : `<span class="pa-resize" data-col="${n}" title="Arrastre para cambiar el ancho · doble clic: ancho original"></span>`}</th>`).join('')}</tr>`;

  const fila = i => {
    const c = i.item_codigo, d = det(c), r = respDe(c), k = estadoDe(c);
    const actividad = `<td class="c-act"><div class="pa-desc">${esc(i.descripcion)}</div>
      <div class="pa-meta">${esc(i.area_lider)}${i.obligatorio ? '<span class="pa-oblig">Obligatorio</span>' : '<span class="pa-opc">Opcional</span>'}</div></td>`;
    const resp = `<td class="c-resp"${ed} data-campo="responsable_id">${r ? `<span class="pa-avatar">${esc(iniciales(r))}</span><span class="pa-resp-n">${esc(r)}</span>` : '<span class="pa-vacio">Asignar</span>'}</td>`;
    if (!seg) {
      const dur = d.inicio_programado && d.fin_programado ? Math.round((new Date(d.fin_programado) - new Date(d.inicio_programado)) / 86400000) : null;
      return `<tr data-item-row="${esc(c)}" class="${i.obligatorio ? '' : 'opc'}">
        <td class="c-cod"><span class="pa-cod">${esc(c)}</span></td>${actividad}${resp}
        <td class="c-fecha"${ed} data-campo="inicio_programado">${d.inicio_programado ? fmtFecha(d.inicio_programado) : '<span class="pa-vacio">—</span>'}</td>
        <td class="c-fecha"${ed} data-campo="fin_programado">${d.fin_programado ? fmtFecha(d.fin_programado) : '<span class="pa-vacio">—</span>'}</td>
        <td class="c-dur">${dur !== null ? `${dur} d` : ''}</td>
        <td class="c-com"${ed} data-campo="comentarios">${esc(d.comentarios || '')}</td>
        <td class="c-mas"><button class="pa-mas" data-ficha="${esc(c)}" title="Abrir ficha del ítem">›</button></td></tr>`;
    }
    const s = segDe(c), ref = !s && segVigente(c), v = s || ref || {};
    const av = v.avance != null ? Number(v.avance) : null;
    const fin = finVigente(c);
    return `<tr data-item-row="${esc(c)}" class="${i.obligatorio ? '' : 'opc'}">
      <td class="c-cod"><span class="pa-cod">${esc(c)}</span></td>${actividad}${resp}
      <td class="c-fecha${k === 'atrasado' ? ' tarde' : ''}">${fin ? fmtFecha(fin) : '<span class="pa-vacio">—</span>'}</td>
      <td class="c-est"><span class="pa-estado ${ESTADOS[k].cls}">${ESTADOS[k].txt}</span></td>
      <td class="c-av${ref ? ' ref' : ''}"${ed} data-seg data-campo="avance" title="${ref ? `Último registro: reunión del ${fmtFecha(ref.fecha_revision)}` : ''}">
        ${av !== null ? `<span class="pa-av">${barra(av, av >= 100 ? 'ok' : '')}<b>${av}%</b></span>` : '<span class="pa-vacio">0%</span>'}</td>
      <td class="c-com${ref ? ' ref' : ''}"${ed} data-seg data-campo="comentarios">${esc(v.comentarios || '')}</td>
      <td class="c-fecha${ref ? ' ref' : ''}"${ed} data-seg data-campo="fin_reprogramado">${v.fin_reprogramado ? fmtFecha(v.fin_reprogramado) : ''}</td>
      <td class="c-mas"><button class="pa-mas" data-ficha="${esc(c)}" title="Abrir ficha e historial">›</button></td></tr>`;
  };

  const cuerpo = grupos.map(g => {
    const terminados = g.items.filter(i => avanceDe(i.item_codigo) >= 100).length;
    const prom = Math.round(g.items.reduce((s, i) => s + avanceDe(i.item_codigo), 0) / g.items.length);
    const atr = g.items.filter(i => estadoDe(i.item_codigo) === 'atrasado').length;
    const cerrado = plegados.has(g.proceso);
    return `<tbody class="pa-grupo${cerrado ? ' plegado' : ''}">
      <tr class="pa-grupo-cab" data-grupo="${esc(g.proceso)}"><td colspan="${ncols}"><div class="pa-grupo-in">
        <span class="pa-flecha">${cerrado ? '▸' : '▾'}</span><b>${esc(g.proceso)}</b>
        <span class="pa-grupo-n">${terminados}/${g.items.length} terminados</span>${barra(prom)}<span class="pa-grupo-n">${prom}%</span>
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
    if (td && !td.querySelector('input,select')) editarCelda(td);
  };
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
    asa.addEventListener('dblclick', e => {
      e.stopPropagation();
      cols[n].style.width = `${COLUMNAS[modo][n].w}px`;
      t.style.width = `${total()}px`;
      guardarAnchos(modo, cols.map(c => parseFloat(c.style.width)));
    });
  });
}

// ── Edición en la celda ───────────────────────────────────────────────────────

function control(campo, actual) {
  if (campo === 'responsable_id') {
    const { lista, soloProyecto } = usuariosProyecto();
    return `<select class="cel-input"><option value="">— Sin asignar —</option>
      ${lista.map(u => `<option value="${esc(u.id)}"${u.id === actual ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}
      ${soloProyecto ? '' : '<option disabled>(el proyecto aún no tiene miembros: se listan todos)</option>'}</select>`;
  }
  if (campo === 'avance') return `<input type="number" class="cel-input" min="0" max="100" step="5" value="${actual ?? ''}" placeholder="%">`;
  if (/programado|reprogramado/.test(campo)) return `<input type="date" class="cel-input" value="${actual || ''}">`;
  return `<input type="text" class="cel-input" value="${esc(actual || '')}">`;
}

function editarCelda(td) {
  const codigo = td.closest('[data-item-row]').dataset.itemRow;
  const campo = td.dataset.campo;
  const esSeg = td.hasAttribute('data-seg');
  const actual = esSeg ? segDe(codigo)?.[campo] : det(codigo)[campo];
  td.innerHTML = control(campo, actual);
  const inp = td.querySelector('input,select');
  inp.focus();
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
    if (ev.key === 'Enter') inp.blur();
    if (ev.key === 'Escape') terminar(false);
  });
}

async function guardarDefinicion(codigo, valores) {
  const d = det(codigo);
  const cambios = {};
  for (const [k, v] of Object.entries(valores)) cambios[k] = v === '' || v == null ? null : v;
  if ('responsable_id' in cambios) cambios.responsable = cambios.responsable_id ? nombre(cambios.responsable_id) : null;
  const inicio = cambios.inicio_programado !== undefined ? cambios.inicio_programado : d.inicio_programado;
  let fin = cambios.fin_programado !== undefined ? cambios.fin_programado : d.fin_programado;
  // Como en el formato: si no tiene fin programado, se propone inicio + 90 días
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
  const i = estado.items.find(x => x.item_codigo === codigo);
  const d = det(codigo), k = estadoDe(codigo), av = avanceDe(codigo);
  const hist = estado.seguimientos.filter(s => s.item_codigo === codigo).slice().reverse();
  const s = segDe(codigo) || {};
  const { lista } = usuariosProyecto();
  const dis = estado.editable ? '' : ' disabled';
  const fondo = html(`<div class="pa-ficha-fondo"><aside class="pa-ficha" role="dialog" aria-label="Ficha del ítem ${esc(codigo)}">
    <div class="pa-ficha-cab"><span class="pa-cod">${esc(codigo)}</span><span class="pa-estado ${ESTADOS[k].cls}">${ESTADOS[k].txt}</span>
      <span class="flex"></span><button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>
    <h2>${esc(i.descripcion)}</h2>
    <div class="pa-ficha-meta"><span>${esc(i.proceso)}</span><span>${esc(i.area_lider)}</span>${i.obligatorio ? '<span class="pa-oblig">Obligatorio</span>' : '<span class="pa-opc">Opcional</span>'}</div>
    <div class="pa-ficha-av">${barra(av, 'grande')}<b>${av}%</b><span class="pa-vacio">avance acumulado al ${fmtFecha(estado.reunion)}</span></div>

    <section class="pa-sec def"><h3>Definición</h3>
      <form data-form="def" class="pa-form">
        <label>Responsable<select name="responsable_id"${dis}><option value="">— Sin asignar —</option>
          ${lista.map(u => `<option value="${esc(u.id)}"${u.id === d.responsable_id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></label>
        <label>Inicio programado<input type="date" name="inicio_programado" value="${d.inicio_programado || ''}"${dis}></label>
        <label>Fin programado<input type="date" name="fin_programado" value="${d.fin_programado || ''}"${dis}></label>
        <label class="full">Comentarios<textarea name="comentarios" rows="2"${dis}>${esc(d.comentarios || '')}</textarea></label>
        ${estado.editable ? '<button class="btn btn-primario" type="submit">Guardar definición</button>' : ''}
      </form></section>

    <section class="pa-sec seg"><h3>Seguimiento · reunión del ${fmtFecha(estado.reunion)}</h3>
      <form data-form="seg" class="pa-form">
        <label>% Avance acumulado<input type="number" name="avance" min="0" max="100" step="5" value="${s.avance ?? ''}"${dis}></label>
        <label>Fin re-programado<input type="date" name="fin_reprogramado" value="${s.fin_reprogramado || ''}"${dis}></label>
        <label class="full">Comentario de la reunión<textarea name="comentarios" rows="2"${dis}>${esc(s.comentarios || '')}</textarea></label>
        ${estado.editable ? '<button class="btn btn-primario" type="submit">Guardar seguimiento</button>' : ''}
      </form></section>

    <section class="pa-sec"><h3>Historial de seguimiento</h3>
      ${hist.length ? `<ol class="pa-linea">${hist.map(h => `<li><div class="pa-linea-cab"><b>${fmtFecha(h.fecha_revision)}</b>
          ${h.avance != null ? `<span class="pa-av">${barra(Number(h.avance))}<b>${Number(h.avance)}%</b></span>` : ''}</div>
          ${h.comentarios ? `<p>${esc(h.comentarios)}</p>` : ''}
          <small>${h.fin_reprogramado ? `Fin re-programado: ${fmtFecha(h.fin_reprogramado)} · ` : ''}${esc(nombre(h.created_by) || '')}</small></li>`).join('')}</ol>`
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

// ── Excel en el formato CR-PG-SGP-01-F1 ───────────────────────────────────────

async function exportarExcel() {
  const XLSX = await libExcel();
  const p = proyecto(estado.proyId) || {};
  const libro = XLSX.utils.book_new();
  const datos = CAMPOS_INFO.map(c => [c.label, c.name === 'nombre_completo' ? (p.nombre_completo || p.nombre_corto) : (p[c.name] || '')]);
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[], ...datos.map(r => ['', ...r])]), '0.Datos');
  const cab = ['Ítem', 'Proceso', 'Área Líder', 'Obligatorio', 'Descripción de Actividades', 'Responsable', 'Inicio programado',
    'Fin programado', 'Comentarios', '', 'Fecha de revisión', '% Avance Acumulado', 'Comentarios', 'Fin re-programado', 'Estado'];
  const filas = estado.items.map(i => {
    const d = det(i.item_codigo), s = segVigente(i.item_codigo) || {};
    return [i.item_codigo, i.proceso, i.area_lider, i.obligatorio ? 'Sí' : '', i.descripcion, respDe(i.item_codigo) || '',
      d.inicio_programado || '', d.fin_programado || '', d.comentarios || '', '', s.fecha_revision || '',
      s.avance != null ? Number(s.avance) / 100 : '', s.comentarios || '', s.fin_reprogramado || '', ESTADOS[estadoDe(i.item_codigo)].txt];
  });
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[], cab, ...filas]), '1.Programa de arranque');
  const hist = estado.seguimientos.map(s => [s.item_codigo, s.fecha_revision, s.avance != null ? Number(s.avance) / 100 : '', s.comentarios || '',
    s.fin_reprogramado || '', nombre(s.created_by) || '']);
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Ítem', 'Fecha de revisión', '% Avance Acumulado', 'Comentarios',
    'Fin re-programado', 'Registró'], ...hist]), 'Historial de seguimiento');
  XLSX.writeFile(libro, `CR-PG-SGP-01-F1 Programa de Arranque ${p.codigo || ''} ${fmtFecha(estado.reunion).replaceAll('/', '-')}.xlsx`);
}
