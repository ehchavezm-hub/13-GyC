// Look Ahead (6.7): actividades de las próximas semanas, estado LA, restricciones y carga vs capacidad.
import { api, mensajeError } from '../data/api.js';
import { store, destinoActividad, equipo, on, esGestor, puede, puedeEditarActividad, lideres, nombre, proyecto, param, opciones, opcionesLideres, opcionesProyectos, enProyectoSel, esContenedor, haySeleccion, nombreSeleccion } from '../core/store.js';
import { lunes, sumarSemanas, etiquetaSemana, esc, html, num, sumarDias, DIAS, pct } from '../core/util.js';
import { actualizarQuery } from '../core/router.js';
import { crearGrilla } from '../ui/grid.js';
import { toast, ok, error, modal, pedirDatos, badge } from '../ui/ui.js';
import { bloqueoCrear, aplicarVistaGrupos, avisoSinGrupo, opcionesGrupos } from '../services/grupos-lps.js';
import { columnasActividad, derivarActividad, CAMPOS_CALC_ACT } from '../services/columnas.js';
import { capacidadSemana, colorCarga, restriccionesActivas } from '../services/indicadores.js';
import { abrirDetalle, abrirRestricciones, confirmarRestricciones } from './detalle.js';
import { imprimirPDF, tablaPDF } from '../services/pdf.js';
import { textoEstado, servicioDeProyecto, semanasLookAhead, configLookAhead, diaLookAhead, conteoColaboracion } from '../core/store.js';

let grilla, desuscribir = [], estado;

const semanasLA = () => semanasLookAhead();   // según Configuración → Parámetros (pedido 110)

export async function render(el, { query }) {
  estado = { resp: query.get('resp') || (esGestor() ? 'todos' : store.usuario.id), semanas: semanasLA(), acts: [], rests: [], ubic: [], colab: new Map() };
  const pag = html(`<div>
    <div class="pagina-cab"><h1>Look Ahead</h1>
      <span class="pagina-sub">${estado.semanas.length} semanas: ${esc(etiquetaSemana(estado.semanas[0]))} → ${esc(etiquetaSemana(estado.semanas.at(-1)).split('·')[0])}</span>
      <select class="sel" data-resp aria-label="Responsable"></select>
      <div class="pestanas pestanas-la">
        <button data-v="la">🔭 Look Ahead</button>
        <button data-v="carga">📊 Carga vs capacidad (HH) <span class="badge-alerta" data-alerta></span></button>
      </div><span data-proy></span>
      <span class="flex"></span><button class="btn btn-sm" data-a="pdf">🖨 PDF</button></div>
    <div data-vista="carga" class="oculto"><div class="tarjeta"><h2>Carga vs capacidad (HH)</h2><div data-carga></div></div></div>
    <div data-vista="la">
    <div class="aviso">El Look Ahead responde <b>¿qué PUEDE hacerse?</b> Registre las actividades de las próximas semanas, identifique sus restricciones y márquelas como <b>Lista</b> cuando estén libres. El Look Ahead se registra los <b>${esc(diaLookAhead())}</b> y se compromete la <b>${esc(etiquetaSemana(estado.semanas[0]))}</b>${configLookAhead().semana === 'actual' ? ' (la misma semana)' : ' (la semana siguiente)'}. Puede cambiarlo en Configuración → Parámetros.</div>
    <div class="barra" style="margin-bottom:10px">
      <button class="btn btn-sm btn-azul" data-a="comprometer" title="Pasar al Plan semanal las filas seleccionadas o las Listas de la ${esc(etiquetaSemana(estado.semanas[0]))}">✔ Comprometer ${esc(etiquetaSemana(estado.semanas[0]).split('·')[0].trim())}</button>
      <button class="btn btn-sm" data-a="plantilla" title="Generar actividades desde una plantilla de servicio (M-05)">🧩 Aplicar plantilla de servicio</button>
      <button class="btn btn-sm" data-a="cartera" title="Crear actividades desde la cartera">🗂 Desde la cartera</button>
      ${esGestor() ? '<button class="btn btn-sm" data-a="cet" title="Agregar un CET / Servicio nuevo (lo verá todo el equipo)">＋ Agregar CET / Servicio</button>' : ''}
    </div>
    <div data-grilla></div></div></div>`);
  el.append(pag);
  // Dos subventanas: la grilla del Look Ahead y la carga vs capacidad (se recuerda la última elegida)
  const mostrarVista = v => {
    pag.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('activo', b.dataset.v === v));
    pag.querySelectorAll('[data-vista]').forEach(d => d.classList.toggle('oculto', d.dataset.vista !== v));
    try { localStorage.setItem('lpsgt-la-vista', v); } catch { /* sin almacenamiento */ }
    if (v === 'la') grilla?.tabla?.redraw(true);
  };
  pag.querySelector('.pestanas-la').addEventListener('click', e => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) mostrarVista(v); });
  let vistaInicial = 'la';
  try { vistaInicial = localStorage.getItem('lpsgt-la-vista') || 'la'; } catch { /* sin almacenamiento */ }
  mostrarVista(vistaInicial);
  const sel = pag.querySelector('[data-resp]');
  sel.innerHTML = `<option value="todos">Todo el equipo</option>` + lideres().map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');
  sel.value = estado.resp;
  sel.addEventListener('change', () => { estado.resp = sel.value; actualizarQuery({ resp: estado.resp }); pintar(); });
  pag.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a && acciones[a]) acciones[a]();
  });

  grilla = crearGrilla(pag.querySelector('[data-grilla]'), {
    id: 'lookahead', tabla: 'actividades', titulo: 'Look Ahead',
    columnas: columnasActividad({
      conGrupo: true,   // visible solo en la vista consolidada (varios Grupos LPS); ver grupos-lps.js
      modo: 'lookahead', semanasLA: estado.semanas, extras: {
        restricciones: { get: id => restriccionesActivas(id, estado.rests).length },
        colaboracion: estado.colab,
        abrirRestricciones: a => abrirRestricciones(a, { alCambiar: recargar }),
        abrirDetalle: a => abrirDetalle('actividad', a, { alCambiar: n => { estado.colab.set(a.id, n); grilla.refrescar(); } }),
      },
    }),
    camposCalc: CAMPOS_CALC_ACT,
    bloqueoCrear,   // sin un Grupo LPS elegido no se crean filas
    alAplicarVista: () => aplicarVistaGrupos(grilla, { forzar: true }),
    agrupar: [{ field: 'semana', label: 'Semana' }, { field: 'responsable_id', label: 'Responsable' }, { field: 'proyecto_id', label: 'Grupo LPS' }, { field: 'estado_la', label: 'Estado LA' }],
    // Una comprometida sigue editable mientras no tenga estado final (p. ej. para volver de "Trasladada" a "Lista");
    // una vez reportada en el Plan (completada, no completada o cancelada) queda bloqueada
    puedeEditarFila: a => puedeEditarActividad(a) && (!a.comprometida || a.estado === 'programado'),
    campoInicial: 'descripcion',
    listaParaCrear: a => !!(a.descripcion && a.descripcion.trim()),
    crear: async datos => api.insert('actividades', { ...datos, descripcion: datos.descripcion || '' }),
    nuevaFila: () => {
      const p = store.proyectoSel ? proyecto(store.proyectoSel) : null;
      return { area_id: store.area.id, semana: estado.semanas[0], responsable_id: estado.resp !== 'todos' ? estado.resp : store.usuario.id,
        comprometida: false, tipo: 'programada', estado: 'programado', estado_la: 'pendiente', origen: 'manual',
        proyecto_id: p?.id || null, gerencia_id: p?.gerencia_id || null, servicio_id: servicioDeProyecto(p),
        hh_lu: 0, hh_ma: 0, hh_mi: 0, hh_ju: 0, hh_vi: 0, hh_sa: 0, hh_do: 0, hh_total: 0, extra: {} };
    },
    derivar: derivarActividad,
    claseFila: a => restriccionesActivas(a.id, estado.rests).length ? 'fila-aviso' : '',
    alGuardar: () => cargarSilencioso(),
    menuFila: a => [
      { label: '🚧 Restricciones…', action: () => a.id && abrirRestricciones(a, { alCambiar: recargar }) },
      { label: '💬 Comentarios y enlaces…', action: () => a.id && abrirDetalle('actividad', a, { alCambiar: n => { estado.colab.set(a.id, n); grilla.refrescar(); } }) },
    ],
  });
  grilla.listo.then(() => grilla.tabla.setGroupBy('semana'));
  desuscribir.push(api.subscribe(['actividades', 'restricciones'], ev => {
    if (ev.tabla === 'actividades') grilla.aplicarRemoto(ev, filtroFila);
    cargarSilencioso();
  }));
  desuscribir.push(on('proyecto', () => pintar()));
  await cargar();
}

export function destruir() { desuscribir.forEach(f => f && f()); desuscribir = []; grilla?.destruir(); }

function filtroFila(a) {
  if (!estado.semanas.includes(a.semana)) return false;
  if (estado.resp !== 'todos' && a.responsable_id !== estado.resp) return false;
  if (!enProyectoSel(a.proyecto_id)) return false;
  return true;
}

async function cargar() {
  await leer();
  await grilla.inicializar(estado.acts.filter(filtroFila));
  aplicarVistaGrupos(grilla, { forzar: true });
  if (!grilla.tabla.options.groupBy) grilla.tabla.setGroupBy('semana');
  pintarCabecera();
}
async function leer() {
  const area = store.area.id;
  const [acts, rests, ubic, colab] = await Promise.all([
    api.list('actividades', { eq: { area_id: area }, gte: { semana: estado.semanas[0] }, lte: { semana: estado.semanas.at(-1) }, order: [['orden', true]] }),
    api.list('restricciones', { eq: { area_id: area }, neq: { estado: 'levantada' } }),
    api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: estado.semanas[0] }, lte: { fecha: sumarDias(estado.semanas.at(-1), 6) } }),
    conteoColaboracion(),   // columna 💬, igual que en el Plan semanal
  ]);
  Object.assign(estado, { acts, rests, ubic });
  estado.colab.clear();
  for (const [id, n] of colab) estado.colab.set(id, n);
}
async function cargarSilencioso() { try { await leer(); pintarCabecera(); grilla.refrescar(); } catch { /* reintento en el próximo cambio */ } }
async function recargar() { await cargarSilencioso(); }
async function pintar() { await grilla.setDatos(estado.acts.filter(filtroFila)); aplicarVistaGrupos(grilla); pintarCabecera(); }

function pintarCabecera() {
  const pag = document.querySelector('#contenido');
  if (!pag) return;
  pag.querySelector('[data-proy]').innerHTML = (haySeleccion() ? `<span class="chip-filtro">🏗 ${esc(nombreSeleccion())}</span>` : '')
    + avisoSinGrupo(estado.acts.filter(a => estado.semanas.includes(a.semana) && (estado.resp === 'todos' || a.responsable_id === estado.resp)));
  const personas = estado.resp === 'todos' ? equipo(estado.acts) : lideres().filter(l => l.id === estado.resp);
  let sobrecargas = 0;
  const filas = personas.map(l => {
    const celdas = estado.semanas.map(s => {
      const hh = estado.acts.filter(a => a.responsable_id === l.id && a.semana === s && a.estado_la !== 'cancelada').reduce((x, a) => x + (Number(a.hh_total) || 0), 0);
      const cap = capacidadSemana(l.id, s, estado.ubic);
      const r = cap ? hh / cap : null;
      if (r != null && r > 1.05) sobrecargas++;
      return `<td><div style="display:flex;align-items:center;gap:6px"><div class="barra-prog" style="flex:1;--bc:${colorCarga(r)}"><i style="width:${Math.min(100, (r || 0) * 100)}%"></i></div>
        <span class="nota" style="white-space:nowrap">${num(hh)} / ${num(cap)} ${r != null && r > 1.05 ? '⚠' : ''}</span></div></td>`;
    }).join('');
    return `<tr><td>${esc(l.nombre)}</td>${celdas}</tr>`;
  }).join('');
  pag.querySelector('[data-carga]').innerHTML = `<table class="simple"><tr><th>Responsable</th>${estado.semanas.map(s => `<th>${esc(etiquetaSemana(s))}</th>`).join('')}</tr>${filas}</table>
    <p class="nota">Verde: carga normal · Ámbar: más del 90 % · Rojo: sobrecarga (más que la capacidad). La capacidad descuenta vacaciones y feriados registrados en "Equipo y capacidad".</p>`;
  // Aviso en la pestaña: cuántas semanas-persona están sobrecargadas
  const alerta = pag.querySelector('[data-alerta]');
  if (alerta) { alerta.textContent = sobrecargas ? `⚠ ${sobrecargas}` : ''; alerta.title = sobrecargas ? `${sobrecargas} semana(s) con sobrecarga` : ''; }
}

const acciones = {
  async cet() {   // pedido 100: CET / Servicio nuevo sin salir del Look Ahead
    const id = await (await import('./proyectos.js')).nuevoCETServicio({ proyectoId: store.proyectoSel || null });
    if (id) grilla.refrescar();
  },
  async comprometer() {
    const siguiente = estado.semanas[0];
    const sel = grilla.tabla.getRanges().flatMap(r => r.getRows()).map(r => r.getData()).filter(a => a.id);
    let cands = (sel.length ? sel : estado.acts.filter(filtroFila).filter(a => ['lista', 'trasladada'].includes(a.estado_la)))
      .filter(a => a.semana === siguiente && !a.comprometida && puedeEditarActividad(a));
    if (!cands.length) return toast(`Seleccione filas de la ${etiquetaSemana(siguiente)} o marque actividades como "Lista" o "Trasladada al plan".`, 'info');
    if (!await confirmarRestricciones(cands, estado.rests)) return;
    let n = 0;
    for (const a of cands) {
      try { await api.update('actividades', a.id, { comprometida: true, estado_la: 'trasladada', tipo: 'programada' }); n++; }
      catch (e) { error(mensajeError(e)); }
    }
    ok(`${n} actividad(es) comprometidas para la ${etiquetaSemana(siguiente)}.`);
    await cargar();
  },

  async plantilla() {
    const plantillas = await api.list('plantillas', { eq: { area_id: store.area.id, tipo: 'servicio', activa: true } });
    if (!plantillas.length) return toast('No hay plantillas de servicio. Créelas en "Plantillas".', 'info');
    const d = await pedirDatos({
      titulo: 'Aplicar plantilla de servicio', texto: 'Generar actividades',
      campos: [
        { name: 'plantilla', label: 'Plantilla', type: 'select', required: true, options: plantillas.map(p => ({ value: p.id, label: p.nombre })) },
        { name: 'proyecto', label: 'Grupo LPS', type: 'select', required: true, options: opcionesGrupos(), value: store.proyectoSel },
        { name: 'responsable', label: 'Responsable', type: 'select', required: true, options: opcionesLideres(), value: estado.resp !== 'todos' ? estado.resp : store.usuario.id },
        { name: 'semana', label: 'Semana de inicio', type: 'select', required: true, options: estado.semanas.map(s => ({ value: s, label: etiquetaSemana(s) })) },
      ],
    });
    if (!d) return;
    if (d.responsable !== store.usuario.id && !esGestor()) return error('Solo puede generar actividades para usted.');
    const items = await api.list('plantilla_items', { eq: { plantilla_id: d.plantilla }, order: [['orden', true]] });
    const p = proyecto(d.proyecto);
    const pl = plantillas.find(x => x.id === d.plantilla);
    // CET / Servicio de cada actividad: el del ítem; si no tiene, el de la plantilla o el del proyecto
    const servicio = i => i.servicio_id || pl?.servicio_id || servicioDeProyecto(p);
    try {
      await api.insert('actividades', items.map((i, k) => ({
        area_id: store.area.id, semana: sumarSemanas(d.semana, Number(i.semana_offset) || 0), responsable_id: d.responsable,
        comprometida: false, tipo: 'programada', estado: 'programado', estado_la: 'pendiente', origen: 'plantilla', origen_id: i.id,
        proyecto_id: d.proyecto, gerencia_id: p?.gerencia_id || i.gerencia_id, cet_id: i.cet_id, servicio_id: servicio(i),
        descripcion: i.descripcion, resp2: i.resp2, orden: k,
        ...Object.fromEntries(DIAS.map(x => [`hh_${x}`, Number(i[`hh_${x}`]) || 0])),
      })));
      ok(`${items.length} actividad(es) generadas. Las que caen fuera del horizonte del Look Ahead se verán al avanzar las semanas.`);
      await cargar();
    } catch (e) { error(mensajeError(e)); }
  },

  async cartera() {
    const resp = estado.resp !== 'todos' ? estado.resp : store.usuario.id;
    const items = (await api.list('cartera', { eq: { area_id: store.area.id }, in: { estado: ['abierta', 'en_proceso'] } }))
      .filter(c => c.responsable_id === resp || (esGestor() && estado.resp === 'todos'));
    if (!items.length) return toast('No hay elementos abiertos en la cartera.', 'info');
    const cuerpo = html(`<div><div class="campo"><label>Semana</label><select class="sel" data-sem>${estado.semanas.map(s => `<option value="${s}">${esc(etiquetaSemana(s))}</option>`).join('')}</select></div>
      <table class="simple" style="margin-top:8px"><tr><th></th><th>Responsable</th><th>Solicitud</th><th>Proyecto</th><th>F. comprometida</th></tr>
      ${items.map(c => `<tr><td><input type="checkbox" value="${c.id}"></td><td>${esc(nombre(c.responsable_id))}</td><td>${esc(c.descripcion)}</td>
        <td>${esc(proyecto(c.proyecto_id)?.nombre_corto || '')}</td><td>${c.f_comprometida || ''}</td></tr>`).join('')}</table></div>`);
    modal({ titulo: 'Crear actividades desde la cartera', cuerpo, ancho: 860, botones: [{ texto: 'Cancelar' }, { texto: 'Crear actividades', clase: 'btn-primario', accion: async () => {
      const ids = [...cuerpo.querySelectorAll('input:checked')].map(i => i.value);
      const semana = cuerpo.querySelector('[data-sem]').value;
      const sel = items.filter(c => ids.includes(c.id));
      if (!sel.length) return false;
      try {
        await api.insert('actividades', sel.map(c => ({
          area_id: store.area.id, semana, responsable_id: c.responsable_id || resp, resp2: c.resp2, ...destinoActividad(c.proyecto_id),
          gerencia_id: c.gerencia_id, servicio_id: c.servicio_id, descripcion: c.descripcion, comprometida: false, tipo: 'programada',
          estado: 'programado', estado_la: 'pendiente', origen: 'cartera', origen_id: c.id, cartera_id: c.id,
        })));
        for (const c of sel.filter(c => c.estado === 'abierta')) await api.update('cartera', c.id, { estado: 'en_proceso' }).catch(() => {});
        ok(`${sel.length} actividad(es) creadas en el Look Ahead.`);
        await cargar();
      } catch (e) { error(mensajeError(e)); return false; }
    } }] });
  },

  pdf() {
    const acts = grilla.filas().filter(a => a.id).sort((a, b) => a.semana.localeCompare(b.semana));
    let cuerpo = '';
    for (const s of estado.semanas) {
      const de = acts.filter(a => a.semana === s);
      // Mismas columnas, orden y anchos que la grilla en pantalla (más el detalle de restricciones)
      cuerpo += `<h2>${esc(etiquetaSemana(s))} · ${de.length} actividad(es)</h2>` + tablaPDF([
        ...grilla.columnasPDF(),
        { titulo: 'Restricciones', ancho: 180, valor: a => restriccionesActivas(a.id, estado.rests).map(r => r.descripcion).join('; ') },
      ], de);
    }
    imprimirPDF('Look Ahead', cuerpo, { orientacion: 'landscape' });
  },
};
