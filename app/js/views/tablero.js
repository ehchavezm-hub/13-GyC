// Tablero (6.11 y sección 10): PAC, tendencia, Pareto de CNC, PAC por líder y gerencia, carga, restricciones,
// precisión de estimación, PAC ponderado y reconocimientos del mes (M-14).
import { medir } from '../core/monitoreo.js';
import { api } from '../data/api.js';
import { store, on, esStaff, lideres, equipo, visibleParaConsulta, nombre, etiqueta, param, proyecto, valoresLista, enProyectoSel, haySeleccion, nombreSeleccion } from '../core/store.js';
import { lunes, sumarSemanas, numeroSemana, esc, html, pct, num, agrupar, sumarDias, etiquetaSemana, libGraficos } from '../core/util.js';
import { kpi } from '../ui/ui.js';
import { resumenPAC, resumenHistorico, colorPAC, paretoCNC, resumenRestricciones, capacidadSemana, colorCarga, semanasPendiente } from '../services/indicadores.js';
import { imprimirPDF, tablaPDF, kpisPDF, tablaDePantalla } from '../services/pdf.js';

const COLORES = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#BAB0AC', '#E8762B'];
let graficos = [], desuscribir = [], estado;

export async function render(el) {
  estado = { semanas: Number(localStorage.getItem('lpsgt-tablero-semanas') || 12), gerencia: '', lider: '' };
  const pag = html(`<div>
    <div class="pagina-cab"><h1>Tablero</h1>
      <select class="sel" data-sem>${
        [[1,'Última semana'],[2,'Últimas 2 semanas'],[3,'Últimas 3 semanas'],[4,'Últimas 4 semanas'],
         [8,'Últimas 8 semanas'],[12,'Últimas 12 semanas'],[26,'Últimas 26 semanas'],
         [52,'1 año'],[104,'2 años'],[156,'3 años'],[260,'5 años'],[520,'10 años']]
        .map(([v,t]) => `<option value="${v}">${t}</option>`).join('')
      }<option value="0">Personalizado…</option></select>
      <select class="sel" data-ger><option value="">Todas las gerencias</option>${valoresLista('gerencias').map(v => `<option value="${v.id}">${esc(v.codigo || v.valor)}</option>`).join('')}</select>
      ${esStaff() ? `<select class="sel" data-lid><option value="">Todo el equipo</option>${lideres().map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select>` : ''}
      <span data-proy></span><span class="flex"></span>
      <button class="btn btn-sm" data-a="resumen">📝 Resumen semanal</button>
      <button class="btn btn-sm" data-a="pdf">🖨 PDF</button></div>
    <div data-cuerpo><div class="cargando"><span class="spinner"></span> Calculando indicadores…</div></div></div>`);
  el.append(pag);
  const selSem = pag.querySelector('[data-sem]');
  selSem.value = String(estado.semanas);
  if (selSem.value !== String(estado.semanas)) {
    // Valor guardado es personalizado (no está en la lista estándar) — agregar opción temporal
    const optP = document.createElement('option');
    optP.value = String(estado.semanas); optP.setAttribute('data-custom', '1');
    optP.textContent = `${estado.semanas === 1 ? 'Última semana' : `Últimas ${estado.semanas} semanas`} (custom)`;
    selSem.insertBefore(optP, selSem.lastElementChild);
    selSem.value = String(estado.semanas);
  }
  selSem.onchange = async e => {
    if (e.target.value === '0') {
      const { pedirDatos } = await import('../ui/ui.js');
      const r = await pedirDatos({
        titulo: 'Período personalizado',
        campos: [{ name: 'semanas', label: 'Número de semanas', type: 'number', min: 1, max: 520, required: true, value: estado.semanas }],
        texto: 'Aplicar',
        ancho: 360,
      });
      if (!r) { selSem.value = String(estado.semanas); return; } // canceló
      estado.semanas = Math.max(1, Math.min(520, Number(r.semanas) || 4));
      // Agregar opción temporal con el valor personalizado
      let optPersonal = selSem.querySelector('option[data-custom]');
      if (!optPersonal) { optPersonal = document.createElement('option'); optPersonal.setAttribute('data-custom', '1'); selSem.insertBefore(optPersonal, selSem.lastElementChild); }
      optPersonal.value = String(estado.semanas);
      optPersonal.textContent = `${estado.semanas === 1 ? 'Última semana' : `Últimas ${estado.semanas} semanas`} (custom)`;
      selSem.value = String(estado.semanas);
    } else {
      // Quitar opción custom anterior si el usuario volvió a una estándar
      selSem.querySelector('option[data-custom]')?.remove();
      estado.semanas = Number(e.target.value);
    }
    localStorage.setItem('lpsgt-tablero-semanas', String(estado.semanas));
    cargar();
  };
  pag.querySelector('[data-ger]').onchange = e => { estado.gerencia = e.target.value; pintar(); };
  pag.querySelector('[data-lid]')?.addEventListener('change', e => { estado.lider = e.target.value; pintar(); });
  pag.querySelector('[data-a="pdf"]').onclick = pdf;
  pag.querySelector('[data-a="resumen"]').onclick = () => import('../services/resumen.js').then(m => m.mostrarResumen(sumarSemanas(lunes(), -1)));
  desuscribir.push(on('proyecto', () => pintar()));
  let t;
  desuscribir.push(api.subscribe(['actividades', 'cierres', 'restricciones'], () => { clearTimeout(t); t = setTimeout(cargar, 1500); }));
  await Promise.all([cargar(), libGraficos()]);
  pintar();
}

export function destruir() { graficos.forEach(g => g.destroy()); graficos = []; desuscribir.forEach(f => f && f()); desuscribir = []; }

async function cargar() { return medir('tablero.indicadores', cargarDatos); }

async function cargarDatos() {
  const desde = sumarSemanas(lunes(), -estado.semanas);
  const area = store.area.id;
  const [acts, hist, rests, cartera, ubic, cierres] = await Promise.all([
    api.list('actividades', { eq: { area_id: area }, gte: { semana: sumarSemanas(desde, -5) }, lte: { semana: lunes() } }),
    api.list('pac_historico', { eq: { area_id: area }, gte: { semana: desde } }),
    esStaff() ? api.list('restricciones', { eq: { area_id: area } }) : Promise.resolve([]),
    esStaff() ? api.list('cartera', { eq: { area_id: area } }) : Promise.resolve([]),
    esStaff() ? api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: lunes() }, lte: { fecha: sumarDias(lunes(), 6) } }) : Promise.resolve([]),
    api.list('cierres', { eq: { area_id: area }, gte: { semana: desde } }),
  ]);
  Object.assign(estado, { desde, acts, hist, rests, cartera, ubic, cierres });
  pintar();
}

function filtrarActs(acts) {
  return acts.filter(a => visibleParaConsulta(a.proyecto_id) && (!estado.gerencia || a.gerencia_id === estado.gerencia || proyecto(a.proyecto_id)?.gerencia_id === estado.gerencia)
    && (!estado.lider || a.responsable_id === estado.lider) && enProyectoSel(a.proyecto_id));
}

function serieSemanal(acts, hist) {
  const semanas = Array.from({ length: estado.semanas }, (_, i) => sumarSemanas(estado.desde, i));
  return semanas.map(s => {
    const de = acts.filter(a => a.semana === s);
    let r = resumenPAC(de);
    if (!r.comprometidas) {
      const h = hist.filter(x => x.semana === s && (!estado.lider || x.responsable_id === estado.lider));
      if (h.length && !estado.gerencia && !haySeleccion() && esStaff()) r = { ...resumenHistorico(h), comprometidas: 0 };
    }
    return { semana: s, ...r };
  });
}

function pintar() {
  if (!window.Chart || !estado.acts) return;   // se pinta cuando llegan los datos y la librería de gráficos
  graficos.forEach(g => g.destroy()); graficos = [];
  const cont = document.querySelector('#contenido [data-cuerpo]');
  if (!cont) return;
  document.querySelector('#contenido [data-proy]').innerHTML = haySeleccion() ? `<span class="chip-filtro">🏗 ${esc(nombreSeleccion())}</span>` : '';
  const actsTodas = filtrarActs(estado.acts);
  const acts = actsTodas.filter(a => a.semana >= estado.desde && a.semana < lunes());
  const r = resumenPAC(acts);
  const serie = serieSemanal(actsTodas, estado.hist);
  const conDato = serie.filter(s => s.pac != null);
  const pacPeriodo = (() => {
    const c = serie.reduce((x, s) => x + (s.completadas || 0), 0), n = serie.reduce((x, s) => x + (s.noCompletadas || 0), 0);
    return c + n ? c / (c + n) : null;
  })();
  const ultima = [...conDato].reverse().find(s => s.semana < lunes());
  const rr = resumenRestricciones(estado.rests.filter(x => enProyectoSel(x.proyecto_id)));
  const carteraAb = estado.cartera.filter(c => ['abierta', 'en_proceso', 'nueva'].includes(c.estado) && (!estado.lider || c.responsable_id === estado.lider));
  const arrastres = actsTodas.filter(a => a.semana === lunes() && semanasPendiente(a) >= Number(param('arrastre_alerta') || 2));
  const meta = Number(param('meta_pac'));

  cont.innerHTML = `
    <div class="kpis">
      ${kpi('PAC del periodo', pct(pacPeriodo), { color: colorPAC(pacPeriodo), sub: `Meta ${pct(meta)} · ${conDato.length} semanas con datos` })}
      ${kpi('PAC última semana', pct(ultima?.pac), { color: colorPAC(ultima?.pac), sub: ultima ? etiquetaSemana(ultima.semana).split('·')[0] : '' })}
      ${kpi('PAC ponderado HH', pct(r.pacPonderado), { color: colorPAC(r.pacPonderado), sub: 'M-09' })}
      ${kpi('% no programadas', pct(r.pctNoProgramadas), { color: '#F28E2B', sub: 'Imprevistos' })}
      ${kpi('Precisión de estimación', r.precision == null ? '—' : num(r.precision, 2), { color: r.precision == null ? '' : Math.abs(r.precision - 1) <= 0.15 ? '#59A14F' : '#EDC948', sub: 'HH reales ÷ planificadas (ideal 1,0)' })}
      ${esStaff() ? kpi('Restricciones', `${rr.abiertas}`, { color: rr.vencidas ? '#E15759' : '#59A14F', sub: `${rr.vencidas} vencidas · ${pct(rr.pctATiempo)} a tiempo` }) : ''}
      ${esStaff() ? kpi('Cartera abierta', carteraAb.length, { sub: `${carteraAb.filter(c => c.estado === 'nueva').length} solicitudes nuevas` }) : ''}
      ${esStaff() ? kpi('Arrastres', arrastres.length, { color: arrastres.length ? '#E15759' : '#59A14F', sub: `${param('arrastre_alerta') || 2}+ semanas pendientes` }) : ''}
    </div>
    <div data-reconoc></div>
    <div class="grid-2">
      <div class="tarjeta"><h2>PAC por semana</h2><div style="height:280px"><canvas data-g="pac"></canvas></div></div>
      <div class="tarjeta"><h2>Causas de no cumplimiento (Pareto)</h2><div style="height:280px"><canvas data-g="pareto"></canvas></div></div>
    </div>
    <div class="grid-2" style="margin-top:14px">
      <div class="tarjeta"><h2>PAC por líder</h2><div data-lideres></div></div>
      <div class="tarjeta"><h2>PAC por gerencia</h2><div style="height:300px"><canvas data-g="ger"></canvas></div></div>
    </div>
    ${esStaff() ? `<div class="grid-2" style="margin-top:14px">
      <div class="tarjeta"><h2>Carga vs capacidad — semana actual</h2><div data-carga></div></div>
      <div class="tarjeta"><h2>Restricciones por tipo</h2><div data-rtipo></div></div></div>` : ''}`;

  // PAC por semana
  const etq = serie.map(s => `S-${numeroSemana(s.semana).semana}`);
  const pacs = serie.map(s => s.pac == null ? null : Math.round(s.pac * 100));
  const tend = pacs.map((_, i) => {
    const v = pacs.slice(Math.max(0, i - 3), i + 1).filter(x => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  });
  graficos.push(new window.Chart(cont.querySelector('[data-g="pac"]'), {
    data: {
      labels: etq,
      datasets: [
        { type: 'bar', label: 'PAC %', data: pacs, backgroundColor: serie.map(s => colorPAC(s.pac)), borderRadius: 4 },
        { type: 'line', label: 'Tendencia (4 sem.)', data: tend, borderColor: '#1A365D', borderDash: [5, 4], pointRadius: 0, tension: .3 },
        { type: 'line', label: `Meta ${Math.round(meta * 100)} %`, data: etq.map(() => Math.round(meta * 100)), borderColor: '#E8762B', pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: opcionesGrafico({ y: { min: 0, max: 100, ticks: { callback: v => v + ' %' } } }),
  }));

  // Pareto
  const pareto = paretoCNC(acts).slice(0, 10);
  graficos.push(new window.Chart(cont.querySelector('[data-g="pareto"]'), {
    data: {
      labels: pareto.map(p => recortar(etiqueta(p.cnc_id) || 'Sin causa', 28)),
      datasets: [
        { type: 'bar', label: 'Cantidad', data: pareto.map(p => p.cantidad), backgroundColor: '#4E79A7', borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: '% acumulado', data: pareto.map(p => Math.round(p.acumulado * 100)), borderColor: '#E15759', yAxisID: 'y2', tension: .2 },
      ],
    },
    options: opcionesGrafico({ y: { beginAtZero: true, ticks: { precision: 0 } }, y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: v => v + ' %' } } }),
  }));

  // Por líder
  const filasL = lideres().filter(l => !estado.lider || l.id === estado.lider).map(l => {
    const de = acts.filter(a => a.responsable_id === l.id);
    const rl = resumenPAC(de);
    const ult = resumenPAC(de.filter(a => a.semana === sumarSemanas(lunes(), -1)));
    return { l, rl, ult };
  }).filter(x => x.rl.total);
  cont.querySelector('[data-lideres]').innerHTML = filasL.length ? `<table class="simple"><tr><th>Líder</th><th>PAC periodo</th><th class="num">Últ. semana</th><th class="num">HH plan</th><th class="num">Precisión</th></tr>
    ${filasL.map(({ l, rl, ult }) => `<tr><td>${esc(l.nombre)}</td><td><div style="display:flex;gap:6px;align-items:center"><div class="barra-prog" style="flex:1;--bc:${colorPAC(rl.pac)}"><i style="width:${(rl.pac || 0) * 100}%"></i></div><b>${pct(rl.pac)}</b></div></td>
      <td class="num" style="color:${colorPAC(ult.pac)}">${pct(ult.pac)}</td><td class="num">${num(rl.hhPlan)}</td><td class="num">${rl.precision == null ? '—' : num(rl.precision, 2)}</td></tr>`).join('')}</table>`
    : '<p class="nota">Sin datos en el periodo.</p>';

  // Por gerencia
  const porGer = [...agrupar(acts, a => a.gerencia_id || proyecto(a.proyecto_id)?.gerencia_id || '').entries()]
    .map(([g, arr]) => ({ g, r: resumenPAC(arr) })).filter(x => x.r.pac != null).sort((a, b) => b.r.pac - a.r.pac);
  graficos.push(new window.Chart(cont.querySelector('[data-g="ger"]'), {
    type: 'bar',
    data: { labels: porGer.map(x => store.valores.get(x.g)?.codigo || etiqueta(x.g) || 'Sin gerencia'),
      datasets: [{ label: 'PAC %', data: porGer.map(x => Math.round(x.r.pac * 100)), backgroundColor: porGer.map(x => colorPAC(x.r.pac)), borderRadius: 4 }] },
    options: { ...opcionesGrafico({ x: { min: 0, max: 100, ticks: { callback: v => v + ' %' } } }), indexAxis: 'y' },
  }));

  if (esStaff()) {
    const semana = lunes();
    cont.querySelector('[data-carga]').innerHTML = `<table class="simple"><tr><th>Líder</th><th>Carga</th><th class="num">HH</th><th class="num">Capacidad</th></tr>
      ${equipo(estado.acts.filter(a => a.semana === semana)).map(l => {
        const hh = estado.acts.filter(a => a.responsable_id === l.id && a.semana === semana && a.comprometida).reduce((s, a) => s + (Number(a.hh_total) || 0), 0);
        const cap = capacidadSemana(l.id, semana, estado.ubic);
        const ratio = cap ? hh / cap : null;
        return `<tr><td>${esc(l.nombre)}</td><td><div class="barra-prog" style="--bc:${colorCarga(ratio)}"><i style="width:${Math.min(100, (ratio || 0) * 100)}%"></i></div></td>
          <td class="num">${num(hh)}</td><td class="num">${num(cap)}</td></tr>`;
      }).join('')}</table>`;
    const porTipo = [...agrupar(estado.rests, x => etiqueta(x.tipo_id) || 'Sin tipo').entries()].map(([t, arr]) => ({ t, x: resumenRestricciones(arr) }));
    cont.querySelector('[data-rtipo]').innerHTML = `<table class="simple"><tr><th>Tipo</th><th class="num">Abiertas</th><th class="num">Vencidas</th><th class="num">A tiempo</th><th class="num">Atraso prom.</th></tr>
      ${porTipo.map(({ t, x }) => `<tr><td>${esc(t)}</td><td class="num">${x.abiertas}</td><td class="num">${x.vencidas}</td><td class="num">${pct(x.pctATiempo)}</td><td class="num">${x.diasAtraso == null ? '—' : num(x.diasAtraso, 1) + ' d'}</td></tr>`).join('')}</table>`;
  }
  pintarReconocimientos(cont.querySelector('[data-reconoc]'), filtrarActs(estado.acts));
}

/** M-14: mejor PAC y mayor mejora de las últimas 4 semanas frente a las 4 anteriores. */
function pintarReconocimientos(el, acts) {
  const cfg = param('reconocimientos') || {};
  if (!el || (!cfg.mejor_pac && !cfg.mayor_mejora)) return;
  const fin = lunes();
  const ini = sumarSemanas(fin, -4), prev = sumarSemanas(fin, -8);
  const datos = lideres().map(l => {
    const actual = resumenPAC(acts.filter(a => a.responsable_id === l.id && a.semana >= ini && a.semana < fin));
    const antes = resumenPAC(acts.filter(a => a.responsable_id === l.id && a.semana >= prev && a.semana < ini));
    return { l, actual: actual.pac, comp: actual.completadas + actual.noCompletadas, mejora: actual.pac != null && antes.pac != null ? actual.pac - antes.pac : null };
  }).filter(d => d.actual != null && d.comp >= 5);
  if (!datos.length) { el.innerHTML = ''; return; }
  const mejor = [...datos].sort((a, b) => b.actual - a.actual)[0];
  const mejora = [...datos].filter(d => d.mejora != null && d.mejora > 0).sort((a, b) => b.mejora - a.mejora)[0];
  el.innerHTML = `<div class="tarjeta" style="margin-bottom:14px;display:flex;gap:24px;flex-wrap:wrap;align-items:center;border-left:4px solid var(--naranja)">
    <b style="font-family:var(--fuente-titulos);font-size:16px;color:var(--azul-ejec)">🏆 Reconocimientos (últimas 4 semanas)</b>
    ${cfg.mejor_pac ? `<span>Mejor PAC: <b>${esc(mejor.l.nombre)}</b> (${pct(mejor.actual)})</span>` : ''}
    ${cfg.mayor_mejora && mejora ? `<span>Mayor mejora: <b>${esc(mejora.l.nombre)}</b> (+${Math.round(mejora.mejora * 100)} puntos)</span>` : ''}</div>`;
}

function opcionesGrafico(escalas) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { position: 'bottom', labels: { font: { family: 'Manrope' }, boxWidth: 12 } } },
    scales: escalas,
  };
}
const recortar = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

function pdf() {
  const cont = document.querySelector('#contenido [data-cuerpo]');
  const imgs = [...cont.querySelectorAll('canvas')].map(c => `<img src="${c.toDataURL('image/png')}" style="width:100%;margin-bottom:4mm">`);
  const kpis = [...cont.querySelectorAll('.kpi')].map(k => [k.querySelector('.kpi-tit').textContent.trim(), k.querySelector('.kpi-val').textContent.trim(),
    getComputedStyle(k).getPropertyValue('--kc').trim() || '#4E79A7']);
  imprimirPDF('Tablero de indicadores', kpisPDF(kpis) +
    `<h2>PAC por semana</h2>${imgs[0] || ''}<h2>Causas de no cumplimiento</h2>${imgs[1] || ''}` +
    `<h2>PAC por líder</h2>${tablaDePantalla(cont.querySelector('[data-lideres] table')) || '<p class="nota">Sin datos en el periodo.</p>'}<h2>PAC por gerencia</h2>${imgs[2] || ''}`);   // anchos fijos, como las demás tablas
}
