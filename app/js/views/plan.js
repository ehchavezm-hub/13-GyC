// Plan semanal (6.9): compromisos de la semana, avance, cierre con CNC y HH reales, PAC.
import { medir } from '../core/monitoreo.js';
import { api, mensajeError } from '../data/api.js';
import { store, on, esGestor, esAdmin, puede, puedeEditarActividad, lideres, nombre, proyecto, horasDia, enProyectoSel, esContenedor, haySeleccion, nombreSeleccion } from '../core/store.js';
import { lunes, sumarSemanas, etiquetaSemana, esc, html, hoy, pct, num, sumarDias, fmtFecha, DIAS } from '../core/util.js';
import { actualizarQuery } from '../core/router.js';
import { crearGrilla } from '../ui/grid.js';
import { kpi, toast, ok, error, confirmar, modal, pedirDatos } from '../ui/ui.js';
import { bloqueoCrear, aplicarVistaGrupos, avisoSinGrupo } from '../services/grupos-lps.js';
import { columnasActividad, derivarActividad, CAMPOS_CALC_ACT } from '../services/columnas.js';
import { resumenPAC, colorPAC, capacidadSemana, colorCarga, restriccionesActivas } from '../services/indicadores.js';
import { abrirDetalle, abrirRestricciones, confirmarRestricciones } from './detalle.js';
import { mostrarResumen } from '../services/resumen.js';
import { imprimirPDF, tablaPDF, kpisPDF } from '../services/pdf.js';
import { etiqueta, textoEstado, servicioDeProyecto, semanaEnPlanificacion, conteoColaboracion } from '../core/store.js';

let grilla, desuscribir = [], estado;

export async function render(el, { query }) {
  estado = {
    semana: lunes(query.get('semana') || hoy()),
    resp: query.get('resp') || (esGestor() ? 'todos' : store.usuario.id),
    acts: [], rests: [], cierres: [], ubic: [], colab: new Map(),
  };
  el.innerHTML = '';
  const pag = html(`<div>
    <div class="pagina-cab">
      <h1>Plan semanal</h1>
      <div class="selector-semana"><button class="btn-icono" data-a="ant" title="Semana anterior">◀</button>
        <span data-semana></span><button class="btn-icono" data-a="sig" title="Semana siguiente">▶</button></div>
      <button class="btn btn-sm" data-a="hoy">Semana actual</button>
      <select class="sel" data-resp aria-label="Responsable"></select>
      <span data-proy></span>
      <span class="flex"></span>
      <button class="btn btn-sm" data-a="resumen" title="Texto listo para Teams o correo">📝 Resumen</button>
      <button class="btn btn-sm" data-a="pdf">🖨 PDF</button>
    </div>
    <div data-aviso></div>
    <div class="kpis" data-kpis></div>
    <div class="barra" style="margin-bottom:10px" data-acciones></div>
    <div data-grilla></div>
  </div>`);
  el.append(pag);
  const selResp = pag.querySelector('[data-resp]');
  selResp.innerHTML = `<option value="todos">Todo el equipo</option>` +
    lideres().map(l => `<option value="${l.id}">${l.id === store.usuario.id ? 'Mi plan — ' : ''}${esc(l.nombre)}</option>`).join('');
  selResp.value = estado.resp;
  selResp.addEventListener('change', () => { estado.resp = selResp.value; actualizarQuery({ resp: estado.resp }); pintar(); });

  pag.querySelector('.pagina-cab').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'ant') cambiarSemana(sumarSemanas(estado.semana, -1));
    if (a === 'sig') cambiarSemana(sumarSemanas(estado.semana, 1));
    if (a === 'hoy') cambiarSemana(lunes());
    if (a === 'resumen') mostrarResumen(estado.semana);
    if (a === 'pdf') pdf();
  });
  pag.querySelector('[data-acciones]').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) acciones[a]?.();
  });

  grilla = crearGrilla(pag.querySelector('[data-grilla]'), {
    id: 'plan', tabla: 'actividades', titulo: 'Plan semanal',
    columnas: columnasActividad({
      conGrupo: true,   // visible solo en la vista consolidada (varios Grupos LPS); ver grupos-lps.js
      modo: 'plan', semana: estado.semana, extras: {
        restricciones: { get: id => restriccionesActivas(id, estado.rests).length },
        colaboracion: estado.colab,
        abrirRestricciones: a => abrirRestricciones(a, { alCambiar: recargarRestricciones }),
        abrirDetalle: a => abrirDetalle('actividad', a, { alCambiar: n => { estado.colab.set(a.id, n); grilla.refrescar(); } }),
      },
    }),
    camposCalc: CAMPOS_CALC_ACT,
    bloqueoCrear,   // sin un Grupo LPS elegido no se crean filas
    alFiltrar: () => pintarKPIs(),   // indicadores de la persona filtrada en «Resp. 1»
    alAplicarVista: () => aplicarVistaGrupos(grilla, { forzar: true }),
    agrupar: [{ field: 'responsable_id', label: 'Responsable' }, { field: 'proyecto_id', label: 'Grupo LPS' },
      { field: 'gerencia_id', label: 'Gerencia' }, { field: 'estado', label: 'Estado' }, { field: 'servicio_id', label: 'Servicio' }],
    puedeEditarFila: a => puedeEditarActividad(a) && !cerrada(a.responsable_id),
    nuevaFila,
    campoInicial: 'descripcion',
    listaParaCrear: a => !!(a.descripcion && a.descripcion.trim()),
    crear: async datos => api.insert('actividades', { ...datos, descripcion: datos.descripcion || '' }),
    derivar: derivarActividad,
    alDuplicar: () => ({ estado: 'programado', cnc_id: null, hh_real: null, origen: 'manual' }),
    claseFila: a => {
      if (a.estado === 'no_completado' && !a.cnc_id) return 'fila-alerta';
      if (restriccionesActivas(a.id, estado.rests).length) return 'fila-aviso';
      return '';
    },
    alGuardar: () => { cargarSilencioso(); },
    menuFila: a => [
      { label: '🚧 Restricciones…', action: () => a.id && abrirRestricciones(a, { alCambiar: recargarRestricciones }) },
      { label: '💬 Comentarios y enlaces…', action: () => a.id && abrirDetalle('actividad', a) },
      { label: '➡ Mover a la semana siguiente', action: () => moverSemana(a) },
    ],
  });

  desuscribir.push(api.subscribe(['actividades', 'restricciones', 'cierres'], ev => {
    if (ev.tabla === 'actividades') {
      grilla.aplicarRemoto(ev, f => filtroFila(f));
      const f = ev.fila || ev.anterior;
      if (f && f.semana === estado.semana) {
        const i = estado.acts.findIndex(x => x.id === f.id);
        if (ev.tipo === 'DELETE') { if (i >= 0) estado.acts.splice(i, 1); }
        else if (i >= 0) estado.acts[i] = ev.fila; else estado.acts.push(ev.fila);
        pintarKPIs();
      }
    } else cargarSilencioso();
  }));
  desuscribir.push(on('proyecto', () => pintar()));
  await cargar();
}

export function destruir() {
  desuscribir.forEach(f => f && f());
  desuscribir = [];
  grilla?.destruir();
}

function cambiarSemana(s) {
  s = lunes(s);   // la semana siempre empieza el lunes: la columna L es ese lunes
  estado.semana = s;
  actualizarQuery({ semana: s });
  grilla.destruir();
  render(document.getElementById('contenido'), { query: new URLSearchParams(location.hash.split('?')[1] || '') });
}

function cerrada(resp) { return estado.cierres.some(c => c.responsable_id === resp && c.cerrada); }
function filtroFila(a) {
  if (a.semana !== estado.semana || !a.comprometida) return false;
  if (estado.resp !== 'todos' && a.responsable_id !== estado.resp) return false;
  if (!enProyectoSel(a.proyecto_id)) return false;
  return true;
}
function respNuevo() { return estado.resp !== 'todos' ? estado.resp : store.usuario.id; }

function nuevaFila() {
  const p = store.proyectoSel ? proyecto(store.proyectoSel) : null;
  // Programada mientras la semana se esté planificando (con Look Ahead de la misma semana: hasta el día de registro)
  const empezo = !semanaEnPlanificacion(estado.semana);
  return {
    area_id: store.area.id, semana: estado.semana, responsable_id: respNuevo(), comprometida: true,
    tipo: empezo ? 'no_programada' : 'programada', estado: 'programado', estado_la: 'trasladada', origen: 'manual',
    proyecto_id: p?.id || null, gerencia_id: p?.gerencia_id || null, servicio_id: servicioDeProyecto(p),
    hh_lu: 0, hh_ma: 0, hh_mi: 0, hh_ju: 0, hh_vi: 0, hh_sa: 0, hh_do: 0, hh_total: 0, extra: {},
  };
}

async function cargar() { return medir('plan.cargar', cargarDatos); }

async function cargarDatos() {
  const area = store.area.id;
  const [acts, rests, cierres, ubic, colab] = await Promise.all([
    api.list('actividades', { eq: { area_id: area, semana: estado.semana }, order: [['orden', true], ['created_at', true]] }),
    api.list('restricciones', { eq: { area_id: area }, neq: { estado: 'levantada' } }),
    api.list('cierres', { eq: { area_id: area, semana: estado.semana } }),
    api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: estado.semana }, lte: { fecha: sumarDias(estado.semana, 6) } }),
    conteoColaboracion(),
  ]);
  Object.assign(estado, { acts, rests, cierres, ubic });
  estado.colab.clear();
  for (const [id, n] of colab) estado.colab.set(id, n);
  await grilla.inicializar(acts.filter(filtroFila));
  aplicarVistaGrupos(grilla, { forzar: true });
  pintarCabecera();
  pintarKPIs();
}

async function cargarSilencioso() {
  const area = store.area.id;
  try {
    const [acts, rests, cierres] = await Promise.all([
      api.list('actividades', { eq: { area_id: area, semana: estado.semana } }),
      api.list('restricciones', { eq: { area_id: area }, neq: { estado: 'levantada' } }),
      api.list('cierres', { eq: { area_id: area, semana: estado.semana } }),
    ]);
    Object.assign(estado, { acts, rests, cierres });
    pintarCabecera();
    pintarKPIs();
    grilla.refrescar();
  } catch { /* se reintentará en el próximo cambio */ }
}

async function recargarRestricciones() {
  estado.rests = await api.list('restricciones', { eq: { area_id: store.area.id }, neq: { estado: 'levantada' } });
  grilla.refrescar();
}

async function pintar() {
  await grilla.setDatos(estado.acts.filter(filtroFila));
  aplicarVistaGrupos(grilla);
  pintarCabecera();
  pintarKPIs();
}

function visibles() { return estado.acts.filter(filtroFila); }

function pintarCabecera() {
  const pag = document.querySelector('#contenido');
  if (!pag) return;
  pag.querySelector('[data-semana]').textContent = etiquetaSemana(estado.semana);
  pag.querySelector('[data-proy]').innerHTML = haySeleccion()
    ? `<span class="chip-filtro">🏗 ${esc(nombreSeleccion())}<button title="Quitar filtro" data-quitar-proy>✕</button></span>` : '';
  pag.querySelector('[data-proy]').insertAdjacentHTML('beforeend',
    avisoSinGrupo(estado.acts.filter(a => a.semana === estado.semana && a.comprometida && (estado.resp === 'todos' || a.responsable_id === estado.resp))));
  pag.querySelector('[data-quitar-proy]')?.addEventListener('click', () => import('../core/store.js').then(m => m.seleccionarProyecto('')));

  const resp = estado.resp === 'todos' ? null : estado.resp;
  const yo = store.usuario.id;
  const cerradaResp = resp && cerrada(resp);
  const actual = lunes();
  const aviso = pag.querySelector('[data-aviso]');
  const pendientesLA = estado.acts.filter(a => !a.comprometida && a.semana === estado.semana && (!resp || a.responsable_id === resp) && a.estado_la !== 'cancelada');
  const cerradosEquipo = lideres().filter(l => cerrada(l.id)).length;
  aviso.innerHTML = [
    cerradaResp ? `<div class="aviso ok">🔒 La semana de ${esc(nombre(resp))} está cerrada${estado.cierres.find(c => c.responsable_id === resp)?.automatico ? ' (cierre automático)' : ''}. ${esGestor() ? 'Puede reabrirla si necesita corregir algo.' : 'Solo el administrador o delegado puede reabrirla.'}</div>` : '',
    !resp ? `<div class="aviso">Semanas cerradas: <b>${cerradosEquipo}</b> de ${lideres().length} líderes. Elija un responsable para cerrar o reabrir su semana.</div>` : '',
    pendientesLA.length ? `<div class="aviso warn">Hay ${pendientesLA.length} actividad(es) del Look Ahead de esta semana aún no comprometidas. Use "Traer del Look Ahead".</div>` : '',
    estado.semana < actual && resp && !cerradaResp ? `<div class="aviso warn">Esta semana ya pasó y aún no está cerrada. Complete estados, CNC y HH reales y ciérrela.</div>` : '',
  ].join('');

  const puedeOperar = resp && (resp === yo || puede('cerrar_semana')) ;
  const acc = pag.querySelector('[data-acciones]');
  acc.innerHTML = `
    <button class="btn btn-sm" data-a="traer" title="Comprometer las actividades listas del Look Ahead de esta semana">⬇ Traer del Look Ahead</button>
    <button class="btn btn-sm" data-a="recurrentes" title="Agregar las actividades recurrentes de su plantilla">🔁 Recurrentes</button>
    <button class="btn btn-sm" data-a="arrastrar" title="Copiar las no completadas de la semana anterior">↪ Arrastrar no completadas</button>
    <button class="btn btn-sm" data-a="completar" title="Marcar las seleccionadas o todas como completadas">✔ Marcar estados…</button>
    ${esGestor() ? '<button class="btn btn-sm" data-a="cet" title="Agregar un CET / Servicio nuevo (lo verá todo el equipo)">＋ Agregar CET / Servicio</button>' : ''}
    <span class="flex"></span>
    ${puedeOperar && !cerradaResp ? '<button class="btn btn-azul" data-a="cerrar">🔒 Cerrar semana</button>' : ''}
    ${resp && cerradaResp && esGestor() ? '<button class="btn" data-a="reabrir">🔓 Reabrir semana</button>' : ''}`;
}

function pintarKPIs() {
  const pag = document.querySelector('#contenido [data-kpis]');
  if (!pag) return;
  // Los indicadores siguen lo que muestra la grilla: también el filtro «Resp. 1» del título de la columna y el buscador
  const acts = grilla?.filasFiltradas ? grilla.filasFiltradas() : visibles();
  const r = resumenPAC(acts);
  const filtroResp = grilla?.filtroDe?.('responsable_id');
  const personas = estado.resp !== 'todos' ? [estado.resp] : filtroResp ? [].concat(filtroResp) : lideres().map(l => l.id);
  const capacidad = personas.reduce((s, id) => s + capacidadSemana(id, estado.semana, estado.ubic), 0);
  const carga = capacidad ? r.hhPlan / capacidad : null;
  pag.innerHTML = [
    kpi('PAC', pct(r.pac), { color: colorPAC(r.pac), sub: `${r.completadas} de ${r.completadas + r.noCompletadas} · meta ${pct(store.parametros.meta_pac)}` }),
    kpi('Comprometidas', r.comprometidas, { sub: `${r.pendientes} sin estado final` }),
    kpi('No completadas', r.noCompletadas, { color: r.noCompletadas ? '#E15759' : '', sub: `${r.canceladas} canceladas` }),
    kpi('No programadas', r.noProgramadas, { color: '#F28E2B', sub: r.pctNoProgramadas != null ? pct(r.pctNoProgramadas) + ' del total' : '' }),
    kpi('Carga vs capacidad', carga == null ? '—' : pct(carga), { color: colorCarga(carga), sub: `${num(r.hhPlan)} HH de ${num(capacidad)} disponibles` }),
    kpi('HH reales', r.hhReal == null ? '—' : num(r.hhReal), { sub: r.precision != null ? `Precisión ${num(r.precision, 2)} (ideal 1,0)` : 'Se registran al cierre' }),
    kpi('PAC ponderado HH', pct(r.pacPonderado), { color: colorPAC(r.pacPonderado), sub: 'M-09' }),
  ].join('');
}

// ---------- Acciones ----------
const acciones = {
  async cet() {   // pedido 100: CET / Servicio nuevo sin salir del Plan
    const id = await (await import('./proyectos.js')).nuevoCETServicio({ proyectoId: store.proyectoSel || null });
    if (id) grilla.refrescar();
  },
  async traer() {
    const resp = estado.resp === 'todos' ? null : estado.resp;
    const cands = estado.acts.filter(a => !a.comprometida && a.estado_la !== 'cancelada' &&
      (!resp || a.responsable_id === resp) && puedeEditarActividad(a) && enProyectoSel(a.proyecto_id));
    if (!cands.length) return toast('No hay actividades del Look Ahead pendientes de comprometer en esta semana.', 'info');
    const cuerpo = html(`<div><p>Seleccione las actividades que se comprometen esta semana:</p>
      <table class="simple"><tr><th></th><th>Responsable</th><th>Actividad</th><th>Estado LA</th><th class="num">HH</th></tr>
      ${cands.map(a => `<tr><td><input type="checkbox" value="${a.id}" ${['lista', 'trasladada'].includes(a.estado_la) ? 'checked' : ''}></td><td>${esc(nombre(a.responsable_id))}</td>
        <td>${esc(a.descripcion)}</td><td>${esc(textoEstado('estados_la', a.estado_la))}${restriccionesActivas(a.id, estado.rests).length ? ' 🚧' : ''}</td>
        <td class="num">${num(a.hh_total)}</td></tr>`).join('')}</table></div>`);
    modal({
      titulo: 'Traer del Look Ahead', cuerpo, ancho: 820, botones: [{ texto: 'Cancelar' }, { texto: 'Comprometer', clase: 'btn-primario', accion: async () => {
        const ids = [...cuerpo.querySelectorAll('input:checked')].map(i => i.value);
        const sel = cands.filter(a => ids.includes(a.id));
        if (!sel.length) return;
        if (!await confirmarRestricciones(sel, estado.rests)) return false;
        for (const a of sel) {
          try { await api.update('actividades', a.id, { comprometida: true, estado_la: 'trasladada', tipo: 'programada' }); }
          catch (e) { error(mensajeError(e)); }
        }
        ok(`${sel.length} actividad(es) comprometidas.`);
        await cargar();
      } }],
    });
  },

  async recurrentes() {
    const resp = respNuevo();
    const plantillas = await api.list('plantillas', { eq: { tipo: 'recurrente', propietario_id: resp, activa: true } });
    if (!plantillas.length) return toast('No hay actividades recurrentes registradas. Configúrelas en "Plantillas".', 'info');
    const items = (await Promise.all(plantillas.map(p => api.list('plantilla_items', { eq: { plantilla_id: p.id }, order: [['orden', true]] })))).flat();
    const existentes = new Set(estado.acts.filter(a => a.origen === 'recurrente').map(a => a.origen_id));
    const nuevos = items.filter(i => !existentes.has(i.id));
    if (!nuevos.length) return toast('Las actividades recurrentes ya están en esta semana.', 'info');
    if (!await confirmar(`Se agregarán ${nuevos.length} actividad(es) recurrentes a la semana de ${nombre(resp)}.`, { titulo: 'Actividades recurrentes', texto: 'Agregar' })) return;
    try {
      await api.insert('actividades', nuevos.map((i, k) => ({
        area_id: store.area.id, semana: estado.semana, responsable_id: resp, comprometida: true, tipo: 'programada', estado: 'programado',
        estado_la: 'trasladada', origen: 'recurrente', origen_id: i.id, proyecto_id: i.proyecto_id, gerencia_id: i.gerencia_id, cet_id: i.cet_id,
        servicio_id: i.servicio_id, descripcion: i.descripcion, resp2: i.resp2, orden: k,
        ...Object.fromEntries(DIAS.map(d => [`hh_${d}`, Number(i[`hh_${d}`]) || 0])),
      })));
      ok('Actividades recurrentes agregadas.');
      await cargar();
    } catch (e) { error(mensajeError(e)); }
  },

  async arrastrar() {
    const resp = estado.resp === 'todos' ? null : estado.resp;
    const anterior = sumarSemanas(estado.semana, -1);
    const prev = await api.list('actividades', { eq: { area_id: store.area.id, semana: anterior, estado: 'no_completado', comprometida: true } });
    const ya = new Set(estado.acts.filter(a => a.origen === 'arrastre').map(a => a.origen_id));
    const cands = prev.filter(a => (!resp || a.responsable_id === resp) && !ya.has(a.id) && puedeEditarActividad(a));
    if (!cands.length) return toast('No hay compromisos no completados de la semana anterior por arrastrar.', 'info');
    if (!await confirmar(`Se copiarán ${cands.length} compromiso(s) no completados de la semana anterior a esta semana.`, { titulo: 'Arrastrar no completadas', texto: 'Arrastrar' })) return;
    await arrastrarA(cands, estado.semana);
    await cargar();
  },

  async completar() {
    // Una sola celda seleccionada no cuenta como selección: se aplica a todos los pendientes
    const filasSel = [...new Set(grilla.tabla.getRanges().flatMap(r => r.getRows()))];
    const sel = filasSel.length > 1 ? filasSel.map(r => r.getData()).filter(a => a.id && puedeEditarActividad(a) && !cerrada(a.responsable_id)) : [];
    const objetivo = sel.length ? sel : visibles().filter(a => puedeEditarActividad(a) && !cerrada(a.responsable_id) && a.estado === 'programado');
    if (!objetivo.length) return toast('No hay compromisos editables para actualizar.', 'info');
    const d = await pedirDatos({
      titulo: `Marcar estado de ${objetivo.length} compromiso(s)`, texto: 'Aplicar',
      antes: sel.length ? 'Se aplicará a las filas seleccionadas.' : 'No hay filas seleccionadas: se aplicará a todos los compromisos sin estado final.',
      campos: [
        { name: 'estado', label: 'Estado', type: 'select', required: true,
          options: [{ value: 'completado', label: textoEstado('estados_compromiso', 'completado') }, { value: 'no_completado', label: textoEstado('estados_compromiso', 'no_completado') }, { value: 'cancelado', label: textoEstado('estados_compromiso', 'cancelado') }] },
        { name: 'cnc_id', label: 'CNC (si no se completó)', type: 'select', options: (await import('../core/store.js')).opciones('cnc') },
      ],
    });
    if (!d) return;
    if (d.estado === 'no_completado' && !d.cnc_id) return error('Indique la causa de no cumplimiento (CNC).');
    for (const a of objetivo) {
      try {
        await api.update('actividades', a.id, { estado: d.estado, cnc_id: d.estado === 'no_completado' ? d.cnc_id : null,
          ...(d.estado === 'completado' && a.hh_real == null ? { hh_real: a.hh_total } : {}) });
      } catch (e) { error(mensajeError(e)); break; }
    }
    ok('Estados actualizados.');
    await cargar();
  },

  async cerrar() {
    const resp = estado.resp;
    await grilla.guardarAhora();
    const acts = estado.acts.filter(a => a.responsable_id === resp && a.comprometida);
    const sinEstado = acts.filter(a => a.tipo === 'programada' && a.estado === 'programado');
    const sinCnc = acts.filter(a => a.estado === 'no_completado' && !a.cnc_id);
    const sinReal = acts.filter(a => a.estado === 'completado' && a.hh_real == null);
    if (sinEstado.length || sinCnc.length) {
      return modal({
        titulo: 'No se puede cerrar todavía', ancho: 600,
        cuerpo: `<ul>${sinEstado.length ? `<li>${sinEstado.length} compromiso(s) sin estado final (Completado / No completado / Cancelado).</li>` : ''}
          ${sinCnc.length ? `<li>${sinCnc.length} compromiso(s) no completado(s) sin CNC.</li>` : ''}</ul>
          <p class="nota">Use "✔ Marcar estados…" para actualizar varios a la vez.</p>`,
        botones: [{ texto: 'Entendido', clase: 'btn-primario' }],
      });
    }
    const r = resumenPAC(acts);
    const ok1 = await confirmar(`Semana de ${nombre(resp)}: PAC ${pct(r.pac)} (${r.completadas} de ${r.completadas + r.noCompletadas}).` +
      (sinReal.length ? ` Atención: ${sinReal.length} compromiso(s) completado(s) sin HH reales.` : '') + ' Después de cerrar no podrá editarse.',
      { titulo: 'Cerrar semana', texto: 'Cerrar semana' });
    if (!ok1) return;
    try {
      const ex = estado.cierres.find(c => c.responsable_id === resp);
      if (ex) await api.update('cierres', ex.id, { cerrada: true, cerrado_at: new Date().toISOString(), cerrado_por: store.usuario.id });
      else await api.insert('cierres', { area_id: store.area.id, responsable_id: resp, semana: estado.semana });
      ok('Semana cerrada.');
      const nc = acts.filter(a => a.estado === 'no_completado');
      if (nc.length && await confirmar(`¿Arrastrar los ${nc.length} compromiso(s) no completados a la semana siguiente?`, { titulo: 'Arrastre', texto: 'Arrastrar' })) {
        await arrastrarA(nc, sumarSemanas(estado.semana, 1));
      }
      await cargar();
    } catch (e) { error(mensajeError(e)); }
  },

  async reabrir() {
    const c = estado.cierres.find(x => x.responsable_id === estado.resp && x.cerrada);
    if (!c) return;
    if (!await confirmar(`¿Reabrir la semana de ${nombre(estado.resp)}? Quedará registrado en el historial.`, { titulo: 'Reabrir semana', texto: 'Reabrir' })) return;
    try { await api.update('cierres', c.id, { cerrada: false }); ok('Semana reabierta.'); await cargar(); } catch (e) { error(mensajeError(e)); }
  },
};

async function arrastrarA(acts, semanaDestino) {
  try {
    await api.insert('actividades', acts.map(a => ({
      area_id: a.area_id, semana: semanaDestino, responsable_id: a.responsable_id, resp2: a.resp2, proyecto_id: a.proyecto_id,
      gerencia_id: a.gerencia_id, cet_id: a.cet_id, servicio_id: a.servicio_id, descripcion: a.descripcion, comprometida: true,
      tipo: 'programada', estado: 'programado', estado_la: 'trasladada', origen: 'arrastre', origen_id: a.id,
      semana_original: a.semana_original || a.semana, extra: a.extra || {},
      ...Object.fromEntries(DIAS.map(d => [`hh_${d}`, Number(a[`hh_${d}`]) || 0])),
    })));
    ok(`${acts.length} compromiso(s) arrastrados a la semana del ${fmtFecha(semanaDestino)}.`);
  } catch (e) { error(mensajeError(e)); }
}

async function moverSemana(a) {
  if (!a.id) return;
  try {
    await api.update('actividades', a.id, { semana: sumarSemanas(a.semana, 1), comprometida: false, estado_la: 'pendiente', estado: 'programado', cnc_id: null });
    ok('Actividad movida al Look Ahead de la semana siguiente.');
    await cargar();
  } catch (e) { error(mensajeError(e)); }
}

function pdf() {
  const acts = grilla.filas().filter(a => a.id);
  const r = resumenPAC(acts);
  const resp = estado.resp === 'todos' ? 'Todo el equipo' : nombre(estado.resp);
  imprimirPDF('Plan semanal', `<p class="nota">${esc(etiquetaSemana(estado.semana))} · ${esc(resp)}</p>` +
    kpisPDF([['PAC', pct(r.pac), colorPAC(r.pac)], ['Comprometidas', r.comprometidas], ['Completadas', r.completadas, '#59A14F'],
      ['No completadas', r.noCompletadas, '#E15759'], ['No programadas', r.noProgramadas, '#F28E2B'], ['HH plan', num(r.hhPlan)]]) +
    tablaPDF(grilla.columnasPDF(), acts), { orientacion: 'landscape' });   // mismas columnas y anchos que en pantalla
}
