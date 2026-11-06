// Cartera de servicios por líder (6.5) y formulario de solicitudes de otras gerencias (M-01).
import { api, mensajeError } from '../data/api.js';
import { store, destinoActividad, on, esGestor, esStaff, puede, opciones, opcionesLideres, opcionesProyectos, opcionesEstado, colorEstado, proyecto, nombre, etiqueta, textoEstado, lideres, colorValor, opcionesServicio, semanaInicioLA, semanasLookAhead, enProyectoSel, haySeleccion, nombreSeleccion } from '../core/store.js';
import { esc, html, hoy, fmtFecha, lunes, sumarSemanas, etiquetaSemana } from '../core/util.js';
import { crearGrilla } from '../ui/grid.js';
import { kpi, badge, pedirDatos, ok, error, vacio, toast } from '../ui/ui.js';
import { columnasPersonalizadas, columnasActividad, derivarProyectoServicio } from '../services/columnas.js';
import { abrirDetalle } from './detalle.js';
import { imprimirPDF, tablaPDF } from '../services/pdf.js';

let grilla, desuscribir = [], estado;

export async function render(el, params) {
  estado = { items: [], ver: 'abiertas', resp: esGestor() ? 'todos' : store.usuario.id };
  if (!esStaff()) return renderSolicitante(el);
  const pag = html(`<div>
    <div class="pagina-cab"><h1>Cartera y solicitudes</h1>
      <select class="sel" data-resp></select>
      <select class="sel" data-ver><option value="abiertas">Abiertas y en proceso</option><option value="todas">Todas</option><option value="cerradas">Cerradas / rechazadas</option></select>
      <span data-proy></span><span class="flex"></span>
      ${esGestor() ? '<button class="btn btn-sm" data-a="cet" title="Agregar un CET / Servicio nuevo (lo verá todo el equipo)">＋ Agregar CET / Servicio</button>' : ''}
      <button class="btn btn-sm" data-a="solicitud">＋ Registrar solicitud de otra gerencia</button>
      <button class="btn btn-sm" data-a="pdf">🖨 PDF</button></div>
    <div data-nuevas></div>
    <div class="kpis" data-kpis></div>
    <div data-grilla></div></div>`);
  el.append(pag);
  const selR = pag.querySelector('[data-resp]');
  selR.innerHTML = '<option value="todos">Todo el equipo</option>' + lideres().map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');
  selR.value = estado.resp;
  selR.onchange = () => { estado.resp = selR.value; pintar(); };
  pag.querySelector('[data-ver]').onchange = e => { estado.ver = e.target.value; pintar(); };
  pag.querySelector('[data-a="solicitud"]').onclick = () => nuevaSolicitud(true);
  pag.querySelector('[data-a="cet"]')?.addEventListener('click', async () => {
    const id = await (await import('./proyectos.js')).nuevoCETServicio({ proyectoId: store.proyectoSel || null });
    if (id) grilla.refrescar();
  });
  pag.querySelector('[data-a="pdf"]').onclick = pdf;

  grilla = crearGrilla(pag.querySelector('[data-grilla]'), {
    id: 'cartera', tabla: 'cartera', titulo: 'Cartera',
    columnas: columnasCartera(),
    agrupar: [{ field: 'responsable_id', label: 'Responsable' }, { field: 'gerencia_id', label: 'Gerencia' }, { field: 'estado', label: 'Estado' }, { field: 'criticidad_id', label: 'Criticidad' }],
    puedeEditarFila: c => !c.id || esGestor() || c.responsable_id === store.usuario.id || c.created_by === store.usuario.id,
    nuevaFila: () => ({ area_id: store.area.id, f_solicitud: hoy(), responsable_id: estado.resp !== 'todos' ? estado.resp : store.usuario.id,
      proyecto_id: store.proyectoSel || null, gerencia_id: proyecto(store.proyectoSel)?.gerencia_id || null, estado: 'abierta', origen: 'interna', descripcion: '', extra: {} }),
    listaParaCrear: c => !!(c.descripcion && c.descripcion.trim()),
    derivar: derivarProyectoServicio,   // proyecto → gerencia y CET / Servicio; CET ↔ Servicio
    camposCalc: ['created_at', 'updated_at', 'created_by', 'solicitante_id'],
    alGuardar: () => cargarSilencioso(),
    menuFila: c => [{ label: '🔭 Crear actividad en el Look Ahead', action: () => crearActividad(c) }],
  });
  desuscribir.push(api.subscribe(['cartera'], ev => { grilla.aplicarRemoto(ev, filtro); cargarSilencioso(); }));
  desuscribir.push(on('proyecto', () => pintar()));
  await cargar();
  if (params.id) {
    const c = estado.items.find(x => x.id === params.id);
    if (c?.estado === 'nueva') document.querySelector(`[data-sol="${c.id}"]`)?.scrollIntoView();
    else if (c) abrirDetalle('cartera', c);
  }
}

export function destruir() { desuscribir.forEach(f => f && f()); desuscribir = []; grilla?.destruir(); }

/** Columnas de la cartera (pantalla, su PDF y el reporte "Cartera de servicios" usan las mismas). */
export function columnasCartera() {
  const la = new Map(columnasActividad({ modo: 'lookahead' }).map(c => [c.field, c]));
  return [
    { field: 'f_solicitud', title: 'F. solicitud', tipo: 'fecha', ancho: 100 },
    { field: 'solicitante', title: 'Solicitante', tipo: 'texto', ancho: 140, formato: (v, c) => esc(v || nombre(c.solicitante_id)) },
    { field: 'gerencia_id', title: 'Gerencia', tipo: 'lista', ancho: 95, opciones: () => opciones('gerencias').map(o => ({ ...o, label: o.value ? (store.valores.get(o.value)?.codigo || o.label) : o.label })) },
    { field: 'proyecto_id', title: 'Proyecto / Proceso', tipo: 'lista', ancho: 180, opciones: opcionesProyectos },
    la.get('_cet'), la.get('servicio_id'),   // CET y Servicio enlazados, igual que en el Plan y el Look Ahead
    { field: 'descripcion', title: 'Descripción', tipo: 'textoLargo', ancho: 280 },
    { field: 'responsable_id', title: 'Responsable', tipo: 'lista', ancho: 130, opciones: opcionesLideres },
    { field: 'resp2', title: 'Resp. 2', tipo: 'texto', ancho: 100 },
    { field: 'f_requerida', title: 'F. requerida', tipo: 'fecha', ancho: 100 },
    { field: 'f_comprometida', title: 'F. comprometida', tipo: 'fecha', ancho: 110 },
    { field: 'tipo_id', title: 'Tipo', tipo: 'lista', ancho: 100, opciones: () => opciones('tipos_cartera') },
    { field: 'criticidad_id', title: 'Criticidad', tipo: 'lista', ancho: 95, colorear: true, opciones: () => opciones('criticidad').map(o => ({ ...o, color: colorValor(o.value) })) },
    { field: 'estado', title: 'Estado', tipo: 'lista', ancho: 120, colorear: true,
      opciones: () => opcionesEstado('estados_cartera').map(o => ({ ...o, color: colorEstado('estados_cartera', o.value) })) },
    { field: '_dias', title: 'Antigüedad', tipo: 'numero', ancho: 85, calc: true, filtro: false, ayuda: 'Días desde la solicitud',
      formato: (v, c) => c.f_solicitud && !['cerrada', 'rechazada'].includes(c.estado) ? `${Math.round((new Date(hoy()) - new Date(c.f_solicitud)) / 86400000)} d` : '' },
    { field: 'origen', title: 'Origen', tipo: 'texto', ancho: 90, calc: true, formato: v => v === 'solicitud' ? badge('Solicitud', '#F28E2B') : 'Interna' },
    { field: '_colab', title: '💬', tipo: 'texto', ancho: 46, calc: true, filtro: false,
      formato: (v, c) => c.id ? '<button class="mini-btn">＋</button>' : '', click: (c, e) => { if (c.id && e.target.closest('button')) abrirDetalle('cartera', c); } },
    ...columnasPersonalizadas('cartera'),
  ];
}

function filtro(c) {
  if (c.estado === 'nueva') return false;
  if (estado.resp !== 'todos' && c.responsable_id !== estado.resp) return false;
  if (!enProyectoSel(c.proyecto_id)) return false;
  if (estado.ver === 'abiertas') return ['abierta', 'en_proceso'].includes(c.estado);
  if (estado.ver === 'cerradas') return ['cerrada', 'rechazada'].includes(c.estado);
  return true;
}
async function leer() { estado.items = await api.list('cartera', { eq: { area_id: store.area.id }, order: [['f_solicitud', false]] }); }
async function cargar() { await leer(); await grilla.inicializar(estado.items.filter(filtro)); pintarExtras(); }
async function cargarSilencioso() { try { await leer(); pintarExtras(); } catch { /* reintento */ } }
async function pintar() { await grilla.setDatos(estado.items.filter(filtro)); pintarExtras(); }

function puedeAceptar(c) {
  return esGestor() || (puede('ver_solicitud') && (!c.responsable_id || c.responsable_id === store.usuario.id));
}

function pintarExtras() {
  const pag = document.querySelector('#contenido');
  if (!pag?.querySelector('[data-kpis]')) return;
  pag.querySelector('[data-proy]').innerHTML = haySeleccion() ? `<span class="chip-filtro">🏗 ${esc(nombreSeleccion())}</span>` : '';
  const nuevas = estado.items.filter(c => c.estado === 'nueva');
  pag.querySelector('[data-nuevas]').innerHTML = nuevas.length ? `<div class="tarjeta" style="margin-bottom:12px;border-left:4px solid var(--arena)">
    <h2>Solicitudes nuevas por atender (${nuevas.length})</h2>
    <table class="simple"><tr><th>Fecha</th><th>Solicitante</th><th>Proyecto</th><th>CET / Servicio</th><th>Descripción</th><th>Dirigida a</th><th>F. requerida</th><th></th></tr>
    ${nuevas.map(c => `<tr data-sol="${c.id}"><td>${fmtFecha(c.f_solicitud)}</td><td>${esc(c.solicitante || nombre(c.solicitante_id))}</td>
      <td>${esc(proyecto(c.proyecto_id)?.nombre_corto || '')}</td><td>${esc(cetServicio(c.servicio_id))}</td><td>${esc(c.descripcion)}</td>
      <td>${esc(nombre(c.responsable_id) || '—')}</td><td>${fmtFecha(c.f_requerida)}</td>
      <td style="white-space:nowrap">${puedeAceptar(c) ? `<button class="btn btn-sm btn-primario" data-aceptar="${c.id}">Aceptar</button>
        <button class="btn btn-sm" data-rechazar="${c.id}">Rechazar</button>` : '<span class="nota">Por atender</span>'}</td></tr>`).join('')}</table></div>` : '';
  pag.querySelectorAll('[data-aceptar]').forEach(b => b.onclick = () => aceptar(estado.items.find(c => c.id === b.dataset.aceptar)));
  pag.querySelectorAll('[data-rechazar]').forEach(b => b.onclick = () => rechazar(estado.items.find(c => c.id === b.dataset.rechazar)));
  const base = estado.items.filter(c => (estado.resp === 'todos' || c.responsable_id === estado.resp) && enProyectoSel(c.proyecto_id));
  const abiertas = base.filter(c => ['abierta', 'en_proceso'].includes(c.estado));
  const alta = abiertas.filter(c => normal(etiqueta(c.criticidad_id)) === 'alta');
  const vencidas = abiertas.filter(c => c.f_comprometida && c.f_comprometida < hoy());
  const sol = base.filter(c => c.origen === 'solicitud');
  const respondidas = sol.filter(c => c.estado !== 'nueva');
  pag.querySelector('[data-kpis]').innerHTML = [
    kpi('Abiertas', abiertas.length), kpi('Criticidad alta', alta.length, { color: alta.length ? '#E15759' : '' }),
    kpi('Vencidas', vencidas.length, { color: vencidas.length ? '#E15759' : '#59A14F', sub: 'F. comprometida pasada' }),
    kpi('Solicitudes nuevas', nuevas.length, { color: '#F28E2B' }),
    kpi('Solicitudes atendidas', `${respondidas.length}/${sol.length}`, { sub: `${sol.filter(c => c.estado === 'rechazada').length} rechazadas` }),
  ].join('');
}
const normal = s => String(s || '').toLowerCase();
/** "CET · Servicio" (como en la lista CET / Servicio). */
const cetServicio = id => { const v = store.valores.get(id); return v ? (v.codigo ? `${v.codigo} · ${v.valor}` : v.valor) : ''; };

async function aceptar(c) {
  await pedirDatos({
    titulo: 'Aceptar solicitud', texto: 'Aceptar', valores: { responsable_id: c.responsable_id || store.usuario.id, f_comprometida: c.f_requerida },
    antes: esc(c.descripcion),
    campos: [
      { name: 'responsable_id', label: 'Líder responsable', type: 'select', required: true, options: opcionesLideres(), },
      { name: 'f_comprometida', label: 'Fecha comprometida', type: 'date', required: true },
      { name: 'criticidad_id', label: 'Criticidad', type: 'select', options: opciones('criticidad'), value: c.criticidad_id },
      { name: 'tipo_id', label: 'Tipo', type: 'select', options: opciones('tipos_cartera'), value: c.tipo_id },
      { name: 'semana_la', label: 'Crear actividad en el Look Ahead', type: 'select',
        options: [{ value: '', label: 'No por ahora' }, ...semanasLookAhead().map(s => ({ value: s, label: etiquetaSemana(s) }))] },
    ],
    alGuardar: async d => {
      if (!esGestor() && d.responsable_id !== store.usuario.id) throw new Error('Solo puede aceptar solicitudes asignándolas a usted.');
      await api.update('cartera', c.id, { responsable_id: d.responsable_id, f_comprometida: d.f_comprometida, criticidad_id: d.criticidad_id, tipo_id: d.tipo_id, estado: 'abierta' });
      if (d.semana_la) await crearActividad({ ...c, responsable_id: d.responsable_id }, d.semana_la);
      ok('Solicitud aceptada. Se notificó al solicitante.');
    },
  });
  await cargar();
}
async function rechazar(c) {
  await pedirDatos({
    titulo: 'Rechazar solicitud', texto: 'Rechazar', antes: esc(c.descripcion),
    campos: [{ name: 'motivo_rechazo', label: 'Motivo (se envía al solicitante)', type: 'textarea', required: true }],
    alGuardar: async d => { await api.update('cartera', c.id, { estado: 'rechazada', motivo_rechazo: d.motivo_rechazo }); ok('Solicitud rechazada.'); },
  });
  await cargar();
}

async function crearActividad(c, semana) {
  if (!c.id) return;
  const sem = semana || semanaInicioLA();
  if (c.responsable_id !== store.usuario.id && !esGestor()) return toast('Solo el responsable puede crear actividades de esta solicitud.', 'warn');
  try {
    await api.insert('actividades', {
      area_id: store.area.id, semana: sem, responsable_id: c.responsable_id || store.usuario.id, resp2: c.resp2, ...destinoActividad(c.proyecto_id),
      gerencia_id: c.gerencia_id, servicio_id: c.servicio_id, descripcion: c.descripcion, comprometida: false, tipo: 'programada',
      estado: 'programado', estado_la: 'pendiente', origen: c.origen === 'solicitud' ? 'solicitud' : 'cartera', origen_id: c.id, cartera_id: c.id,
    });
    if (c.estado === 'abierta') await api.update('cartera', c.id, { estado: 'en_proceso' }).catch(() => {});
    ok(`Actividad creada en el Look Ahead (${etiquetaSemana(sem)}).`);
  } catch (e) { error(mensajeError(e)); }
}

/** Formulario de solicitud (M-01). Lo usan otras gerencias (consulta) o el equipo en su nombre. */
async function nuevaSolicitud(enNombreDeOtro = false) {
  const misGerencias = store.usuario.gerencia_ids || [];
  const proys = store.proyectos.filter(p => p.estado === 'activo' && (esStaff() || misGerencias.includes(p.gerencia_id)));
  await pedirDatos({
    titulo: 'Nueva solicitud de servicio', texto: 'Enviar solicitud',
    campos: [
      ...(enNombreDeOtro ? [{ name: 'solicitante', label: 'Solicitante (nombre y área)', required: true }] : []),
      { name: 'proyecto_id', label: 'Proyecto', type: 'select', required: true, options: [{ value: '', label: '—' }, ...proys.map(p => ({ value: p.id, label: `${p.codigo} · ${p.nombre_corto}` }))] },
      { name: 'servicio_id', label: 'CET / Servicio requerido', type: 'select', options: opcionesServicio() },
      { name: 'descripcion', label: 'Descripción del pedido', type: 'textarea', required: true, full: true },
      { name: 'f_requerida', label: 'Fecha requerida', type: 'date', required: true },
      { name: 'criticidad_id', label: 'Prioridad', type: 'select', options: opciones('criticidad') },
      { name: 'responsable_id', label: 'Dirigida a (opcional)', type: 'select', options: [{ value: '', label: 'Que la asigne el administrador' }, ...opcionesLideres()] },
      { name: 'enlace', label: 'Enlace a documentos (opcional)', placeholder: 'https://…', full: true },
    ],
    alGuardar: async d => {
      const p = proyecto(d.proyecto_id);
      const [c] = await api.insert('cartera', {
        area_id: store.area.id, f_solicitud: hoy(), solicitante_id: enNombreDeOtro ? null : store.usuario.id,
        solicitante: enNombreDeOtro ? d.solicitante : store.usuario.nombre, gerencia_id: p?.gerencia_id || null, proyecto_id: d.proyecto_id,
        servicio_id: d.servicio_id, descripcion: d.descripcion, f_requerida: d.f_requerida, criticidad_id: d.criticidad_id,
        responsable_id: d.responsable_id || null, estado: enNombreDeOtro ? 'nueva' : 'nueva', origen: enNombreDeOtro ? 'interna' : 'solicitud',
      });
      if (d.enlace && /^https?:\/\//i.test(d.enlace) && esStaff()) {
        await api.insert('enlaces', { area_id: store.area.id, entidad: 'cartera', entidad_id: c.id, titulo: 'Documento de la solicitud', url: d.enlace }).catch(() => {});
      }
      ok('Solicitud registrada. El equipo recibirá un aviso.');
    },
  });
  if (esStaff()) await cargar(); else renderSolicitante(document.getElementById('contenido'));
}

async function renderSolicitante(el) {
  const mias = await api.list('cartera', { eq: { solicitante_id: store.usuario.id }, order: [['f_solicitud', false]] });
  el.innerHTML = '';
  el.append(html(`<div>
    <div class="pagina-cab"><h1>Mis solicitudes de servicio</h1><span class="flex"></span>
      ${puede('crear_solicitud') ? '<button class="btn btn-primario" data-a="nueva">＋ Nueva solicitud</button>' : ''}</div>
    <div class="aviso">Registre aquí sus pedidos al equipo de la Gerencia Técnica. Recibirá un aviso cuando se acepten o rechacen.</div>
    <div class="tarjeta">${mias.length ? `<table class="simple"><tr><th>Fecha</th><th>Proyecto</th><th>CET / Servicio</th><th>Descripción</th><th>F. requerida</th><th>Responsable</th><th>F. comprometida</th><th>Estado</th></tr>
      ${mias.map(c => `<tr><td>${fmtFecha(c.f_solicitud)}</td><td>${esc(proyecto(c.proyecto_id)?.nombre_corto || '')}</td><td>${esc(cetServicio(c.servicio_id))}</td>
        <td>${esc(c.descripcion)}${c.motivo_rechazo ? `<div class="nota">Motivo: ${esc(c.motivo_rechazo)}</div>` : ''}</td><td>${fmtFecha(c.f_requerida)}</td>
        <td>${esc(nombre(c.responsable_id))}</td><td>${fmtFecha(c.f_comprometida)}</td>
        <td>${badge(textoEstado('estados_cartera', c.estado), colorEstado('estados_cartera', c.estado))}</td></tr>`).join('')}</table>`
      : vacio('Aún no ha registrado solicitudes.')}</div></div>`));
  el.querySelector('[data-a="nueva"]')?.addEventListener('click', () => nuevaSolicitud(false));
}

function pdf() {
  const items = grilla.filas().filter(c => c.id);
  imprimirPDF('Cartera de servicios', tablaPDF(grilla.columnasPDF(), items), { orientacion: 'landscape' });   // como en pantalla
}
