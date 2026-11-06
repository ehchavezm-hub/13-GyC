// Backlog del Grupo LPS: trabajo pendiente que todavía no tiene semana. Se pasa al Look Ahead cuando corresponde
// (Backlog → Look Ahead → Plan semanal). Se guarda en la tabla «cartera» (origen interno), sin cambios en la base:
//   · proyecto_id = Grupo LPS (como las actividades); extra.proyecto_id = Proyecto; servicio_id = CET / Servicio;
//   · extra.prioridad, extra.hh_estimadas y extra.comentario; f_requerida; solicitante (opcional).
// El Estado se calcula con las actividades creadas desde el ítem (actividades.cartera_id).
import { api, mensajeError } from '../data/api.js';
import { store, on, esGestor, lideres, nombre, proyecto, param, opciones, opcionesLideres, enProyectoSel, haySeleccion, nombreSeleccion, semanasLookAhead } from '../core/store.js';
import { lunes, sumarSemanas, etiquetaSemana, esc, html, num, DIAS, sumarDias } from '../core/util.js';
import { crearGrilla } from '../ui/grid.js';
import { toast, ok, error, modal, badge, kpi } from '../ui/ui.js';
import { bloqueoCrear, aplicarVistaGrupos, avisoSinGrupo, grupoElegido } from '../services/grupos-lps.js';
import { columnasActividad, derivarProyectoServicio } from '../services/columnas.js';
import { capacidadSemana } from '../services/indicadores.js';
import { abrirDetalle, abrirRestricciones, sincronizarEstadoLA } from './detalle.js';

let grilla, desuscribir = [], estado;

const PRIORIDADES = [{ value: 'alta', label: 'Alta', color: '#E15759' }, { value: 'media', label: 'Media', color: '#F28E2B' }, { value: 'baja', label: 'Baja', color: '#59A14F' }];
const ESTADOS = { backlog: ['En backlog', '#76B7B2'], la: ['En Look Ahead', '#4E79A7'], completada: ['Completada', '#59A14F'] };
// Campo virtual (editable) guardado en extra
const deExtra = (campo, clave) => d => (d[campo] !== undefined ? d[campo] : d.extra?.[clave] ?? null);

/** Estado del ítem según las actividades que salieron de él. */
function estadoItem(c) {
  const acts = estado.vinculos.get(c.id) || [];
  if (!acts.length) return 'backlog';
  return acts.every(a => a.estado === 'completado' || a.estado_la === 'cancelada' || a.estado === 'cancelado') ? 'completada' : 'la';
}
/** Semana sugerida para pasar al Look Ahead: entra cuando la F. requerida cae dentro del horizonte del Look Ahead. */
function semanaEntrada(c) {
  if (!c.f_requerida) return null;
  const n = semanasLookAhead().length;
  const s = sumarSemanas(lunes(c.f_requerida), -(n - 1));
  const primera = semanasLookAhead()[0];
  return s < primera ? primera : s;
}

export async function render(el) {
  estado = { items: [], vinculos: new Map(), rests: [], colab: new Map(), ubic: [] };
  const pag = html(`<div>
    <div class="pagina-cab"><h1>Backlog</h1>
      <span class="pagina-sub">Trabajo pendiente del Grupo LPS, todavía sin semana. Se pasa al Look Ahead cuando corresponde.</span>
      <span data-proy></span><span class="flex"></span></div>
    <div class="aviso">Flujo del Last Planner: <b>Backlog</b> → <b>Look Ahead</b> (¿qué PUEDE hacerse?, se levantan restricciones) → <b>Plan semanal</b> (¿qué SE HARÁ?).
      Registre aquí lo que hay que hacer con sus <b>HH estimadas</b> y la <b>F. requerida</b>; la columna «Entra al LA en» sugiere la semana para pasarlo.</div>
    <div class="kpis" data-kpis></div>
    <div class="barra" style="margin-bottom:10px">
      <button class="btn btn-sm btn-azul" data-a="pasar" title="Crear en el Look Ahead las actividades de los ítems elegidos">➡ Pasar al Look Ahead</button>
    </div>
    <div data-grilla></div></div>`);
  el.append(pag);
  pag.addEventListener('click', e => { if (e.target.closest('[data-a="pasar"]')) pasarAlLookAhead(); });

  const la = new Map(columnasActividad({ modo: 'lookahead', semanasLA: [], conGrupo: true }).map(c => [c.field, c]));
  const yo = store.usuario.id;
  grilla = crearGrilla(pag.querySelector('[data-grilla]'), {
    id: 'backlog', tabla: 'cartera', titulo: 'Backlog',
    columnas: [
      la.get('proyecto_id'),   // «Grupo LPS»: visible solo en la vista consolidada
      { field: '_prioridad', title: 'Prioridad', tipo: 'lista', ancho: 95, colorear: true, valor: deExtra('_prioridad', 'prioridad'),
        opciones: () => [{ value: null, label: '—' }, ...PRIORIDADES] },
      { ...la.get('responsable_id'), editable: () => true },
      la.get('gerencia_id'),
      la.get('_proyecto'),
      la.get('_cet'),
      la.get('servicio_id'),
      { ...la.get('descripcion'), title: 'Actividad' },
      { field: '_hh', title: 'HH estimadas', tipo: 'numero', ancho: 90, total: true, valor: deExtra('_hh', 'hh_estimadas'),
        ayuda: 'Total de horas; al pasar al Look Ahead se reparten en los días laborables de la semana' },
      { field: 'f_requerida', title: 'F. requerida', tipo: 'fecha', ancho: 105 },
      { field: '_entra', title: 'Entra al LA en', tipo: 'texto', ancho: 120, calc: true, filtro: false,
        formato: (v, c) => { const s = semanaEntrada(c); return s ? esc(etiquetaSemana(s).split('·')[0].trim()) : ''; },
        ayuda: 'Semana sugerida para pasarlo al Look Ahead (según la F. requerida)' },
      { field: '_estado', title: 'Estado', tipo: 'texto', ancho: 120, calc: true, filtro: false,
        formato: (v, c) => (c.id ? badge(...ESTADOS[estadoItem(c)]) : ''), ayuda: 'Se actualiza solo con las actividades creadas desde el ítem' },
      { field: '_restr', title: '🚧', tipo: 'texto', ancho: 48, calc: true, filtro: false, ordenable: false, ayuda: 'Restricciones conocidas',
        formato: (v, c) => { const n = estado.rests.filter(r => r.extra?.cartera_id === c.id && !r.actividad_id && r.estado !== 'levantada').length;
          return c.id ? `<button class="mini-btn" title="Ver / agregar restricciones">${n ? `<b style="color:var(--rojo)">${n}</b>` : '＋'}</button>` : ''; },
        click: (c, e) => { if (c.id && e.target.closest('button')) abrirRestricciones(c, { item: true, alCambiar: recargar }); } },
      { field: '_colab', title: '💬', tipo: 'texto', ancho: 48, calc: true, filtro: false, ordenable: false, ayuda: 'Comentarios y enlaces',
        formato: (v, c) => (c.id ? `<button class="mini-btn" title="Comentarios y enlaces">${estado.colab.get(c.id) || '＋'}</button>` : ''),
        click: (c, e) => { if (c.id && e.target.closest('button')) abrirDetalle('cartera', c, { alCambiar: n => { estado.colab.set(c.id, n); grilla.refrescar(); } }); } },
      { field: '_comentario', title: 'Comentario', tipo: 'textoLargo', ancho: 220, valor: deExtra('_comentario', 'comentario') },
      { field: 'solicitante', title: 'Solicitante', tipo: 'texto', ancho: 140, visible: false },
    ],
    bloqueoCrear,
    alAplicarVista: () => aplicarVistaGrupos(grilla, { forzar: true }),
    agrupar: [{ field: 'responsable_id', label: 'Responsable' }, { field: 'proyecto_id', label: 'Grupo LPS' }, { field: '_prioridad', label: 'Prioridad' }],
    puedeEditarFila: c => !c.id || esGestor() || c.responsable_id === yo || c.created_by === yo,
    campoInicial: 'descripcion',
    listaParaCrear: c => !!(c.descripcion && c.descripcion.trim()),
    nuevaFila: () => {
      const g = grupoElegido();
      return { area_id: store.area.id, origen: 'interna', estado: 'abierta', responsable_id: yo, proyecto_id: g?.id || store.proyectoSel || null,
        gerencia_id: null, extra: { prioridad: 'media' } };
    },
    derivar: (c, cambios, ctx) => {
      const d = derivarProyectoServicio(c, cambios, { atendido: true, ...(ctx || {}) });
      const extra = { ...(c.extra || {}), ...(d.extra || {}) };
      let cambia = !!d.extra;
      if ('_prioridad' in cambios) { extra.prioridad = cambios._prioridad || null; cambia = true; }
      if ('_hh' in cambios) { extra.hh_estimadas = cambios._hh === '' || cambios._hh == null ? null : Number(cambios._hh); cambia = true; }
      if ('_comentario' in cambios) { extra.comentario = cambios._comentario || null; cambia = true; }
      if (cambia) d.extra = extra;
      return d;
    },
    alGuardar: () => cargarSilencioso(),
    menuFila: c => [
      { label: '➡ Pasar al Look Ahead…', action: () => c.id && pasarAlLookAhead([c.id]) },
      { label: '🚧 Restricciones…', action: () => c.id && abrirRestricciones(c, { item: true, alCambiar: recargar }) },
      { label: '💬 Comentarios y enlaces…', action: () => c.id && abrirDetalle('cartera', c, { alCambiar: n => { estado.colab.set(c.id, n); grilla.refrescar(); } }) },
    ],
  });
  desuscribir.push(api.subscribe(['cartera', 'actividades', 'restricciones'], ev => {
    if (ev.tabla === 'cartera') grilla.aplicarRemoto(ev, filtroFila);
    cargarSilencioso();
  }));
  desuscribir.push(on('proyecto', () => pintar()));
  await cargar();
}

export function destruir() { desuscribir.forEach(f => f && f()); desuscribir = []; grilla?.destruir(); }

// Ítems del backlog: cartera interna o solicitudes ya aceptadas (no las nuevas ni las rechazadas), del grupo elegido
function filtroFila(c) {
  if (['nueva', 'rechazada'].includes(c.estado)) return false;
  return enProyectoSel(c.proyecto_id);
}

async function leer() {
  const area = store.area.id;
  const semana = semanasLookAhead()[0];
  const [items, rests, ubic] = await Promise.all([
    api.list('cartera', { eq: { area_id: area }, order: [['created_at', true]] }),
    api.list('restricciones', { eq: { area_id: area } }),
    api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: semana }, lte: { fecha: sumarDias(semana, 6) } }),
  ]);
  const ids = items.map(c => c.id);
  const acts = ids.length ? await api.list('actividades', { in: { cartera_id: ids } }) : [];
  const vinculos = new Map();
  for (const a of acts) vinculos.set(a.cartera_id, [...(vinculos.get(a.cartera_id) || []), a]);
  let colab = new Map();
  try {
    const f = { eq: { entidad: 'cartera', area_id: area }, select: 'entidad_id' };
    const [coms, enls] = await Promise.all([api.list('comentarios', f), api.list('enlaces', f)]);
    for (const c of [...coms, ...enls]) colab.set(c.entidad_id, (colab.get(c.entidad_id) || 0) + 1);
  } catch { colab = new Map(); }
  Object.assign(estado, { items, rests, ubic, vinculos, colab });
}
async function cargar() {
  await leer();
  await grilla.inicializar(estado.items.filter(filtroFila));
  aplicarVistaGrupos(grilla, { forzar: true });
  pintarCabecera();
}
async function cargarSilencioso() { try { await leer(); grilla.refrescar(); pintarCabecera(); } catch { /* reintento en el próximo cambio */ } }
async function recargar() { await cargarSilencioso(); }
async function pintar() { await grilla.setDatos(estado.items.filter(filtroFila)); aplicarVistaGrupos(grilla); pintarCabecera(); }

function pintarCabecera() {
  const pag = document.querySelector('#contenido');
  if (!pag?.querySelector('[data-kpis]')) return;
  pag.querySelector('[data-proy]').innerHTML = (haySeleccion() ? `<span class="chip-filtro">🏗 ${esc(nombreSeleccion())}</span>` : '')
    + avisoSinGrupo(estado.items.filter(c => !['nueva', 'rechazada'].includes(c.estado)));
  const visibles = estado.items.filter(filtroFila);
  const pendientes = visibles.filter(c => estadoItem(c) === 'backlog');
  const hh = pendientes.reduce((s, c) => s + (Number(c.extra?.hh_estimadas) || 0), 0);
  const semana = semanasLookAhead()[0];
  const personas = [...new Set(visibles.map(c => c.responsable_id).filter(Boolean))];
  const capacidad = (personas.length ? personas : lideres().map(l => l.id)).reduce((s, id) => s + capacidadSemana(id, semana, estado.ubic), 0);
  const semanas = capacidad ? hh / capacidad : null;
  const tarjeta = (t, v, sub) => kpi(t, v, { sub });
  pag.querySelector('[data-kpis]').innerHTML = [
    tarjeta('En backlog', pendientes.length, `${visibles.filter(c => estadoItem(c) === 'la').length} en Look Ahead · ${visibles.filter(c => estadoItem(c) === 'completada').length} completados`),
    tarjeta('HH en backlog', num(hh), 'suma de HH estimadas pendientes'),
    tarjeta('Capacidad semanal', num(capacidad), `HH de ${personas.length || lideres().length} persona(s)`),
    tarjeta('Trabajo en cola', semanas == null ? '—' : `${num(semanas, 1)} sem.`, 'HH en backlog ÷ capacidad semanal'),
  ].join('');
}

// ---------- Pasar al Look Ahead ----------
// Crea una actividad del Look Ahead por ítem, en el Grupo LPS del ítem, con su Proyecto, CET / Servicio y las HH
// estimadas repartidas en los días laborables. El ítem queda «En Look Ahead» y sus restricciones pasan a la actividad.
async function pasarAlLookAhead(idsElegidos) {
  const semanas = semanasLookAhead();
  const candidatos = estado.items.filter(filtroFila).filter(c => estadoItem(c) === 'backlog');
  if (!candidatos.length) return toast('No hay ítems en backlog para pasar al Look Ahead.', 'info');
  const marcados = new Set(idsElegidos || []);
  const cuerpo = html(`<div>
    <div class="campo"><label>Semana del Look Ahead</label><select class="sel" data-sem>${semanas.map(s => `<option value="${s}">${esc(etiquetaSemana(s))}</option>`).join('')}</select></div>
    <p class="nota">Las HH estimadas se reparten en los días laborables de la semana. Puede ajustarlas después en el Look Ahead.</p>
    <table class="simple" style="margin-top:8px"><tr><th></th><th>Prioridad</th><th>Responsable</th><th>Actividad</th><th>HH</th><th>Entra al LA en</th></tr>
    ${candidatos.map(c => { const s = semanaEntrada(c); return `<tr><td><input type="checkbox" value="${c.id}" ${marcados.has(c.id) ? 'checked' : ''}></td>
      <td>${esc(PRIORIDADES.find(p => p.value === c.extra?.prioridad)?.label || '')}</td><td>${esc(nombre(c.responsable_id))}</td>
      <td>${esc(c.descripcion)}</td><td>${num(Number(c.extra?.hh_estimadas) || 0)}</td><td>${s ? esc(etiquetaSemana(s).split('·')[0].trim()) : ''}</td></tr>`; }).join('')}</table></div>`);
  modal({ titulo: 'Pasar al Look Ahead', cuerpo, ancho: 900, botones: [{ texto: 'Cancelar' }, { texto: 'Crear en el Look Ahead', clase: 'btn-primario', accion: async () => {
    const ids = [...cuerpo.querySelectorAll('input:checked')].map(i => i.value);
    const semana = cuerpo.querySelector('[data-sem]').value;
    const sel = candidatos.filter(c => ids.includes(c.id));
    if (!sel.length) { toast('Marque al menos un ítem.', 'warn'); return false; }
    const dias = (param('dias_laborables') || [1, 2, 3, 4, 5]).map(Number).filter(d => d >= 1 && d <= 7).sort();
    try {
      for (const c of sel) {
        const hh = Number(c.extra?.hh_estimadas) || 0;
        const porDia = dias.length ? Math.round((hh / dias.length) * 2) / 2 : 0;
        const reparto = Object.fromEntries(DIAS.map((x, i) => [`hh_${x}`, 0]));
        let resto = hh;
        dias.forEach((d, i) => { const v = i === dias.length - 1 ? Math.max(0, Math.round(resto * 2) / 2) : Math.min(porDia, resto); reparto[`hh_${DIAS[d - 1]}`] = v; resto -= v; });
        const [act] = await api.insert('actividades', {
          area_id: store.area.id, semana, responsable_id: c.responsable_id || store.usuario.id, proyecto_id: c.proyecto_id,
          gerencia_id: c.gerencia_id, servicio_id: c.servicio_id, descripcion: c.descripcion, comprometida: false, tipo: 'programada',
          estado: 'programado', estado_la: 'pendiente', origen: 'cartera', origen_id: c.id, cartera_id: c.id,
          extra: c.extra?.proyecto_id ? { proyecto_id: c.extra.proyecto_id } : {}, ...reparto,
        });
        if (c.estado === 'abierta') await api.update('cartera', c.id, { estado: 'en_proceso' }).catch(() => {});
        // Las restricciones conocidas del ítem pasan a la actividad
        const rs = estado.rests.filter(r => r.extra?.cartera_id === c.id && !r.actividad_id);
        for (const r of rs) await api.update('restricciones', r.id, { actividad_id: act.id }).catch(() => {});
        if (rs.length) await sincronizarEstadoLA(act.id).catch(() => {});
      }
      ok(`${sel.length} actividad(es) creadas en el Look Ahead (${etiquetaSemana(semana)}).`);
      await recargar();
    } catch (e) { error(mensajeError(e)); return false; }
  } }] });
}
