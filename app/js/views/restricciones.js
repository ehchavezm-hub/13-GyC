// Log de restricciones (6.8) con indicadores de liberación a tiempo (M-08).
import { api } from '../data/api.js';
import { store, on, esStaff, opciones, opcionesProyectos, opcionesEstado, colorEstado, proyecto, nombre, etiqueta, textoEstado, enProyectoSel, haySeleccion, nombreSeleccion } from '../core/store.js';
import { esc, html, hoy, fmtFecha, pct, num, agrupar } from '../core/util.js';
import { crearGrilla } from '../ui/grid.js';
import { kpi, badge } from '../ui/ui.js';
import { resumenRestricciones } from '../services/indicadores.js';
import { columnasPersonalizadas } from '../services/columnas.js';
import { abrirDetalle, sincronizarEstadoLA } from './detalle.js';
import { imprimirPDF, tablaPDF, kpisPDF } from '../services/pdf.js';

let grilla, desuscribir = [], estado;
const porSincronizar = new Set();   // actividades cuyo Estado LA se recalcula después de guardar

export async function render(el, params) {
  estado = { todas: false, rests: [], acts: new Map() };
  const pag = html(`<div>
    <div class="pagina-cab"><h1>Restricciones</h1><span data-proy></span>
      <label class="chk"><input type="checkbox" data-todas> Mostrar también las levantadas</label>
      <span class="flex"></span><button class="btn btn-sm" data-a="pdf">🖨 PDF</button></div>
    <div class="kpis" data-kpis></div>
    <div class="grid-2" style="margin-bottom:12px"><div class="tarjeta"><h2>Por tipo</h2><div data-tipo></div></div>
      <div class="tarjeta"><h2>Por responsable de levantarlas</h2><div data-resp></div></div></div>
    <div data-grilla></div></div>`);
  el.append(pag);
  pag.querySelector('[data-todas]').addEventListener('change', e => { estado.todas = e.target.checked; pintar(); });
  pag.querySelector('[data-a="pdf"]').addEventListener('click', pdf);

  grilla = crearGrilla(pag.querySelector('[data-grilla]'), {
    id: 'restricciones', tabla: 'restricciones', titulo: 'Restricciones',
    columnas: columnasRestricciones(() => estado.acts),
    agrupar: [{ field: 'estado', label: 'Estado' }, { field: 'tipo_id', label: 'Tipo' }, { field: 'proyecto_id', label: 'Proyecto' }, { field: 'responsable', label: 'Responsable' }],
    puedeEditarFila: () => esStaff(),
    nuevaFila: () => ({ area_id: store.area.id, proyecto_id: store.proyectoSel || null, estado: 'pendiente', f_identificada: hoy(), descripcion: '', extra: {} }),
    listaParaCrear: r => !!(r.descripcion && r.descripcion.trim()),
    derivar: (r, c) => ('estado' in c && c.estado === 'levantada' && !r.f_levantada ? { f_levantada: hoy() } : 'estado' in c && c.estado !== 'levantada' ? { f_levantada: null } : {}),
    claseFila: r => atraso(r) > 0 ? 'fila-alerta' : '',
    camposCalc: ['created_at', 'updated_at', 'created_by'],
    // Cambiar el estado de una restricción (o eliminarla) actualiza el Estado LA de su actividad, igual que en el Look Ahead
    alEditar: (r, campo) => { if (campo === 'estado' && r.actividad_id) porSincronizar.add(r.actividad_id); },
    eliminar: async r => { await api.remove('restricciones', r.id); if (r.actividad_id) porSincronizar.add(r.actividad_id); },
    alGuardar: async () => {
      const ids = [...porSincronizar]; porSincronizar.clear();
      await Promise.all(ids.map(sincronizarEstadoLA));
      cargarSilencioso();
    },
    vacio: 'Sin restricciones. Agréguelas desde aquí o desde el Look Ahead (columna 🚧).',
  });
  desuscribir.push(api.subscribe(['restricciones'], ev => { grilla.aplicarRemoto(ev, filtro); cargarSilencioso(); }));
  desuscribir.push(on('proyecto', () => pintar()));
  await cargar();
  if (params.id) {
    const r = estado.rests.find(x => x.id === params.id);
    if (r) abrirDetalle('restriccion', r);
  }
}

export function destruir() { desuscribir.forEach(f => f && f()); desuscribir = []; grilla?.destruir(); }

/** Columnas del log de restricciones (pantalla, su PDF y el reporte "Log de restricciones").
 *  actividades(): Map id → actividad, para mostrar la descripción de la actividad de cada restricción. */
export function columnasRestricciones(actividades) {
  return [
    { field: '_act', title: 'Actividad', tipo: 'texto', ancho: 230, calc: true,
      formato: (v, r) => esc(actividades().get(r.actividad_id)?.descripcion || (r.actividad_id ? '(actividad)' : '—')) },
    { field: 'proyecto_id', title: 'Proyecto', tipo: 'lista', ancho: 170, opciones: opcionesProyectos },
    { field: 'descripcion', title: 'Restricción', tipo: 'textoLargo', ancho: 260 },
    { field: 'tipo_id', title: 'Tipo', tipo: 'lista', ancho: 150, opciones: () => opciones('tipos_restriccion') },
    { field: 'responsable', title: 'Responsable', tipo: 'texto', ancho: 140, ayuda: 'Persona o área que debe levantarla (puede ser externa)' },
    { field: 'f_identificada', title: 'F. identificada', tipo: 'fecha', ancho: 105 },
    { field: 'f_requerida', title: 'F. requerida', tipo: 'fecha', ancho: 105 },
    { field: 'f_prometida', title: 'F. prometida', tipo: 'fecha', ancho: 105 },
    { field: 'f_levantada', title: 'F. levantada', tipo: 'fecha', ancho: 105 },
    { field: 'estado', title: 'Estado', tipo: 'lista', ancho: 115, colorear: true,
      opciones: () => opcionesEstado('estados_restriccion').map(o => ({ ...o, color: colorEstado('estados_restriccion', o.value) })) },
    { field: '_atraso', title: 'Días atraso', tipo: 'numero', ancho: 80, calc: true, filtro: false,
      formato: (v, r) => { const d = atraso(r); return d > 0 ? `<span class="celda-alerta">${d}</span>` : ''; } },
    { field: 'comentarios', title: 'Comentarios', tipo: 'textoLargo', ancho: 200 },
    { field: '_colab', title: '💬', tipo: 'texto', ancho: 46, calc: true, filtro: false,
      formato: (v, r) => r.id ? '<button class="mini-btn">＋</button>' : '', click: (r, e) => { if (r.id && e.target.closest('button')) abrirDetalle('restriccion', r); } },
    ...columnasPersonalizadas('restricciones'),
  ];
}

export function atraso(r) {
  const fin = r.estado === 'levantada' ? r.f_levantada : hoy();
  if (!r.f_requerida || !fin || fin <= r.f_requerida) return 0;
  return Math.round((new Date(fin) - new Date(r.f_requerida)) / 86400000);
}
function filtro(r) {
  if (!estado.todas && r.estado === 'levantada') return false;
  if (!enProyectoSel(r.proyecto_id)) return false;
  return true;
}
async function leer() {
  const [rests, acts] = await Promise.all([
    api.list('restricciones', { eq: { area_id: store.area.id }, order: [['f_requerida', true]] }),
    api.list('actividades', { eq: { area_id: store.area.id }, gte: { semana: '2000-01-01' } }),
  ]);
  estado.rests = rests;
  estado.acts = new Map(acts.map(a => [a.id, a]));
}
async function cargar() { await leer(); await grilla.inicializar(estado.rests.filter(filtro)); pintarKPIs(); }
async function cargarSilencioso() { try { await leer(); pintarKPIs(); grilla.refrescar(); } catch { /* se reintenta */ } }
async function pintar() { await grilla.setDatos(estado.rests.filter(filtro)); pintarKPIs(); }

function pintarKPIs() {
  const pag = document.querySelector('#contenido');
  if (!pag?.querySelector('[data-kpis]')) return;
  pag.querySelector('[data-proy]').innerHTML = haySeleccion() ? `<span class="chip-filtro">🏗 ${esc(nombreSeleccion())}</span>` : '';
  const base = estado.rests.filter(r => enProyectoSel(r.proyecto_id));
  const r = resumenRestricciones(base);
  pag.querySelector('[data-kpis]').innerHTML = [
    kpi('Abiertas', r.abiertas, { color: r.abiertas ? '#EDC948' : '#59A14F' }),
    kpi('Vencidas', r.vencidas, { color: r.vencidas ? '#E15759' : '#59A14F', sub: 'F. requerida ya pasó' }),
    kpi('Levantadas a tiempo', pct(r.pctATiempo), { color: '#4E79A7', sub: `${r.levantadas} levantadas` }),
    kpi('Atraso promedio', r.diasAtraso == null ? '—' : num(r.diasAtraso, 1) + ' d', { sub: 'De las levantadas tarde' }),
  ].join('');
  const tabla = (g, etq) => `<table class="simple"><tr><th>${etq}</th><th class="num">Abiertas</th><th class="num">Vencidas</th><th class="num">% a tiempo</th></tr>
    ${[...g.entries()].map(([k, arr]) => { const x = resumenRestricciones(arr); return `<tr><td>${esc(k || '—')}</td><td class="num">${x.abiertas}</td><td class="num">${x.vencidas}</td><td class="num">${pct(x.pctATiempo)}</td></tr>`; }).join('')}</table>`;
  pag.querySelector('[data-tipo]').innerHTML = tabla(agrupar(base, x => etiqueta(x.tipo_id)), 'Tipo');
  pag.querySelector('[data-resp]').innerHTML = tabla(agrupar(base, x => x.responsable || nombre(x.responsable_id)), 'Responsable');
}

function pdf() {
  const rs = grilla.filas().filter(r => r.id);
  const r = resumenRestricciones(rs);
  imprimirPDF('Log de restricciones', kpisPDF([['Abiertas', r.abiertas], ['Vencidas', r.vencidas, '#E15759'], ['A tiempo', pct(r.pctATiempo)]]) + tablaPDF(grilla.columnasPDF(), rs), { orientacion: 'landscape' });   // como en pantalla
}
