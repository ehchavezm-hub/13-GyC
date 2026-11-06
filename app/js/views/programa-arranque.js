// Programa de Arranque (CR-PG-SGP-01-F1): checklist de 74 ítems con tracking semanal.
import { medir } from '../core/monitoreo.js';
import { api, mensajeError } from '../data/api.js';
import { store, esGestor, esAdmin, puede, enProyectoSel, haySeleccion, nombreSeleccion } from '../core/store.js';
import { esc, html, fmtFecha } from '../core/util.js';
import { toast, error as mostrarError, confirmar, pedirDatos } from '../ui/ui.js';

let estado = { programa: null, items: [], detalle: new Map(), numSemanas: 8 };

export async function render(el, _params) {
  el.innerHTML = '';
  if (!haySeleccion()) {
    el.innerHTML = `<div class="aviso-vacio"><p>Selecciona un proyecto para ver el Programa de Arranque.</p></div>`;
    return;
  }

  const wrap = html(`<div class="pagina-arr">
    <div class="pagina-cab">
      <h1>Programa de Arranque</h1>
      <span data-proy class="proy-badge"></span>
      <span class="flex"></span>
      <button class="btn btn-sm" data-a="config" title="Configurar cabecera">⚙ Configurar</button>
    </div>
    <div data-cab-info class="arr-cab-info"></div>
    <div data-kpis class="kpis"></div>
    <div data-filtros class="arr-filtros"></div>
    <div data-tabla class="arr-tabla-wrap"></div>
  </div>`);
  el.append(wrap);

  wrap.querySelector('[data-proy]').textContent = nombreSeleccion();
  wrap.querySelector('[data-a="config"]').addEventListener('click', configurarCabecera);

  await cargar();
  pintarCabInfo(wrap);
  pintarKpis(wrap);
  pintarFiltros(wrap);
  pintarTabla(wrap);
}

// ── Carga de datos ────────────────────────────────────────────────────────────

async function cargar() {
  const proyId = store.proyectoSel?.id;
  if (!proyId) return;

  const stop = medir('programa-arranque.cargar');
  try {
    const [items, programas] = await Promise.all([
      api.list('programa_arranque_items', { order: [['orden', true]] }),
      api.list('programa_arranque', { eq: { proyecto_id: proyId } }),
    ]);

    estado.items = items;

    if (!programas.length) {
      // Auto-crear instancia vacía para este proyecto
      const [nuevo] = await api.insert('programa_arranque', {
        proyecto_id: proyId,
        num_semanas: 8,
      });
      estado.programa = nuevo;
    } else {
      estado.programa = programas[0];
    }

    estado.numSemanas = estado.programa.num_semanas || 8;

    const detalles = await api.list('programa_arranque_detalle', {
      eq: { programa_id: estado.programa.id },
    });

    estado.detalle = new Map(detalles.map(d => [d.item_codigo, d]));
  } catch (e) {
    mostrarError(mensajeError(e));
  } finally {
    stop();
  }
}

// ── Cabecera informativa ──────────────────────────────────────────────────────

function pintarCabInfo(wrap) {
  const p = estado.programa;
  if (!p) return;
  wrap.querySelector('[data-cab-info]').innerHTML = `
    <div class="arr-cab-fields">
      <span><b>CR / Proyecto:</b> ${esc(p.cr_proyecto || '—')}</span>
      <span><b>Inicio movilización:</b> ${p.fecha_movilizacion ? fmtFecha(p.fecha_movilizacion) : '—'}</span>
      <span><b>Inicio construcción:</b> ${p.fecha_construccion ? fmtFecha(p.fecha_construccion) : '—'}</span>
      <span><b>Actualización:</b> ${p.fecha_actualizacion ? fmtFecha(p.fecha_actualizacion) : '—'}</span>
      <span><b>Semanas:</b> ${estado.numSemanas}</span>
    </div>`;
}

// ── KPIs semanales (PAC) ──────────────────────────────────────────────────────

function calcularKpis() {
  const kpis = [];
  for (let s = 0; s < estado.numSemanas; s++) {
    let planeadas = 0, completadas = 0;
    for (const item of estado.items) {
      const det = estado.detalle.get(item.item_codigo);
      const semanas = det?.semanas || [];
      const sem = semanas[s] || {};
      if (sem.plan) planeadas++;
      if (sem.cumplio) completadas++;
    }
    const pac = planeadas > 0 ? Math.round(completadas / planeadas * 100) : null;
    kpis.push({ semana: s + 1, planeadas, completadas, pac });
  }
  return kpis;
}

function pintarKpis(wrap) {
  const kpis = calcularKpis();
  const totalItems = estado.items.length;
  const totalConFecha = [...estado.detalle.values()].filter(d => d.fecha_plan).length;

  wrap.querySelector('[data-kpis]').innerHTML = `
    <div class="kpi-tile"><span class="kpi-val">${totalItems}</span><span class="kpi-lbl">Ítems totales</span></div>
    <div class="kpi-tile"><span class="kpi-val">${totalConFecha}</span><span class="kpi-lbl">Con fecha plan</span></div>
    ${kpis.map(k => `
      <div class="kpi-tile kpi-semana" title="Semana ${k.semana}: ${k.completadas}/${k.planeadas} completadas">
        <span class="kpi-val ${k.pac === null ? '' : k.pac >= 80 ? 'verde' : k.pac >= 50 ? 'naranja' : 'rojo'}">${k.pac === null ? '—' : k.pac + '%'}</span>
        <span class="kpi-lbl">S${k.semana} PAC</span>
        <span class="kpi-sub">${k.completadas}/${k.planeadas}</span>
      </div>`).join('')}`;
}

// ── Filtros ───────────────────────────────────────────────────────────────────

function pintarFiltros(wrap) {
  const procesos = [...new Set(estado.items.map(i => i.proceso))].sort();
  wrap.querySelector('[data-filtros]').innerHTML = `
    <label>Proceso:
      <select data-filtro-proceso class="sel">
        <option value="">Todos</option>
        ${procesos.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
      </select>
    </label>
    <label>
      <input type="checkbox" data-filtro-oblig> Solo obligatorios
    </label>`;

  wrap.querySelector('[data-filtro-proceso]').addEventListener('change', () => pintarTabla(wrap));
  wrap.querySelector('[data-filtro-oblig]').addEventListener('change', () => pintarTabla(wrap));
}

// ── Tabla principal ───────────────────────────────────────────────────────────

function pintarTabla(wrap) {
  const proceso = wrap.querySelector('[data-filtro-proceso]')?.value || '';
  const soloOblig = wrap.querySelector('[data-filtro-oblig]')?.checked || false;

  const items = estado.items.filter(i =>
    (!proceso || i.proceso === proceso) &&
    (!soloOblig || i.obligatorio)
  );

  const colsSemanas = Array.from({ length: estado.numSemanas }, (_, i) => i);

  const thead = `<tr>
    <th class="col-item">Ítem</th>
    <th class="col-proceso">Proceso</th>
    <th class="col-area">Área Líder</th>
    <th class="col-oblig" title="Obligatorio">Oblig.</th>
    <th class="col-desc">Descripción</th>
    <th class="col-resp">Responsable</th>
    <th class="col-fp">F. Plan</th>
    <th class="col-fr">F. Real</th>
    <th class="col-com">Comentarios</th>
    ${colsSemanas.map(s => `<th class="col-sem" colspan="2">S${s + 1}</th>`).join('')}
  </tr>
  <tr class="subhead">
    <th colspan="9"></th>
    ${colsSemanas.map(() => `<th class="col-plan" title="Planeado">Plan</th><th class="col-cum" title="Cumplió">Cum.</th>`).join('')}
  </tr>`;

  const tbody = items.map(item => {
    const det = estado.detalle.get(item.item_codigo) || {};
    const semanas = det.semanas || [];
    const fondo = item.obligatorio ? '' : 'row-opc';

    const semanaCols = colsSemanas.map(s => {
      const sem = semanas[s] || {};
      return `
        <td class="col-plan">
          <input type="checkbox" class="chk" data-item="${esc(item.item_codigo)}" data-sem="${s}" data-tipo="plan" ${sem.plan ? 'checked' : ''}>
        </td>
        <td class="col-cum">
          <input type="checkbox" class="chk" data-item="${esc(item.item_codigo)}" data-sem="${s}" data-tipo="cumplio" ${sem.cumplio ? 'checked' : ''}>
        </td>`;
    }).join('');

    return `<tr class="${fondo}" data-item-row="${esc(item.item_codigo)}">
      <td class="col-item">${esc(item.item_codigo)}</td>
      <td class="col-proceso">${esc(item.proceso)}</td>
      <td class="col-area">${esc(item.area_lider)}</td>
      <td class="col-oblig">${item.obligatorio ? '✔' : ''}</td>
      <td class="col-desc">${esc(item.descripcion)}</td>
      <td class="col-resp" data-editable data-campo="responsable">${esc(det.responsable || '')}</td>
      <td class="col-fp"  data-editable data-campo="fecha_plan">${det.fecha_plan ? fmtFecha(det.fecha_plan) : ''}</td>
      <td class="col-fr"  data-editable data-campo="fecha_real">${det.fecha_real ? fmtFecha(det.fecha_real) : ''}</td>
      <td class="col-com" data-editable data-campo="comentarios">${esc(det.comentarios || '')}</td>
      ${semanaCols}
    </tr>`;
  }).join('');

  const tableWrap = wrap.querySelector('[data-tabla]');
  tableWrap.innerHTML = `<div class="arr-tabla-scroll">
    <table class="arr-tabla">
      <thead>${thead}</thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>`;

  tableWrap.addEventListener('change', onCheckChange);
  tableWrap.addEventListener('dblclick', onCeldaDobleClick);
}

// ── Edición inline ────────────────────────────────────────────────────────────

function onCheckChange(e) {
  const chk = e.target.closest('.chk');
  if (!chk) return;
  const itemCodigo = chk.dataset.item;
  const semIdx = parseInt(chk.dataset.sem, 10);
  const tipo = chk.dataset.tipo;
  const valor = chk.checked;
  guardarSemana(itemCodigo, semIdx, tipo, valor);
}

async function guardarSemana(itemCodigo, semIdx, tipo, valor) {
  const det = estado.detalle.get(itemCodigo) || {};
  const semanas = [...(det.semanas || [])];
  while (semanas.length <= semIdx) semanas.push({});
  semanas[semIdx] = { ...semanas[semIdx], [tipo]: valor };

  try {
    const [guardado] = await api.upsert('programa_arranque_detalle', {
      programa_id: estado.programa.id,
      item_codigo: itemCodigo,
      semanas,
    }, 'programa_id,item_codigo');

    estado.detalle.set(itemCodigo, { ...det, ...guardado });
  } catch (e) {
    mostrarError(mensajeError(e));
  }
}

function onCeldaDobleClick(e) {
  const td = e.target.closest('[data-editable]');
  if (!td) return;
  if (td.querySelector('input,textarea')) return;

  const fila = td.closest('[data-item-row]');
  const itemCodigo = fila?.dataset.itemRow;
  const campo = td.dataset.campo;
  if (!itemCodigo || !campo) return;

  const valorActual = estado.detalle.get(itemCodigo)?.[campo] || '';
  const esFecha = campo.startsWith('fecha');

  td.innerHTML = esFecha
    ? `<input type="date" class="cel-input" value="${valorActual}">`
    : `<input type="text" class="cel-input" value="${esc(valorActual)}" placeholder="${campo}">`;

  const inp = td.querySelector('input');
  inp.focus();
  inp.select?.();
  inp.addEventListener('blur', () => guardarCampo(itemCodigo, campo, inp.value, td));
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') inp.blur();
    if (ev.key === 'Escape') {
      inp.value = valorActual;
      inp.blur();
    }
  });
}

async function guardarCampo(itemCodigo, campo, valor, td) {
  const det = estado.detalle.get(itemCodigo) || {};
  const valFinal = valor.trim() || null;

  try {
    const [guardado] = await api.upsert('programa_arranque_detalle', {
      programa_id: estado.programa.id,
      item_codigo: itemCodigo,
      [campo]: valFinal,
    }, 'programa_id,item_codigo');

    estado.detalle.set(itemCodigo, { ...det, ...guardado });
  } catch (e) {
    mostrarError(mensajeError(e));
    td.textContent = det[campo] || '';
    return;
  }

  if (campo.startsWith('fecha')) {
    td.textContent = valFinal ? fmtFecha(valFinal) : '';
  } else {
    td.textContent = valFinal || '';
  }
}

// ── Configurar cabecera ───────────────────────────────────────────────────────

async function configurarCabecera() {
  if (!esGestor() && !esAdmin()) {
    toast('Solo los gestores pueden configurar la cabecera.', 'warn');
    return;
  }
  const p = estado.programa;
  const campos = await pedirDatos('Configurar Programa de Arranque', [
    { id: 'cr_proyecto',       label: 'CR / Proyecto',              type: 'text', value: p.cr_proyecto || '' },
    { id: 'fecha_movilizacion', label: 'Fecha inicio movilización', type: 'date', value: p.fecha_movilizacion || '' },
    { id: 'fecha_construccion', label: 'Fecha inicio construcción', type: 'date', value: p.fecha_construccion || '' },
    { id: 'fecha_actualizacion', label: 'Fecha actualización',      type: 'date', value: p.fecha_actualizacion || '' },
    { id: 'num_semanas',       label: 'Número de semanas (4-20)',    type: 'number', value: estado.numSemanas },
  ]);
  if (!campos) return;

  const numSem = Math.max(4, Math.min(20, parseInt(campos.num_semanas, 10) || 8));
  try {
    const [actualizado] = await api.update('programa_arranque', p.id, {
      cr_proyecto: campos.cr_proyecto || null,
      fecha_movilizacion: campos.fecha_movilizacion || null,
      fecha_construccion: campos.fecha_construccion || null,
      fecha_actualizacion: campos.fecha_actualizacion || null,
      num_semanas: numSem,
    });
    estado.programa = actualizado;
    estado.numSemanas = numSem;

    // Re-pintar todo
    const el = document.querySelector('#contenido');
    if (el) render(el, {});
    else toast('Configuración guardada. Recarga para ver cambios.');
  } catch (e) {
    mostrarError(mensajeError(e));
  }
}
