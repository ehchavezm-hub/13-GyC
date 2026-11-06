// Programa de Arranque (CR-PG-SGP-01-F1 r1, pestaña "1.Programa de arranque").
//   · Definición (cabecera amarilla): se completa en la reunión de definición — responsable, inicio y fin
//     programado, comentarios. Un valor por ítem (programa_arranque_detalle).
//   · Seguimiento (cabecera verde): se completa en cada reunión de seguimiento — fecha de revisión, % avance
//     acumulado, comentarios y fin re-programado. Un registro por ítem y reunión (programa_arranque_seguimiento).
import { medir } from '../core/monitoreo.js';
import { api, mensajeError } from '../data/api.js';
import { store, haySeleccion, nombreSeleccion, proyecto, lideresHeredados, nombre } from '../core/store.js';
import { esc, html, fmtFecha, hoy, sumarDias, libExcel } from '../core/util.js';
import { error as mostrarError, modal, pedirDatos, ok } from '../ui/ui.js';
import { CAMPOS_INFO, puedeEditarProyecto } from './informacion-proyecto.js';

const DIAS_FIN_POR_DEFECTO = 90;   // como el formato: Fin programado = Inicio programado + 90

let estado = { proyId: null, programa: null, items: [], detalle: new Map(), seguimientos: [], reunion: null, editable: false, reuniones: [] };

export async function render(el) {
  el.innerHTML = '';
  const proyId = store.proyectoSel;   // id del proyecto elegido en el árbol
  if (!haySeleccion() || !proyId) {
    el.innerHTML = '<div class="aviso-vacio"><p>Selecciona un proyecto en el menú para ver su Programa de Arranque.</p></div>';
    return;
  }
  estado = { proyId, programa: null, items: [], detalle: new Map(), seguimientos: [], reunion: null, editable: puedeEditarProyecto(proyId), reuniones: [] };

  const wrap = html(`<div class="pagina-arr">
    <div class="pagina-cab">
      <h1>Programa de Arranque</h1>
      <span class="proy-badge">${esc(nombreSeleccion())}</span>
      <span class="flex"></span>
      <button class="btn btn-sm" data-a="excel" title="Descargar en el formato CR-PG-SGP-01-F1">⬇ Excel</button>
    </div>
    <div data-reunion class="arr-reunion"></div>
    <div data-kpis class="kpis"></div>
    <div data-filtros class="arr-filtros"></div>
    <div data-tabla class="arr-tabla-wrap"></div>
  </div>`);
  el.append(wrap);
  wrap.querySelector('[data-a="excel"]').addEventListener('click', () => exportarExcel().catch(e => mostrarError(mensajeError(e))));

  try {
    await medir('programa-arranque.cargar', () => cargarDatos(proyId));
  } catch (e) {
    mostrarError(mensajeError(e));
    return;
  }
  pintarTodo(wrap);
}

function pintarTodo(wrap) {
  pintarReunion(wrap);
  pintarKpis(wrap);
  pintarFiltros(wrap);
  pintarTabla(wrap);
}

// ── Carga de datos ────────────────────────────────────────────────────────────

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

// Registro de seguimiento de un ítem en la reunión elegida, y el último anterior (referencia)
const segDe = (codigo, fecha = estado.reunion) => estado.seguimientos.find(s => s.item_codigo === codigo && s.fecha_revision === fecha);
const segVigente = (codigo, hasta = estado.reunion) => estado.seguimientos
  .filter(s => s.item_codigo === codigo && s.fecha_revision <= hasta).at(-1);
const finVigente = (codigo, hasta) => segVigente(codigo, hasta)?.fin_reprogramado || estado.detalle.get(codigo)?.fin_programado || null;

// ── Usuarios del proyecto (responsables) ──────────────────────────────────────

function usuariosProyecto() {
  const ids = new Set(lideresHeredados(estado.proyId));
  const activos = store.perfiles.filter(p => p.activo && !p.eliminado && p.rol !== 'pendiente');
  const delProyecto = activos.filter(p => ids.has(p.id));
  return { lista: (delProyecto.length ? delProyecto : activos).sort((a, b) => a.nombre.localeCompare(b.nombre)), soloProyecto: delProyecto.length > 0 };
}

// ── Reunión de seguimiento elegida ────────────────────────────────────────────

function pintarReunion(wrap) {
  const fechas = [...new Set([...estado.reuniones, estado.reunion])].sort().reverse();
  const caja = wrap.querySelector('[data-reunion]');
  caja.innerHTML = `
    <span class="arr-leyenda arr-def">Definición</span><span class="nota">reunión de definición (un valor por ítem)</span>
    <span class="arr-leyenda arr-seg">Seguimiento</span>
    <label>reunión del
      <select data-sel-reunion class="sel">${fechas.map(f => `<option value="${f}"${f === estado.reunion ? ' selected' : ''}>${fmtFecha(f)}${estado.reuniones.includes(f) ? '' : ' (nueva)'}</option>`).join('')}</select>
    </label>
    ${estado.editable ? '<button class="btn btn-sm" data-a="nueva-reunion">＋ Nueva reunión de seguimiento</button>' : ''}
    <span class="nota">${estado.reuniones.length} reunión(es) registrada(s)</span>`;
  caja.querySelector('[data-sel-reunion]').addEventListener('change', e => { estado.reunion = e.target.value; pintarTodo(wrap); });
  caja.querySelector('[data-a="nueva-reunion"]')?.addEventListener('click', async () => {
    const d = await pedirDatos({
      titulo: 'Nueva reunión de seguimiento',
      antes: 'Las columnas verdes se llenarán para esta fecha. Los valores de reuniones anteriores se conservan en el historial.',
      campos: [{ name: 'fecha', label: 'Fecha de revisión', type: 'date', required: true }],
      valores: { fecha: hoy() },
    });
    if (!d?.fecha) return;
    estado.reunion = d.fecha;
    pintarTodo(wrap);
  });
}

// ── Indicadores ───────────────────────────────────────────────────────────────

function pintarKpis(wrap) {
  const items = estado.items;
  const det = c => estado.detalle.get(c) || {};
  const conResp = items.filter(i => det(i.item_codigo).responsable_id || det(i.item_codigo).responsable).length;
  const conFechas = items.filter(i => det(i.item_codigo).inicio_programado && det(i.item_codigo).fin_programado).length;
  const avances = items.map(i => Number(segVigente(i.item_codigo)?.avance ?? 0));
  const promedio = items.length ? Math.round(avances.reduce((s, x) => s + x, 0) / items.length) : 0;
  const terminados = avances.filter(a => a >= 100).length;
  const atrasados = items.filter(i => {
    const fin = finVigente(i.item_codigo, estado.reunion);
    return fin && fin < estado.reunion && Number(segVigente(i.item_codigo)?.avance ?? 0) < 100;
  }).length;
  const tile = (v, l, clase = '', t = '') => `<div class="kpi-tile" title="${esc(t)}"><span class="kpi-val ${clase}">${v}</span><span class="kpi-lbl">${l}</span></div>`;
  wrap.querySelector('[data-kpis]').innerHTML =
    tile(items.length, 'Ítems totales') +
    tile(items.filter(i => i.obligatorio).length, 'Obligatorios') +
    tile(`${conResp}/${items.length}`, 'Con responsable') +
    tile(`${conFechas}/${items.length}`, 'Con fechas programadas') +
    tile(`${promedio}%`, 'Avance promedio', promedio >= 80 ? 'verde' : promedio >= 50 ? 'naranja' : '', `Al ${fmtFecha(estado.reunion)}`) +
    tile(terminados, 'Terminados (100%)', 'verde') +
    tile(atrasados, 'Atrasados', atrasados ? 'rojo' : '', `Fin programado o re-programado anterior al ${fmtFecha(estado.reunion)} y sin 100%`);
}

// ── Filtros ───────────────────────────────────────────────────────────────────

const filtros = { proceso: '', oblig: false, resp: '' };

function pintarFiltros(wrap) {
  const procesos = [...new Set(estado.items.map(i => i.proceso))];
  const { lista } = usuariosProyecto();
  const caja = wrap.querySelector('[data-filtros]');
  caja.innerHTML = `
    <label>Proceso: <select data-f="proceso" class="sel"><option value="">Todos</option>
      ${procesos.map(p => `<option${p === filtros.proceso ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <label>Responsable: <select data-f="resp" class="sel"><option value="">Todos</option><option value="-"${filtros.resp === '-' ? ' selected' : ''}>Sin asignar</option>
      ${lista.map(u => `<option value="${esc(u.id)}"${u.id === filtros.resp ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></label>
    <label><input type="checkbox" data-f="oblig"${filtros.oblig ? ' checked' : ''}> Solo obligatorios</label>
    ${estado.editable ? '<span class="nota">Haga clic en una celda para editarla.</span>' : '<span class="nota">Solo lectura.</span>'}`;
  caja.addEventListener('change', e => {
    const f = e.target.dataset.f;
    if (!f) return;
    filtros[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    pintarTabla(wrap);
  });
}

// ── Tabla principal ───────────────────────────────────────────────────────────

function pintarTabla(wrap) {
  const items = estado.items.filter(i => {
    const d = estado.detalle.get(i.item_codigo) || {};
    return (!filtros.proceso || i.proceso === filtros.proceso) && (!filtros.oblig || i.obligatorio) &&
      (!filtros.resp || (filtros.resp === '-' ? !d.responsable_id && !d.responsable : d.responsable_id === filtros.resp));
  });
  const ed = estado.editable ? ' data-editable' : '';

  const filas = items.map(item => {
    const c = item.item_codigo;
    const d = estado.detalle.get(c) || {};
    const s = segDe(c);
    const ref = !s && segVigente(c);       // sin registro en esta reunión: se muestra el último, en gris
    const seg = s || ref || {};
    const n = estado.seguimientos.filter(x => x.item_codigo === c).length;
    const fin = finVigente(c, estado.reunion);
    const atrasado = fin && fin < estado.reunion && Number(seg.avance ?? 0) < 100;
    const resp = d.responsable_id ? (nombre(d.responsable_id) || d.responsable) : d.responsable;
    return `<tr class="${item.obligatorio ? '' : 'row-opc'}${atrasado ? ' arr-atrasado' : ''}" data-item-row="${esc(c)}">
      <td class="col-item">${esc(c)}</td>
      <td class="col-proceso">${esc(item.proceso)}</td>
      <td class="col-area">${esc(item.area_lider)}</td>
      <td class="col-oblig">${item.obligatorio ? 'Sí' : ''}</td>
      <td class="col-desc">${esc(item.descripcion)}</td>
      <td class="col-resp"${ed} data-campo="responsable_id">${esc(resp || '')}</td>
      <td class="col-fecha"${ed} data-campo="inicio_programado">${d.inicio_programado ? fmtFecha(d.inicio_programado) : ''}</td>
      <td class="col-fecha"${ed} data-campo="fin_programado">${d.fin_programado ? fmtFecha(d.fin_programado) : ''}</td>
      <td class="col-com"${ed} data-campo="comentarios">${esc(d.comentarios || '')}</td>
      <td class="col-fecha col-seg${ref ? ' arr-ref' : ''}" title="${ref ? `Sin registro en esta reunión: se muestra la revisión del ${fmtFecha(ref.fecha_revision)}` : ''}">
        ${seg.fecha_revision ? fmtFecha(seg.fecha_revision) : ''}${n ? ` <button class="btn-icono arr-hist" data-hist="${esc(c)}" title="Historial de seguimiento (${n})">🕘</button>` : ''}</td>
      <td class="col-avance col-seg${ref ? ' arr-ref' : ''}"${ed} data-seg data-campo="avance">${seg.avance != null ? `${Number(seg.avance)}%` : ''}</td>
      <td class="col-com col-seg${ref ? ' arr-ref' : ''}"${ed} data-seg data-campo="comentarios">${esc(seg.comentarios || '')}</td>
      <td class="col-fecha col-seg${ref ? ' arr-ref' : ''}"${ed} data-seg data-campo="fin_reprogramado">${seg.fin_reprogramado ? fmtFecha(seg.fin_reprogramado) : ''}</td>
    </tr>`;
  }).join('');

  const tabla = wrap.querySelector('[data-tabla]');
  tabla.innerHTML = `<div class="arr-tabla-scroll"><table class="arr-tabla">
    <thead>
      <tr class="arr-grupos"><th colspan="9" class="arr-def">Definición — reunión de definición</th>
        <th colspan="4" class="arr-seg">Seguimiento — reunión del ${fmtFecha(estado.reunion)}</th></tr>
      <tr>
        <th class="arr-def col-item">Ítem</th><th class="arr-def">Proceso</th><th class="arr-def">Área Líder</th>
        <th class="arr-def">Obligatorio</th><th class="arr-def">Descripción de Actividades</th><th class="arr-def">Responsable</th>
        <th class="arr-def">Inicio programado</th><th class="arr-def">Fin programado</th><th class="arr-def">Comentarios</th>
        <th class="arr-seg">Fecha de revisión</th><th class="arr-seg">% Avance Acumulado</th><th class="arr-seg">Comentarios</th>
        <th class="arr-seg">Fin re-programado</th>
      </tr>
    </thead>
    <tbody>${filas || '<tr><td colspan="13" class="nota">Sin ítems con estos filtros.</td></tr>'}</tbody>
  </table></div>`;
  tabla.onclick = e => {
    const h = e.target.closest('[data-hist]');
    if (h) return mostrarHistorial(h.dataset.hist);
    const td = e.target.closest('[data-editable]');
    if (td && !td.querySelector('input,select')) editarCelda(wrap, td);
  };
}

// ── Edición en la celda ───────────────────────────────────────────────────────

function editarCelda(wrap, td) {
  const codigo = td.closest('[data-item-row]').dataset.itemRow;
  const campo = td.dataset.campo;
  const esSeg = td.hasAttribute('data-seg');
  const actual = esSeg ? segDe(codigo)?.[campo] : estado.detalle.get(codigo)?.[campo];
  let control;
  if (campo === 'responsable_id') {
    const { lista, soloProyecto } = usuariosProyecto();
    control = `<select class="cel-input"><option value="">— Sin asignar —</option>
      ${lista.map(u => `<option value="${esc(u.id)}"${u.id === actual ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}
      ${soloProyecto ? '' : '<option disabled>(el proyecto aún no tiene miembros: se listan todos los usuarios)</option>'}</select>`;
  } else if (campo === 'avance') {
    control = `<input type="number" class="cel-input" min="0" max="100" step="1" value="${actual ?? ''}" placeholder="%">`;
  } else if (/programado|reprogramado/.test(campo)) {
    control = `<input type="date" class="cel-input" value="${actual || ''}">`;
  } else {
    control = `<input type="text" class="cel-input" value="${esc(actual || '')}">`;
  }
  td.innerHTML = control;
  const inp = td.querySelector('input,select');
  inp.focus();
  let terminado = false;
  const terminar = async guardar => {
    if (terminado) return;
    terminado = true;
    if (guardar) {
      const v = inp.value.trim();
      try {
        if (esSeg) await guardarSeguimiento(codigo, campo, v);
        else await guardarDefinicion(codigo, campo, v);
      } catch (e) { mostrarError(mensajeError(e)); }
    }
    pintarKpis(wrap);
    pintarTabla(wrap);
  };
  inp.addEventListener('blur', () => terminar(true));
  if (inp.tagName === 'SELECT') inp.addEventListener('change', () => inp.blur());
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') inp.blur();
    if (ev.key === 'Escape') terminar(false);
  });
}

async function guardarDefinicion(codigo, campo, v) {
  const det = estado.detalle.get(codigo) || {};
  const cambios = { [campo]: v || null };
  if (campo === 'responsable_id') cambios.responsable = v ? nombre(v) : null;
  // Como en el formato: si no tiene fin programado, se propone inicio + 90 días
  if (campo === 'inicio_programado' && v && !det.fin_programado) cambios.fin_programado = sumarDias(v, DIAS_FIN_POR_DEFECTO);
  if (campo === 'fin_programado' && v && det.inicio_programado && v < det.inicio_programado) {
    throw new Error('El fin programado no puede ser anterior al inicio programado.');
  }
  const [g] = await api.upsert('programa_arranque_detalle',
    { programa_id: estado.programa.id, item_codigo: codigo, ...cambios }, 'programa_id,item_codigo');
  estado.detalle.set(codigo, { ...det, ...g });
}

async function guardarSeguimiento(codigo, campo, v) {
  let valor = v || null;
  if (campo === 'avance' && valor !== null) {
    valor = Number(valor);
    if (!(valor >= 0 && valor <= 100)) throw new Error('El % de avance debe estar entre 0 y 100.');
    const previo = estado.seguimientos.filter(s => s.item_codigo === codigo && s.fecha_revision < estado.reunion).at(-1);
    if (previo?.avance != null && valor < Number(previo.avance)) {
      ok(`Atención: el avance acumulado baja de ${Number(previo.avance)}% a ${valor}%.`);
    }
  }
  const [g] = await api.upsert('programa_arranque_seguimiento',
    { programa_id: estado.programa.id, item_codigo: codigo, fecha_revision: estado.reunion, [campo]: valor },
    'programa_id,item_codigo,fecha_revision');
  estado.seguimientos = estado.seguimientos.filter(s => s.id !== g.id).concat(g)
    .sort((a, b) => a.fecha_revision.localeCompare(b.fecha_revision));
  if (!estado.reuniones.includes(estado.reunion)) estado.reuniones = [...estado.reuniones, estado.reunion].sort();
}

// ── Historial de seguimiento de un ítem ───────────────────────────────────────

function mostrarHistorial(codigo) {
  const item = estado.items.find(i => i.item_codigo === codigo);
  const filas = estado.seguimientos.filter(s => s.item_codigo === codigo).slice().reverse();
  modal({
    titulo: `Seguimiento del ítem ${codigo}`, ancho: 720,
    cuerpo: `<p class="nota">${esc(item?.descripcion || '')}</p>
      <table class="arr-tabla"><thead><tr><th class="arr-seg">Fecha de revisión</th><th class="arr-seg">% Avance</th>
        <th class="arr-seg">Comentarios</th><th class="arr-seg">Fin re-programado</th><th class="arr-seg">Registró</th></tr></thead>
      <tbody>${filas.map(s => `<tr><td>${fmtFecha(s.fecha_revision)}</td><td>${s.avance != null ? Number(s.avance) + '%' : ''}</td>
        <td style="white-space:normal">${esc(s.comentarios || '')}</td><td>${s.fin_reprogramado ? fmtFecha(s.fin_reprogramado) : ''}</td>
        <td>${esc(nombre(s.created_by) || '')}</td></tr>`).join('')}</tbody></table>`,
  });
}

// ── Excel en el formato CR-PG-SGP-01-F1 ───────────────────────────────────────

async function exportarExcel() {
  const XLSX = await libExcel();
  const p = proyecto(estado.proyId) || {};
  const libro = XLSX.utils.book_new();
  const datos = CAMPOS_INFO.map(c => [c.label, c.name === 'nombre_completo' ? (p.nombre_completo || p.nombre_corto) : (p[c.name] || '')]);
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[], ...datos.map(r => ['', ...r])]), '0.Datos');
  const cab = ['Ítem', 'Proceso', 'Área Líder', 'Obligatorio', 'Descripción de Actividades', 'Responsable', 'Inicio programado',
    'Fin programado', 'Comentarios', '', 'Fecha de revisión', '% Avance Acumulado', 'Comentarios', 'Fin re-programado'];
  const filas = estado.items.map(i => {
    const d = estado.detalle.get(i.item_codigo) || {};
    const s = segVigente(i.item_codigo) || {};
    return [i.item_codigo, i.proceso, i.area_lider, i.obligatorio ? 'Sí' : '', i.descripcion,
      d.responsable_id ? nombre(d.responsable_id) || d.responsable : d.responsable || '', d.inicio_programado || '', d.fin_programado || '',
      d.comentarios || '', '', s.fecha_revision || '', s.avance != null ? Number(s.avance) / 100 : '', s.comentarios || '', s.fin_reprogramado || ''];
  });
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[], cab, ...filas]), '1.Programa de arranque');
  const hist = estado.seguimientos.map(s => [s.item_codigo, s.fecha_revision, s.avance != null ? Number(s.avance) / 100 : '', s.comentarios || '',
    s.fin_reprogramado || '', nombre(s.created_by) || '']);
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Ítem', 'Fecha de revisión', '% Avance Acumulado', 'Comentarios',
    'Fin re-programado', 'Registró'], ...hist]), 'Historial de seguimiento');
  XLSX.writeFile(libro, `CR-PG-SGP-01-F1 Programa de Arranque ${p.codigo || ''} ${fmtFecha(estado.reunion).replaceAll('/', '-')}.xlsx`);
}
