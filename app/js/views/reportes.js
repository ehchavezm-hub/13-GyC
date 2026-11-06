// Reportes: árbol de reportes a la izquierda y presentación preliminar a la derecha (papel, orientación,
// "Todo en 1 hoja", nombre del archivo y Guardar PDF). Los datos se leen de la base con los mismos cálculos
// que las pantallas (PAC, Pareto de CNC, capacidad…) para que el reporte coincida con lo que se ve en la app.
import { api, mensajeError } from '../data/api.js';
import { store, on, lideres, equipo, nombre, proyecto, etiqueta, textoEstado, colorEstado, param, valoresLista, esGestor, esStaff, visibleParaConsulta, semanasLookAhead, enProyectoSel, haySeleccion, nombreSeleccion } from '../core/store.js';
import { lunes, sumarSemanas, sumarDias, etiquetaSemana, esc, html, num, pct, fmtFecha, hoy, DIAS, agrupar } from '../core/util.js';
import { error } from '../ui/ui.js';
import { columnasActividad } from '../services/columnas.js';
import { definicionPDF } from '../ui/grid.js';
import { resumenPAC, resumenHistorico, colorPAC, paretoCNC, resumenRestricciones, capacidadSemana, colorCarga, restriccionesActivas } from '../services/indicadores.js';
import { tablaPDF, kpisPDF, documentoReporte, nombreProyectoActual, nombreArchivo, PAPELES } from '../services/pdf.js';

// ---------- Utilidades de los reportes ----------
const badge = (t, c) => (t ? `<span class="badge" style="--c:${c || '#4E79A7'}">${esc(t)}</span>` : '');
const delProyecto = a => enProyectoSel(a.proyecto_id);   // incluye los Grupos LPS, como el Plan semanal y el Look Ahead
const delResp = (f, campo = 'responsable_id') => (!f.resp || f.resp === 'todos' ? () => true : x => x[campo] === f.resp);

/** Columnas de PDF a partir de las mismas definiciones de las grillas (títulos, orden, anchos y texto de cada celda). */
function columnasDeDefs(defs) {
  return defs.filter(c => c && c.visible !== false).map(c => definicionPDF(c)).filter(Boolean);
}

/** Barras horizontales en SVG (se imprimen nítidas). datos: [{ etiqueta, valor, texto, color }] */
function barras(datos, { max = Math.max(1, ...datos.map(d => d.valor || 0)), alto = 18, anchoEtiqueta = 230, meta } = {}) {
  const corto = t => (String(t).length > 40 ? String(t).slice(0, 38) + '…' : String(t));
  if (!datos.length) return '<p class="nota">Sin datos para el periodo.</p>';
  const W = 640, area = W - anchoEtiqueta - 70, H = datos.length * (alto + 6) + 6;
  const x = v => anchoEtiqueta + (Math.max(0, v || 0) / max) * area;
  return `<svg viewBox="0 0 ${W} ${H + (meta != null ? 14 : 0)}" width="100%" style="max-width:${W}px;font-family:Manrope,Arial;font-size:9px">
    ${datos.map((d, i) => { const y = 6 + i * (alto + 6); return `
      <text x="${anchoEtiqueta - 6}" y="${y + alto * 0.7}" text-anchor="end" fill="#1A1A2E"><title>${esc(d.etiqueta)}</title>${esc(corto(d.etiqueta))}</text>
      <rect x="${anchoEtiqueta}" y="${y}" width="${area}" height="${alto}" fill="#F1F4F8" rx="2"/>
      <rect x="${anchoEtiqueta}" y="${y}" width="${Math.max(0, x(d.valor) - anchoEtiqueta)}" height="${alto}" fill="${d.color || '#4E79A7'}" rx="2"/>
      <text x="${x(d.valor) + 4}" y="${y + alto * 0.7}" fill="#4A5568">${esc(d.texto ?? '')}</text>`; }).join('')}
    ${meta != null ? `<line x1="${x(meta)}" x2="${x(meta)}" y1="2" y2="${H}" stroke="#1A365D" stroke-dasharray="3 2"/><text x="${x(meta)}" y="${H + 11}" text-anchor="middle" fill="#1A365D">Meta ${pct(meta)}</text>` : ''}
  </svg>`;
}

const semanasLA = () => semanasLookAhead();   // mismo horizonte que la pantalla Look Ahead (pedido 110)

/** Serie semanal de PAC (actividades y, si no hay, el histórico importado), como en el Tablero. */
async function seriePAC(f) {
  const area = store.area.id;
  const desde = sumarSemanas(f.semana, -(f.periodo - 1));
  const [acts, hist] = await Promise.all([
    api.list('actividades', { eq: { area_id: area }, gte: { semana: desde }, lte: { semana: f.semana } }),
    api.list('pac_historico', { eq: { area_id: area }, gte: { semana: desde }, lte: { semana: f.semana } }),
  ]);
  const actsF = acts.filter(a => visibleParaConsulta(a.proyecto_id)).filter(delProyecto).filter(delResp(f));   // como el Tablero
  const semanas = Array.from({ length: f.periodo }, (_, i) => sumarSemanas(desde, i));
  const serie = semanas.map(s => {
    let r = resumenPAC(actsF.filter(a => a.semana === s));
    if (!r.comprometidas) {
      const h = hist.filter(x => x.semana === s && delResp(f)(x));
      if (h.length && !haySeleccion() && esStaff()) r = { ...resumenHistorico(h), comprometidas: 0 };   // igual que el Tablero
    }
    return { semana: s, ...r };
  });
  return { acts: actsF, serie, desde };
}

const pieFiltro = f => `<p class="nota">${f.resp && f.resp !== 'todos' ? `Responsable: ${esc(nombre(f.resp))} · ` : 'Todo el equipo · '}${haySeleccion() ? `${store.proyectoSel ? 'Proyecto' : 'Filtro'}: ${esc(nombreProyectoActual())}` : 'Todos los proyectos'}</p>`;

// ---------- Catálogo de reportes ----------
// filtros: 'semana' (semana de referencia), 'periodo' (n semanas hasta la de referencia), 'resp' (responsable)
const REPORTES = [
  { grupo: 'Planificación (Look Ahead / LPS)', id: 'plan', staff: true, titulo: 'Plan semanal', filtros: ['semana', 'resp'], semana: () => lunes(), orientacion: 'landscape',
    async generar(f) {
      const acts = (await api.list('actividades', { eq: { area_id: store.area.id, semana: f.semana } }))
        .filter(a => a.comprometida).filter(delProyecto).filter(delResp(f)).sort((a, b) => nombre(a.responsable_id).localeCompare(nombre(b.responsable_id)) || (a.orden || 0) - (b.orden || 0));
      const r = resumenPAC(acts);
      return `<p class="nota">${esc(etiquetaSemana(f.semana))}</p>${pieFiltro(f)}` +
        kpisPDF([['PAC', pct(r.pac), colorPAC(r.pac)], ['Comprometidas', r.comprometidas], ['Completadas', r.completadas, '#59A14F'],
          ['No completadas', r.noCompletadas, '#E15759'], ['No programadas', r.noProgramadas, '#F28E2B'], ['HH plan', num(r.hhPlan)]]) +
        tablaPDF(columnasDeDefs(columnasActividad({ modo: 'plan', semana: f.semana })), acts);
    } },
  { grupo: 'Planificación (Look Ahead / LPS)', id: 'lookahead', staff: true, titulo: 'Look Ahead', filtros: ['resp'], orientacion: 'landscape',
    async generar(f) {
      const sem = semanasLA();
      const [acts, rests] = await Promise.all([
        api.list('actividades', { eq: { area_id: store.area.id }, in: { semana: sem } }),
        api.list('restricciones', { eq: { area_id: store.area.id } }),
      ]);
      const cols = [...columnasDeDefs(columnasActividad({ modo: 'lookahead', semanasLA: sem })),
        { titulo: 'Restricciones', ancho: 180, valor: a => restriccionesActivas(a.id, rests).map(r => r.descripcion).join('; ') }];
      const base = acts.filter(delProyecto).filter(delResp(f));
      return pieFiltro(f) + sem.map(s => {
        const de = base.filter(a => a.semana === s);
        return `<h2>${esc(etiquetaSemana(s))} · ${de.length} actividad(es) · ${num(de.reduce((x, a) => x + (Number(a.hh_total) || 0), 0))} HH</h2>` + tablaPDF(cols, de);
      }).join('');
    } },
  { grupo: 'Planificación (Look Ahead / LPS)', id: 'noprog', staff: true, titulo: 'Actividades no programadas', filtros: ['semana', 'resp'], semana: () => lunes(), orientacion: 'landscape',
    async generar(f) {
      const acts = (await api.list('actividades', { eq: { area_id: store.area.id, semana: f.semana } }))
        .filter(a => a.comprometida && a.tipo === 'no_programada').filter(delProyecto).filter(delResp(f));
      return `<p class="nota">${esc(etiquetaSemana(f.semana))} · ${acts.length} actividad(es) que surgieron durante la semana (no afectan el PAC).</p>${pieFiltro(f)}` +
        tablaPDF(columnasDeDefs(columnasActividad({ modo: 'plan', semana: f.semana })), acts);
    } },
  { grupo: 'Planificación (Look Ahead / LPS)', id: 'restricciones', staff: true, titulo: 'Log de restricciones', filtros: ['resp'], orientacion: 'landscape',
    async generar(f) {
      const [rests, acts, { columnasRestricciones }] = await Promise.all([
        api.list('restricciones', { eq: { area_id: store.area.id }, order: [['f_requerida', true]] }),
        api.list('actividades', { eq: { area_id: store.area.id }, gte: { semana: '2000-01-01' } }),
        import('./restricciones.js'),
      ]);
      const porId = new Map(acts.map(a => [a.id, a]));
      // Responsable: quien debe levantarla o el responsable de la actividad a la que pertenece
      const deResp = x => !f.resp || f.resp === 'todos' || x.responsable_id === f.resp || porId.get(x.actividad_id)?.responsable_id === f.resp;
      const rs = rests.filter(delProyecto).filter(deResp).sort((a, b) => (a.estado === 'levantada') - (b.estado === 'levantada'));
      const r = resumenRestricciones(rs);
      return pieFiltro(f) + kpisPDF([['Abiertas', r.abiertas], ['Vencidas', r.vencidas, '#E15759'], ['Levantadas', r.levantadas, '#59A14F'], ['A tiempo', pct(r.pctATiempo)]]) +
        tablaPDF(columnasDeDefs(columnasRestricciones(() => porId)), rs);   // mismas columnas que la pantalla Restricciones
    } },
  { grupo: 'Planificación (Look Ahead / LPS)', id: 'cartera', staff: true, titulo: 'Cartera de servicios', filtros: ['resp'], orientacion: 'landscape',
    async generar(f) {
      const [todos, { columnasCartera }] = await Promise.all([api.list('cartera', { eq: { area_id: store.area.id } }), import('./cartera.js')]);
      const items = todos.filter(delProyecto).filter(delResp(f)).sort((a, b) => String(b.f_solicitud || '').localeCompare(String(a.f_solicitud || '')));
      const abiertas = items.filter(c => ['nueva', 'abierta', 'en_proceso'].includes(c.estado));
      return pieFiltro(f) + kpisPDF([['Total', items.length], ['Abiertas', abiertas.length, '#F28E2B'], ['Nuevas', items.filter(c => c.estado === 'nueva').length, '#4E79A7']]) +
        tablaPDF(columnasDeDefs(columnasCartera()), items);   // mismas columnas que la pantalla Cartera
    } },

  { grupo: 'Seguimiento y control', id: 'ejecutivo', titulo: 'Informe ejecutivo', filtros: ['semana', 'periodo', 'resp'], orientacion: 'portrait',
    async generar(f) {
      const { acts, serie } = await seriePAC(f);
      const c = serie.reduce((x, s) => x + (s.completadas || 0), 0), n = serie.reduce((x, s) => x + (s.noCompletadas || 0), 0);
      const pacPeriodo = c + n ? c / (c + n) : null;
      const sem = resumenPAC(acts.filter(a => a.semana === f.semana));
      const rests = esStaff() ? (await api.list('restricciones', { eq: { area_id: store.area.id } })).filter(delProyecto) : [];
      const rr = resumenRestricciones(rests);
      const pareto = paretoCNC(acts).slice(0, 5);
      const meta = Number(param('meta_pac'));
      return `<p class="nota">Periodo: ${esc(etiquetaSemana(serie[0].semana).split('·')[0])} a ${esc(etiquetaSemana(f.semana))} (${f.periodo} semanas)</p>${pieFiltro(f)}` +
        kpisPDF([['PAC del periodo', pct(pacPeriodo), colorPAC(pacPeriodo)], ['PAC de la semana', pct(sem.pac), colorPAC(sem.pac)], ['Meta', pct(meta), '#1A365D'],
          ['% no programadas', pct(sem.pctNoProgramadas), '#F28E2B'],
          ...(esStaff() ? [['Restricciones abiertas', rr.abiertas, rr.vencidas ? '#E15759' : '#59A14F'], ['Vencidas', rr.vencidas, '#E15759']] : [])]) +
        '<h2>PAC por semana</h2>' + barras(serie.map(s => ({ etiqueta: etiquetaSemana(s.semana).split('·')[0].trim(), valor: s.pac ?? 0, texto: s.pac == null ? 'sin datos' : pct(s.pac), color: colorPAC(s.pac) })), { max: 1, meta }) +
        '<h2>Principales causas de no cumplimiento</h2>' + barras(pareto.map(p => ({ etiqueta: etiqueta(p.cnc_id) || 'Sin causa', valor: p.cantidad, texto: `${p.cantidad} · ${pct(p.pct)}`, color: '#E15759' })));
    } },
  { grupo: 'Seguimiento y control', id: 'pac', titulo: 'PAC por semana', filtros: ['semana', 'periodo', 'resp'], orientacion: 'portrait',
    async generar(f) {
      const { serie } = await seriePAC(f);
      const meta = Number(param('meta_pac'));
      return pieFiltro(f) + barras(serie.map(s => ({ etiqueta: etiquetaSemana(s.semana).split('·')[0].trim(), valor: s.pac ?? 0, texto: s.pac == null ? 'sin datos' : pct(s.pac), color: colorPAC(s.pac) })), { max: 1, meta }) +
        tablaPDF([
          { titulo: 'Semana', ancho: 170, valor: s => etiquetaSemana(s.semana) },
          { titulo: 'Comprometidas', ancho: 80, num: true, valor: s => s.historico ? '' : s.comprometidas },
          { titulo: 'Completadas', ancho: 80, num: true, valor: s => s.completadas ?? '' },
          { titulo: 'No completadas', ancho: 80, num: true, valor: s => s.noCompletadas ?? '' },
          { titulo: 'No programadas', ancho: 80, num: true, valor: s => s.noProgramadas ?? '' },
          { titulo: 'HH plan', ancho: 70, num: true, valor: s => num(s.hhPlan) },
          { titulo: 'PAC', ancho: 70, num: true, html: true, valor: s => (s.pac == null ? '—' : `<b style="color:${colorPAC(s.pac)}">${pct(s.pac)}</b>`) },
          { titulo: 'Fuente', ancho: 80, valor: s => (s.historico ? 'Histórico' : 'Aplicativo') },
        ], serie);
    } },
  { grupo: 'Seguimiento y control', id: 'pac_resp', titulo: 'PAC por responsable', filtros: ['semana', 'periodo'], orientacion: 'portrait',
    async generar(f) {
      const { acts } = await seriePAC({ ...f, resp: 'todos' });
      const filas = equipo(acts).map(l => ({ l, r: resumenPAC(acts.filter(a => a.responsable_id === l.id)) })).filter(x => x.r.total)
        .sort((a, b) => (b.r.pac ?? -1) - (a.r.pac ?? -1));
      return `<p class="nota">${f.periodo} semanas hasta ${esc(etiquetaSemana(f.semana))}</p>` +
        barras(filas.map(x => ({ etiqueta: x.l.nombre, valor: x.r.pac ?? 0, texto: x.r.pac == null ? '—' : pct(x.r.pac), color: colorPAC(x.r.pac) })), { max: 1, meta: Number(param('meta_pac')) }) +
        tablaPDF([
          { titulo: 'Responsable', ancho: 170, valor: x => x.l.nombre },
          { titulo: 'Comprometidas', ancho: 80, num: true, valor: x => x.r.comprometidas },
          { titulo: 'Completadas', ancho: 80, num: true, valor: x => x.r.completadas },
          { titulo: 'No completadas', ancho: 80, num: true, valor: x => x.r.noCompletadas },
          { titulo: 'No programadas', ancho: 80, num: true, valor: x => x.r.noProgramadas },
          { titulo: 'HH plan', ancho: 70, num: true, valor: x => num(x.r.hhPlan) },
          { titulo: 'Precisión', ancho: 70, num: true, valor: x => (x.r.precision == null ? '—' : num(x.r.precision, 2)) },
          { titulo: 'PAC', ancho: 70, num: true, html: true, valor: x => (x.r.pac == null ? '—' : `<b style="color:${colorPAC(x.r.pac)}">${pct(x.r.pac)}</b>`) },
        ], filas);
    } },
  { grupo: 'Seguimiento y control', id: 'pareto', titulo: 'Pareto de causas de no cumplimiento (CNC)', filtros: ['semana', 'periodo', 'resp'], orientacion: 'portrait',
    async generar(f) {
      const { acts } = await seriePAC(f);
      const p = paretoCNC(acts);
      return pieFiltro(f) + barras(p.map(x => ({ etiqueta: etiqueta(x.cnc_id) || 'Sin causa', valor: x.cantidad, texto: `${x.cantidad} · ${pct(x.pct)}`, color: '#E15759' }))) +
        tablaPDF([
          { titulo: 'Causa', ancho: 260, valor: x => etiqueta(x.cnc_id) || 'Sin causa' },
          { titulo: 'Cantidad', ancho: 70, num: true, valor: x => x.cantidad },
          { titulo: '%', ancho: 70, num: true, valor: x => pct(x.pct) },
          { titulo: '% acumulado', ancho: 80, num: true, valor: x => pct(x.acumulado) },
        ], p);
    } },
  { grupo: 'Seguimiento y control', id: 'carga', staff: true, titulo: 'Carga vs capacidad (HH)', filtros: ['resp'], orientacion: 'landscape',
    async generar(f) {
      const sem = semanasLA();
      const [acts, ubic] = await Promise.all([
        api.list('actividades', { eq: { area_id: store.area.id }, in: { semana: sem } }),
        api.list('ubicaciones_dia', { eq: { area_id: store.area.id }, gte: { fecha: sem[0] }, lte: { fecha: sumarDias(sem.at(-1), 6) } }),
      ]);
      const personas = (f.resp && f.resp !== 'todos') ? lideres().filter(l => l.id === f.resp) : equipo(acts);
      const celda = (l, s) => {
        // Todas las actividades de la persona (de todos los proyectos), igual que en el Look Ahead: la capacidad es de la persona
        const hh = acts.filter(a => a.responsable_id === l.id && a.semana === s && a.estado_la !== 'cancelada').reduce((x, a) => x + (Number(a.hh_total) || 0), 0);
        const cap = capacidadSemana(l.id, s, ubic);
        const r = cap ? hh / cap : null;
        return `<div style="display:flex;align-items:center;gap:2mm"><div style="flex:1;height:2.4mm;background:#F1F4F8;border-radius:1mm;overflow:hidden">
          <div style="width:${Math.min(100, (r || 0) * 100)}%;height:100%;background:${colorCarga(r)}"></div></div>
          <span style="white-space:nowrap">${num(hh)} / ${num(cap)}${r != null && r > 1.05 ? ' ⚠' : ''}</span></div>`;
      };
      return `<p class="nota">${f.resp && f.resp !== 'todos' ? `Responsable: ${esc(nombre(f.resp))} · ` : 'Todo el equipo · '}Todos los proyectos (la capacidad es de cada persona)</p>` + tablaPDF([{ titulo: 'Responsable', ancho: 170, valor: l => l.nombre },
        ...sem.map(s => ({ titulo: etiquetaSemana(s), ancho: 200, html: true, valor: l => celda(l, s) }))], personas) +
        '<p class="nota">Verde: carga normal · Ámbar: más del 90 % · Rojo: sobrecarga. La capacidad descuenta vacaciones y feriados.</p>';
    } },
  { grupo: 'Seguimiento y control', id: 'acuerdos', staff: true, titulo: 'Acuerdos de mejora (reunión semanal)', filtros: [], orientacion: 'portrait',
    async generar() {
      const acuerdos = (await api.list('acuerdos', { eq: { area_id: store.area.id } })).sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
      return tablaPDF([
        { titulo: 'Acción', ancho: 260, valor: a => a.accion },
        { titulo: 'Causa (CNC)', ancho: 150, valor: a => etiqueta(a.cnc_id) },
        { titulo: 'Responsable', ancho: 130, valor: a => nombre(a.responsable_id) },
        { titulo: 'Fecha', ancho: 80, valor: a => fmtFecha(a.fecha) },
        { titulo: 'Estado', ancho: 90, valor: a => a.estado },
      ], acuerdos);
    } },

  { grupo: 'Configuración', id: 'proyectos', staff: true, titulo: 'Catálogo de proyectos / procesos', filtros: [], orientacion: 'landscape',
    async generar() {
      const orden = ['activo', 'en_pausa', 'cerrado', 'propuesto'];
      // Cada Grupo LPS va justo debajo de su proyecto y muestra a cuál pertenece (auditoría 2)
      const padreDe = p => p.padre_id && proyecto(p.padre_id);
      const clave = p => `${padreDe(p)?.codigo ?? p.codigo}|${p.padre_id ? '1' : '0'}|${p.codigo}`;
      const grupos = agrupar([...store.proyectos].sort((a, b) => clave(a).localeCompare(clave(b))), p => p.estado);
      const cols = [
        { titulo: 'Código', ancho: 90, valor: p => p.codigo }, { titulo: 'Nombre corto', ancho: 200, valor: p => p.padre_id ? `   ▫ ${p.nombre_corto}` : p.nombre_corto },
        { titulo: 'Grupo LPS de', ancho: 160, valor: p => padreDe(p) ? `${padreDe(p).codigo} · ${padreDe(p).nombre_corto}` : '' },
        { titulo: 'Nombre completo', ancho: 280, valor: p => p.nombre_completo || '' }, { titulo: 'Gerencia', ancho: 150, valor: p => etiqueta(p.gerencia_id) },
        { titulo: 'Fase', ancho: 110, valor: p => etiqueta(p.fase_id) }, { titulo: 'País', ancho: 80, valor: p => etiqueta(p.pais_id) },
        { titulo: 'Inicio', ancho: 75, valor: p => fmtFecha(p.fecha_inicio) }, { titulo: 'Fin', ancho: 75, valor: p => fmtFecha(p.fecha_fin) },
      ];
      return [...grupos.keys()].sort((a, b) => orden.indexOf(a) - orden.indexOf(b)).map(e =>
        `<h2>${esc(textoEstado('estados_proyecto', e) || e)} · ${grupos.get(e).length}</h2>` + tablaPDF(cols, grupos.get(e))).join('');
    } },
  { grupo: 'Configuración', id: 'servicios', staff: true, titulo: 'CET / Servicios', filtros: [], orientacion: 'portrait',
    async generar() {
      const vals = valoresLista('servicios', { inactivos: true }).sort((a, b) => String(proyecto(a.extra?.proyecto_id)?.codigo || '~').localeCompare(String(proyecto(b.extra?.proyecto_id)?.codigo || '~')));
      return tablaPDF([
        { titulo: 'Proyecto', ancho: 230, valor: v => (proyecto(v.extra?.proyecto_id) ? `${proyecto(v.extra.proyecto_id).codigo} · ${proyecto(v.extra.proyecto_id).nombre_corto}` : '') },
        { titulo: 'CET', ancho: 100, valor: v => v.codigo || '' },
        { titulo: 'Servicio', ancho: 260, valor: v => v.valor },
        { titulo: 'Activo', ancho: 60, valor: v => (v.activo === false ? 'No' : 'Sí') },
      ], vals);
    } },
  { grupo: 'Configuración', id: 'equipo', staff: true, titulo: 'Usuarios y roles (con organigrama)', filtros: [], orientacion: 'landscape',
    async generar() {
      // Mismo contenido que Configuración → Usuarios y roles: tabla con sus columnas y el organigrama
      const nodos = await api.list('organigrama_nodos', { eq: { area_id: store.area.id }, order: [['orden', true]] });
      return (await import('./organigrama.js')).informeEquipo(nodos);
    } },
  { grupo: 'Configuración', id: 'plantillas', staff: true, titulo: 'Plantillas (recurrentes y de servicio)', filtros: [], orientacion: 'landscape',
    async generar() {
      const [pls, items, { columnasPlantilla }] = await Promise.all([
        api.list('plantillas', { eq: { area_id: store.area.id } }),
        api.list('plantilla_items', {}),
        import('./plantillas.js'),
      ]);
      return pls.filter(p => p.activa !== false).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre)).map(p => {
        const de = items.filter(i => i.plantilla_id === p.id).sort((a, b) => (a.orden || 0) - (b.orden || 0))
          .map(i => ({ ...i, hh_total: DIAS.reduce((s, d) => s + (Number(i[`hh_${d}`]) || 0), 0) }));
        // Mismas columnas que la pantalla Plantillas (que a su vez son las del Look Ahead)
        return `<h2>${p.tipo === 'servicio' ? '🧩' : '🔁'} ${esc(p.nombre)}${p.tipo === 'recurrente' ? ` · ${esc(nombre(p.propietario_id))}` : ''} · ${de.length} actividad(es)</h2>` +
          tablaPDF(columnasDeDefs(columnasPlantilla(p.tipo, p.propietario_id)), de);
      }).join('') || '<p class="nota">No hay plantillas.</p>';
    } },
];

// ---------- Pantalla ----------
let estado, desuscribir = [];

export async function render(el) {
  // 5 años atrás + 6 semanas adelante, agrupadas por año
  const _semRango = Array.from({ length: 5 * 52 + 6 }, (_, i) => sumarSemanas(lunes(), i - (5 * 52 - 1)));
  const _semPorAnio = _semRango.reduce((acc, s) => { const y = new Date(s).getFullYear(); (acc[y] = acc[y] || []).push(s); return acc; }, {});
  const semanas = _semRango; // kept for compat (filter uses .map later)
  let opciones = { papel: 'A4', unaHoja: false };
  try { opciones = { ...opciones, ...JSON.parse(localStorage.getItem('lpsgt-reportes') || '{}') }; } catch { /* sin almacenamiento */ }
  // Cada rol ve los reportes de las pantallas a las que tiene acceso (Consulta: los del Tablero)
  disponibles = REPORTES.filter(r => !r.staff || esStaff());
  // semana: null = la de cada reporte (Plan: la actual; indicadores: la última semana completa, como el Tablero)
  estado = { id: disponibles.some(r => r.id === opciones.ultimo) ? opciones.ultimo : disponibles[0].id,
    filtros: { semana: null, periodo: 8, resp: esGestor() ? 'todos' : store.usuario.id }, opciones, orientacion: null };
  const grupos = [...new Set(disponibles.map(r => r.grupo))];
  const pag = html(`<div class="reportes">
    <div class="reportes-arbol">${grupos.map(g => `<details open><summary>${esc(g)}</summary>
      ${disponibles.filter(r => r.grupo === g).map(r => `<button data-r="${r.id}">${esc(r.titulo)}</button>`).join('')}</details>`).join('')}</div>
    <div class="reportes-vista">
      <div class="reportes-barra">
        <label>Papel <select data-o="papel">${Object.keys(PAPELES).map(p => `<option>${p}</option>`).join('')}</select></label>
        <span class="seg"><button data-ori="landscape">▭ Horizontal</button><button data-ori="portrait">▯ Vertical</button></span>
        <label><input type="checkbox" data-o="unaHoja"> Todo en 1 hoja</label>
        <span data-f="semana"><label>Semana <select data-fl="semana">${
          Object.entries(_semPorAnio).sort(([a],[b]) => b - a)
            .map(([anio, sems]) => `<optgroup label="${anio}">${[...sems].reverse().map(s => `<option value="${s}">${esc(etiquetaSemana(s))}${s === lunes() ? ' ◀ actual' : ''}</option>`).join('')}</optgroup>`)
            .join('')
        }</select></label></span>
        <span data-f="periodo"><label>Periodo <select data-fl="periodo">${
          [[4,'4 sem.'],[8,'8 sem.'],[12,'12 sem.'],[26,'26 sem.'],[52,'1 año'],[104,'2 años'],[156,'3 años'],[260,'5 años'],[520,'10 años']]
            .map(([v,t]) => `<option value="${v}">${t}</option>`).join('')
        }</select></label></span>
        <span data-f="resp"><label>Responsable <select data-fl="resp"><option value="todos">Todo el equipo</option>${lideres().map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></label></span>
        <label class="archivo">📁 <input data-o="archivo"></label>
        <span class="flex"></span>
        <button class="btn btn-primario btn-sm" data-a="pdf">🖨 Guardar PDF</button>
      </div>
      <div class="reportes-hojas"><iframe data-prev title="Presentación preliminar"></iframe><div class="cargando oculto" data-carg><span class="spinner"></span> Generando…</div></div>
    </div></div>`);
  el.append(pag);
  pag.querySelector('[data-o="papel"]').value = PAPELES[estado.opciones.papel] ? estado.opciones.papel : 'A4';   // un papel ya no ofrecido vuelve a A4
  pag.querySelector('[data-o="unaHoja"]').checked = !!estado.opciones.unaHoja;
  pag.querySelector('[data-fl="periodo"]').value = String(estado.filtros.periodo);
  pag.querySelector('[data-fl="resp"]').value = estado.filtros.resp;
  if (!esStaff()) pag.querySelector('[data-f="resp"]').classList.add('oculto');

  pag.querySelector('.reportes-arbol').addEventListener('click', e => {
    const id = e.target.closest('[data-r]')?.dataset.r;
    if (id) { estado.id = id; estado.orientacion = null; generar(); }
  });
  pag.querySelectorAll('[data-ori]').forEach(b => b.addEventListener('click', () => { estado.orientacion = b.dataset.ori; generar(false); }));
  pag.querySelectorAll('[data-o="papel"], [data-o="unaHoja"]').forEach(i => i.addEventListener('change', () => generar(false)));
  pag.querySelectorAll('[data-fl]').forEach(i => i.addEventListener('change', () => {
    estado.filtros[i.dataset.fl] = i.dataset.fl === 'periodo' ? Number(i.value) : i.value; generar();
  }));
  pag.querySelector('[data-a="pdf"]').addEventListener('click', () => {
    const f = pag.querySelector('[data-prev]');
    // El navegador propone como nombre del PDF el título de la página principal: se usa el del reporte mientras se imprime
    const nombre = (pag.querySelector('[data-o="archivo"]').value || nombreArchivo('Reporte')).replace(/\.pdf$/i, '');
    const tituloApp = document.title;
    f.contentDocument.title = nombre; document.title = nombre;
    const restaurar = () => { document.title = tituloApp; };
    f.contentWindow.addEventListener('afterprint', restaurar, { once: true });
    setTimeout(restaurar, 60000);
    f.contentWindow.focus(); f.contentWindow.print();
  });
  desuscribir.forEach(f => f()); desuscribir = [];
  desuscribir.push(on('proyecto', () => generar()));
  await generar();
}

let ultimoHTML = '', disponibles = REPORTES;
async function generar(releer = true) {
  const pag = document.querySelector('#contenido .reportes');
  if (!pag) return;
  const rep = disponibles.find(r => r.id === estado.id) || disponibles[0];
  const filtros = { ...estado.filtros, semana: estado.filtros.semana || (rep.semana ? rep.semana() : sumarSemanas(lunes(), -1)) };
  pag.querySelector('[data-fl="semana"]').value = filtros.semana;
  pag.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('activo', b.dataset.r === rep.id));
  for (const k of ['semana', 'periodo', 'resp']) pag.querySelector(`[data-f="${k}"]`).style.display = rep.filtros.includes(k) ? '' : 'none';
  const orientacion = estado.orientacion || rep.orientacion;
  pag.querySelectorAll('[data-ori]').forEach(b => b.classList.toggle('activo', b.dataset.ori === orientacion));
  const papel = pag.querySelector('[data-o="papel"]').value;
  const unaHoja = pag.querySelector('[data-o="unaHoja"]').checked;
  const d = new Date();
  const archivo = nombreArchivo(rep.titulo, d);
  pag.querySelector('[data-o="archivo"]').value = archivo + '.pdf';
  try { localStorage.setItem('lpsgt-reportes', JSON.stringify({ papel, unaHoja, ultimo: rep.id })); } catch { /* sin almacenamiento */ }
  const carg = pag.querySelector('[data-carg]');
  try {
    if (releer || !ultimoHTML) {
      carg.classList.remove('oculto');
      ultimoHTML = await rep.generar(filtros);
    }
    pag.querySelector('[data-prev]').srcdoc = documentoReporte(rep.titulo, ultimoHTML, { papel, orientacion, unaHoja, archivo });
  } catch (e) {
    error(mensajeError(e));
  } finally { carg.classList.add('oculto'); }
}

export function destruir() { desuscribir.forEach(f => f()); desuscribir = []; estado = null; ultimoHTML = ''; }
