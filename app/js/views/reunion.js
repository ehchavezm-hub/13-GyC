// Reunión semanal (6.13) y modo reunión a pantalla completa con temporizador por paso (M-04).
import { api, mensajeError } from '../data/api.js';
import { store, puede, esGestor, lideres, equipo, semanaInicioLA, semanasLookAhead, nombre, etiqueta, param, opciones, opcionesLideres, proyecto, textoEstado, colorEstado } from '../core/store.js';
import { lunes, sumarSemanas, etiquetaSemana, esc, html, pct, num, hoy, fmtFecha, sumarDias } from '../core/util.js';
import { kpi, badge, ok, error, pedirDatos } from '../ui/ui.js';
import { resumenPAC, colorPAC, paretoCNC, resumenRestricciones, capacidadSemana, colorCarga } from '../services/indicadores.js';
import { crearGrilla } from '../ui/grid.js';
import { imprimirPDF, tablaPDF, kpisPDF } from '../services/pdf.js';

const PASOS = [
  ['cierre', '1. Cierre de la semana anterior'],
  ['avance', '2. Avance de la semana en curso'],
  ['restricciones', '3. Restricciones'],
  ['compromisos', '4. Compromisos de la semana a planificar'],
  ['lookahead', '5. Look Ahead'],
  ['acuerdos', '6. Acuerdos de mejora'],
];

let estado, timer, grillaAcuerdos;

export async function render(el) {
  const actual = lunes();
  estado = { paso: 0, inicio: Date.now(), tiempos: {}, asistentes: new Set(), reunion: null,
    anterior: sumarSemanas(actual, -1), actual, siguiente: semanaInicioLA() };   // la semana que se planifica (pedido 110)
  const area = store.area.id;
  const [acts, rests, ubic, acuerdos, reuniones] = await Promise.all([
    api.list('actividades', { eq: { area_id: area }, gte: { semana: estado.anterior }, lte: { semana: semanasLookAhead().at(-1) } }),
    api.list('restricciones', { eq: { area_id: area } }),
    api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: estado.siguiente }, lte: { fecha: sumarDias(estado.siguiente, 6) } }),
    api.list('acuerdos', { eq: { area_id: area }, order: [['created_at', false]] }),
    api.list('reuniones', { eq: { area_id: area, fecha: hoy() } }),
  ]);
  Object.assign(estado, { acts, rests, ubic, acuerdos, reunion: reuniones[0] || null });
  estado.equipo = equipo(acts);
  estado.asistentes = new Set(estado.equipo.map(l => l.id));
  if (estado.reunion) estado.asistentes = new Set(estado.reunion.asistentes || []);

  const pag = html(`<div>
    <div class="pagina-cab"><h1>Reunión semanal</h1><span class="pagina-sub">${esc(fmtFecha(hoy()))} · cierre ${esc(etiquetaSemana(estado.anterior).split('·')[0])} · compromisos ${esc(etiquetaSemana(estado.siguiente).split('·')[0])}</span>
      <span class="flex"></span><span class="cronometro" data-crono>00:00</span>
      <button class="btn btn-sm" data-a="pantalla">⛶ Modo reunión</button>
      <button class="btn btn-sm" data-a="pdf">🖨 Acta PDF</button>
      ${esGestor() ? '<button class="btn btn-sm btn-primario" data-a="guardar">💾 Guardar reunión</button>' : ''}</div>
    <div class="reunion-pasos">${PASOS.map(([k, t], i) => `<button class="reunion-paso" data-paso="${i}">${t}</button>`).join('')}</div>
    <details class="tarjeta" style="margin-bottom:12px"><summary><b>Asistentes</b> <span class="nota" data-asis-n></span></summary>
      <div class="multi" style="margin-top:8px;border:none">${lideres().map(l => `<label class="chk"><input type="checkbox" data-asis="${l.id}" ${estado.asistentes.has(l.id) ? 'checked' : ''}> ${esc(l.nombre)}</label>`).join('')}</div></details>
    <div data-paso-cuerpo></div>
    <div style="display:flex;justify-content:space-between;margin-top:14px">
      <button class="btn" data-a="ant">‹ Paso anterior</button><button class="btn btn-primario" data-a="sig">Paso siguiente ›</button></div>
  </div>`);
  el.append(pag);
  pag.addEventListener('click', e => {
    const p = e.target.closest('[data-paso]');
    if (p) irPaso(Number(p.dataset.paso));
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'ant') irPaso(Math.max(0, estado.paso - 1));
    if (a === 'sig') irPaso(Math.min(PASOS.length - 1, estado.paso + 1));
    if (a === 'pantalla') {
      document.body.classList.toggle('pantalla-completa');
      if (document.body.classList.contains('pantalla-completa')) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    }
    if (a === 'guardar') guardar();
    if (a === 'pdf') acta();
  });
  pag.addEventListener('change', e => {
    const id = e.target.dataset?.asis;
    if (!id) return;
    if (e.target.checked) estado.asistentes.add(id); else estado.asistentes.delete(id);
    pag.querySelector('[data-asis-n]').textContent = `(${estado.asistentes.size} de ${lideres().length})`;
  });
  pag.querySelector('[data-asis-n]').textContent = `(${estado.asistentes.size} de ${lideres().length})`;
  document.addEventListener('fullscreenchange', alSalirPantalla);
  irPaso(0);
  timer = setInterval(tick, 1000);
}

export function destruir() {
  clearInterval(timer);
  document.body.classList.remove('pantalla-completa');
  document.removeEventListener('fullscreenchange', alSalirPantalla);
  grillaAcuerdos?.destruir(); grillaAcuerdos = null;
}
function alSalirPantalla() { if (!document.fullscreenElement) document.body.classList.remove('pantalla-completa'); }

function tick() {
  const k = PASOS[estado.paso][0];
  estado.tiempos[k] = (estado.tiempos[k] || 0) + 1;
  const lim = (param('reunion_minutos') || {})[k];
  const el = document.querySelector('[data-crono]');
  if (!el) return;
  const s = estado.tiempos[k];
  el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${lim ? ` / ${lim}:00` : ''}`;
  el.classList.toggle('excedido', !!lim && s > lim * 60);
}

function irPaso(i) {
  estado.paso = i;
  document.querySelectorAll('.reunion-paso').forEach((b, j) => { b.classList.toggle('activo', j === i); b.classList.toggle('hecho', j < i); });
  const c = document.querySelector('[data-paso-cuerpo]');
  grillaAcuerdos?.destruir(); grillaAcuerdos = null;
  c.innerHTML = '';
  PINTORES[PASOS[i][0]](c);
}

function porLider(semana, campoPac = true) {
  return estado.equipo.map(l => {
    const r = resumenPAC(estado.acts.filter(a => a.semana === semana && a.responsable_id === l.id));
    return `<tr><td>${esc(l.nombre)}</td><td class="num">${r.comprometidas}</td><td class="num">${r.completadas}</td><td class="num">${r.noCompletadas}</td>
      ${campoPac ? `<td class="num"><b style="color:${colorPAC(r.pac)}">${pct(r.pac)}</b></td>` : `<td class="num">${r.pendientes}</td>`}</tr>`;
  }).join('');
}

const PINTORES = {
  cierre(c) {
    const de = estado.acts.filter(a => a.semana === estado.anterior);
    const r = resumenPAC(de);
    const par = paretoCNC(de);
    c.innerHTML = `<div class="kpis">${kpi('PAC del equipo', pct(r.pac), { color: colorPAC(r.pac), sub: `meta ${pct(param('meta_pac'))}` })}
      ${kpi('Completados', r.completadas, { color: '#59A14F' })}${kpi('No completados', r.noCompletadas, { color: '#E15759' })}${kpi('No programadas', r.noProgramadas, { color: '#F28E2B' })}</div>
      <div class="grid-2"><div class="tarjeta"><h2>PAC por líder</h2><table class="simple"><tr><th>Líder</th><th class="num">Compr.</th><th class="num">Compl.</th><th class="num">No compl.</th><th class="num">PAC</th></tr>${porLider(estado.anterior)}</table></div>
      <div class="tarjeta"><h2>¿Por qué no se cumplió? (CNC)</h2>${par.length ? `<table class="simple"><tr><th>Causa</th><th class="num">Cant.</th><th class="num">%</th></tr>
        ${par.map(p => `<tr><td>${esc(etiqueta(p.cnc_id) || 'Sin causa')}</td><td class="num">${p.cantidad}</td><td class="num">${pct(p.pct)}</td></tr>`).join('')}</table>
        <p class="nota">Analice las causas principales y registre acuerdos de mejora en el paso 6.</p>` : '<p class="nota">Sin incumplimientos. 🎉</p>'}</div></div>`;
  },
  avance(c) {
    const de = estado.acts.filter(a => a.semana === estado.actual && a.comprometida);
    const r = resumenPAC(de);
    c.innerHTML = `<div class="kpis">${kpi('Compromisos', r.comprometidas)}${kpi('Completados a la fecha', r.completadas, { color: '#59A14F' })}
      ${kpi('Pendientes de estado', r.pendientes, { color: '#EDC948' })}${kpi('No programadas', r.noProgramadas, { color: '#F28E2B' })}</div>
      <div class="tarjeta"><h2>Avance por líder (la semana se cierra hoy a las ${esc(param('cierre')?.hora || '17:00')})</h2>
      <table class="simple"><tr><th>Líder</th><th class="num">Compr.</th><th class="num">Compl.</th><th class="num">No compl.</th><th class="num">Pendientes</th></tr>${porLider(estado.actual, false)}</table></div>`;
  },
  restricciones(c) {
    const ab = estado.rests.filter(r => r.estado !== 'levantada').sort((a, b) => (a.f_requerida || '9').localeCompare(b.f_requerida || '9'));
    const rr = resumenRestricciones(estado.rests);
    c.innerHTML = `<div class="kpis">${kpi('Abiertas', rr.abiertas)}${kpi('Vencidas', rr.vencidas, { color: rr.vencidas ? '#E15759' : '#59A14F' })}${kpi('Levantadas a tiempo', pct(rr.pctATiempo))}</div>
      <div class="tarjeta"><h2>Restricciones abiertas</h2>${ab.length ? `<table class="simple"><tr><th>Restricción</th><th>Proyecto</th><th>Responsable</th><th>F. requerida</th><th>Estado</th></tr>
      ${ab.map(r => `<tr${r.f_requerida && r.f_requerida < hoy() ? ' style="background:#FCE9EA"' : ''}><td>${esc(r.descripcion)}</td><td>${esc(proyecto(r.proyecto_id)?.nombre_corto || '')}</td>
        <td>${esc(r.responsable || nombre(r.responsable_id))}</td><td>${fmtFecha(r.f_requerida)}</td><td>${badge(textoEstado('estados_restriccion', r.estado), colorEstado('estados_restriccion', r.estado))}</td></tr>`).join('')}</table>`
      : '<p class="nota">No hay restricciones abiertas.</p>'}<p><a href="#/restricciones">Ir al log de restricciones ›</a></p></div>`;
  },
  compromisos(c) {
    const de = estado.acts.filter(a => a.semana === estado.siguiente);
    c.innerHTML = `<div class="aviso">Confirme qué actividades <b>SE HARÁN</b> la ${esc(etiquetaSemana(estado.siguiente))}. Comprométalas desde el Look Ahead (solo las que estén listas o con advertencia de restricción).</div>
      <div class="tarjeta"><table class="simple"><tr><th>Líder</th><th class="num">Comprometidas</th><th class="num">Listas sin comprometer</th><th class="num">Con restricción</th><th class="num">HH comprometidas</th><th>Carga</th></tr>
      ${estado.equipo.map(l => {
        const m = de.filter(a => a.responsable_id === l.id);
        const comp = m.filter(a => a.comprometida);
        const hh = comp.reduce((s, a) => s + (Number(a.hh_total) || 0), 0);
        const cap = capacidadSemana(l.id, estado.siguiente, estado.ubic);
        const ratio = cap ? hh / cap : null;
        return `<tr><td>${esc(l.nombre)}</td><td class="num">${comp.length}</td><td class="num">${m.filter(a => !a.comprometida && a.estado_la === 'lista').length}</td>
          <td class="num">${m.filter(a => !a.comprometida && a.estado_la === 'con_restriccion').length}</td><td class="num">${num(hh)} / ${num(cap)}</td>
          <td style="min-width:120px"><div class="barra-prog" style="--bc:${colorCarga(ratio)}"><i style="width:${Math.min(100, (ratio || 0) * 100)}%"></i></div></td></tr>`;
      }).join('')}</table><p><a class="btn btn-azul" href="#/lookahead">Abrir el Look Ahead para comprometer ›</a></p></div>`;
  },
  lookahead(c) {
    const semanas = semanasLookAhead();
    c.innerHTML = `<div class="tarjeta"><h2>Actividades del Look Ahead</h2><table class="simple"><tr><th>Líder</th>${semanas.map(s => `<th class="num">${esc(etiquetaSemana(s).split('·')[0])}</th>`).join('')}</tr>
      ${estado.equipo.map(l => `<tr><td>${esc(l.nombre)}</td>${semanas.map(s => {
        const m = estado.acts.filter(a => a.semana === s && a.responsable_id === l.id && a.estado_la !== 'cancelada');
        const listas = m.filter(a => a.estado_la === 'lista' || a.comprometida).length;
        return `<td class="num">${m.length} act. · ${listas} listas · ${num(m.reduce((x, a) => x + (Number(a.hh_total) || 0), 0))} HH</td>`;
      }).join('')}</tr>`).join('')}</table></div>`;
  },
  acuerdos(c) {
    c.innerHTML = '<div class="aviso">Registre acciones de mejora a partir de las causas de no cumplimiento. Cada responsable puede actualizar el estado de sus acuerdos.</div><div data-g></div>';
    grillaAcuerdos = crearGrilla(c.querySelector('[data-g]'), {
      id: 'acuerdos', tabla: 'acuerdos', titulo: 'Acuerdos', altura: '420px', puedeCrear: esGestor(),
      columnas: [
        { field: 'cnc_id', title: 'Causa (CNC)', tipo: 'lista', ancho: 230, opciones: () => opciones('cnc') },
        { field: 'accion', title: 'Acción de mejora', tipo: 'texto', ancho: 340 },
        { field: 'responsable_id', title: 'Responsable', tipo: 'lista', ancho: 150, opciones: opcionesLideres },
        { field: 'fecha', title: 'Fecha', tipo: 'fecha', ancho: 105 },
        { field: 'estado', title: 'Estado', tipo: 'lista', ancho: 120, opciones: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'en_proceso', label: 'En proceso' }, { value: 'cumplido', label: 'Cumplido' }, { value: 'cancelado', label: 'Cancelado' }] },
      ],
      puedeEditarFila: a => esGestor() || a.responsable_id === store.usuario.id,
      nuevaFila: () => ({ area_id: store.area.id, reunion_id: estado.reunion?.id || null, estado: 'pendiente', accion: '' }),
      listaParaCrear: a => !!(a.accion && a.accion.trim()),
      camposCalc: ['created_at', 'updated_at', 'created_by'],
    });
    grillaAcuerdos.inicializar(estado.acuerdos);
  },
};

async function guardar() {
  try {
    const datos = { area_id: store.area.id, fecha: hoy(), semana: estado.actual, asistentes: [...estado.asistentes],
      notas: `Duración por paso (min): ${Object.entries(estado.tiempos).map(([k, s]) => `${k} ${Math.round(s / 60)}`).join(', ')}` };
    if (estado.reunion) estado.reunion = await api.update('reuniones', estado.reunion.id, datos);
    else [estado.reunion] = await api.insert('reuniones', datos);
    ok('Reunión guardada.');
  } catch (e) { error(mensajeError(e)); }
}

async function acta() {
  const prev = resumenPAC(estado.acts.filter(a => a.semana === estado.anterior));
  const acuerdos = await api.list('acuerdos', { eq: { area_id: store.area.id }, in: { estado: ['pendiente', 'en_proceso'] } });
  imprimirPDF('Acta de reunión semanal', `<p>Fecha: <b>${fmtFecha(hoy())}</b> · Asistentes: ${esc([...estado.asistentes].map(nombre).join(', '))}</p>` +
    kpisPDF([['PAC semana anterior', pct(prev.pac), colorPAC(prev.pac)], ['Completados', prev.completadas], ['No completados', prev.noCompletadas]]) +
    '<h2>Causas de no cumplimiento</h2>' + tablaPDF([{ titulo: 'Causa', valor: p => etiqueta(p.cnc_id) || 'Sin causa' }, { titulo: 'Cantidad', valor: p => p.cantidad, num: true }, { titulo: '%', valor: p => pct(p.pct), num: true }],
      paretoCNC(estado.acts.filter(a => a.semana === estado.anterior))) +
    '<h2>Acuerdos de mejora vigentes</h2>' + tablaPDF([{ titulo: 'Acción', valor: a => a.accion }, { titulo: 'Causa', valor: a => etiqueta(a.cnc_id) },
      { titulo: 'Responsable', valor: a => nombre(a.responsable_id) }, { titulo: 'Fecha', valor: a => fmtFecha(a.fecha) }, { titulo: 'Estado', valor: a => a.estado }], acuerdos),
  { proyectoTexto: 'Todos los proyectos' });
}
