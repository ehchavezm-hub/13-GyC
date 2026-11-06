// Plantillas: actividades recurrentes de cada líder (6.6) y plantillas de servicio (M-05).
import { api, mensajeError } from '../data/api.js';
import { store, esGestor, puede, lideres, opcionesServicio, nombre } from '../core/store.js';
import { columnasActividad, derivarActividad } from '../services/columnas.js';
import { esc, html } from '../core/util.js';
import { crearGrilla } from '../ui/grid.js';
import { pedirDatos, ok, error, confirmar } from '../ui/ui.js';
import { DIAS } from '../core/util.js';

let grilla, estado;

export async function render(el) {
  estado = { modo: 'recurrente', duenio: store.usuario.id, plantilla: null, plantillas: [] };
  el.append(html(`<div>
    <div class="pagina-cab"><h1>Plantillas</h1>
      <div class="pestanas" style="min-width:380px"><button data-m="recurrente" class="activo">🔁 Actividades recurrentes</button><button data-m="servicio">🧩 Plantillas de servicio</button></div>
      <span data-sel></span><span class="flex"></span><span data-acc></span></div>
    <div class="aviso" data-ayuda></div>
    <div data-grilla></div></div>`));
  el.querySelector('.pestanas').addEventListener('click', e => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    estado.modo = m; estado.plantilla = null;
    el.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('activo', b.dataset.m === m));
    cargar();
  });
  await cargar();
}

export function destruir() { grilla?.destruir(); grilla = null; }

function puedeEditar() {
  if (estado.modo === 'recurrente') return estado.duenio === store.usuario.id || esGestor();
  return esGestor();
}

async function cargar() {
  const el = document.getElementById('contenido');
  const area = store.area.id;
  if (estado.modo === 'recurrente') {
    let pl = await api.list('plantillas', { eq: { area_id: area, tipo: 'recurrente', propietario_id: estado.duenio } });
    if (!pl.length && puedeEditar()) {
      try { pl = await api.insert('plantillas', { area_id: area, tipo: 'recurrente', nombre: 'Actividades recurrentes', propietario_id: estado.duenio }); }
      catch (e) { error(mensajeError(e)); }
    }
    estado.plantillas = pl;
    estado.plantilla = pl[0]?.id || null;
    el.querySelector('[data-ayuda]').innerHTML = 'Actividades que se repiten cada semana (reuniones, registro de HH, monitoreo de RFI…). En el Plan semanal use <b>🔁 Recurrentes</b> para agregarlas.';
    el.querySelector('[data-sel]').innerHTML = esGestor() ? `<select class="sel" data-duenio>${lideres().map(l => `<option value="${l.id}"${l.id === estado.duenio ? ' selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select>` : '';
    el.querySelector('[data-duenio]')?.addEventListener('change', e => { estado.duenio = e.target.value; cargar(); });
    el.querySelector('[data-acc]').innerHTML = '';
  } else {
    estado.plantillas = await api.list('plantillas', { eq: { area_id: area, tipo: 'servicio' }, order: [['nombre', true]] });
    if (!estado.plantilla || !estado.plantillas.some(p => p.id === estado.plantilla)) estado.plantilla = estado.plantillas[0]?.id || null;
    el.querySelector('[data-ayuda]').innerHTML = 'Un servicio estándar con su paquete de actividades típicas y HH de referencia. En el Look Ahead use <b>🧩 Aplicar plantilla de servicio</b> para generar las actividades en un proyecto. "Semana +" indica en qué semana relativa va cada actividad.';
    el.querySelector('[data-sel]').innerHTML = `<select class="sel" data-pl>${estado.plantillas.map(p => `<option value="${p.id}"${p.id === estado.plantilla ? ' selected' : ''}>${esc(p.nombre)}${p.activa ? '' : ' (inactiva)'}</option>`).join('')}</select>`;
    el.querySelector('[data-pl]')?.addEventListener('change', e => { estado.plantilla = e.target.value; pintarGrilla(); });
    el.querySelector('[data-acc]').innerHTML = puedeEditar() ? '<button class="btn btn-sm btn-primario" data-nueva>＋ Nueva plantilla</button> <button class="btn btn-sm" data-ren>✏ Renombrar / activar</button>' : '';
    el.querySelector('[data-nueva]')?.addEventListener('click', nuevaPlantilla);
    el.querySelector('[data-ren]')?.addEventListener('click', renombrar);
  }
  await pintarGrilla();
}

async function pintarGrilla() {
  const cont = document.querySelector('#contenido [data-grilla]');
  grilla?.destruir();
  if (!estado.plantilla) { cont.innerHTML = '<p class="nota">Cree una plantilla para empezar.</p>'; return; }
  const items = await api.list('plantilla_items', { eq: { plantilla_id: estado.plantilla }, order: [['orden', true]] });
  grilla = crearGrilla(cont, {
    id: 'plantilla_v2_' + estado.modo, tabla: 'plantilla_items', titulo: 'Plantilla', altura: 'calc(100vh - 320px)', puedeCrear: puedeEditar(),
    columnas: columnasPlantilla(),
    camposCalc: ['hh_total'],
    puedeEditarFila: () => puedeEditar(),
    nuevaFila: () => ({ plantilla_id: estado.plantilla, descripcion: '', semana_offset: 0, orden: Date.now() % 100000,
      proyecto_id: estado.modo === 'recurrente' ? store.proyectoSel || null : null, hh_lu: 0, hh_ma: 0, hh_mi: 0, hh_ju: 0, hh_vi: 0, hh_sa: 0, hh_do: 0, hh_total: 0 }),
    listaParaCrear: i => !!(i.descripcion && i.descripcion.trim()),
    // Mismas reglas que el Look Ahead: HH total, gerencia del proyecto y CET ↔ Servicio
    derivar: (i, c) => { const d = derivarActividad(i, c); delete d.comprometida; return d; },
  });
  await grilla.inicializar(items.map(i => ({ ...i, hh_total: DIAS.reduce((s, x) => s + (Number(i[`hh_${x}`]) || 0), 0) })));
}

/**
 * Columnas iguales a las del Look Ahead (mismas definiciones, cabeceras, anchos y orden).
 * Semana y Resp. 1 se adaptan: en una plantilla de servicio la semana es relativa (+0, +1…) y el responsable
 * y el proyecto se eligen al aplicarla; en las recurrentes, la actividad va cada semana a nombre de su dueño.
 */
export function columnasPlantilla(modo = estado.modo, duenio = estado?.duenio) {
  const la = new Map(columnasActividad({ modo: 'lookahead', semanasLA: [], conGrupo: true }).map(c => [c.field, c]));
  const servicio = modo === 'servicio';
  const alAplicar = () => '<span class="nota">al aplicar</span>';
  return [
    servicio
      ? { field: 'semana_offset', title: 'Semana', tipo: 'lista', ancho: 175, ayuda: 'Semana relativa a la semana de inicio elegida al aplicar la plantilla',
          opciones: () => Array.from({ length: 12 }, (_, n) => ({ value: n, label: n ? `Semana +${n}` : 'Semana de inicio' })) }
      : { field: '_semana', title: 'Semana', tipo: 'texto', ancho: 175, calc: true, filtro: false, formato: () => 'Cada semana' },
    { field: '_resp', title: 'Resp. 1', tipo: 'texto', ancho: 130, calc: true, filtro: false,
      formato: () => (servicio ? alAplicar() : esc(nombre(duenio))) },
    la.get('gerencia_id'),
    servicio ? { ...la.get('proyecto_id'), editable: false, formato: alAplicar } : la.get('proyecto_id'),
    la.get('_cet'), la.get('servicio_id'), la.get('descripcion'),
    ...DIAS.map(d => la.get(`hh_${d}`)),
    la.get('hh_total'),
  ];
}

async function nuevaPlantilla() {
  await pedirDatos({
    titulo: 'Nueva plantilla de servicio', texto: 'Crear',
    campos: [{ name: 'nombre', label: 'Nombre', required: true, full: true }, { name: 'servicio_id', label: 'CET / Servicio', type: 'select', options: opcionesServicio() }],
    alGuardar: async d => {
      const [p] = await api.insert('plantillas', { ...d, area_id: store.area.id, tipo: 'servicio' });
      estado.plantilla = p.id; ok('Plantilla creada. Agregue sus actividades.');
    },
  });
  await cargar();
}

async function renombrar() {
  const p = estado.plantillas.find(x => x.id === estado.plantilla);
  if (!p) return;
  await pedirDatos({
    titulo: 'Plantilla', valores: p,
    campos: [{ name: 'nombre', label: 'Nombre', required: true, full: true }, { name: 'servicio_id', label: 'CET / Servicio', type: 'select', options: opcionesServicio() },
      { name: 'activa', label: 'Estado', type: 'checkbox', texto: 'Activa (disponible para aplicar)' }],
    alGuardar: async d => { await api.update('plantillas', p.id, d); ok('Plantilla actualizada.'); },
  });
  await cargar();
}
