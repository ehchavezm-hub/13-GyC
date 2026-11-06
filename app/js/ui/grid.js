// Grilla tipo Excel (6.4 del alcance) basada en Tabulator:
// selección de rangos, copiar/pegar desde y hacia Excel, rellenar, deshacer/rehacer, insertar/duplicar/
// eliminar filas, agrupar con subtotales, filtrar, ordenar, mostrar/ocultar/mover/fijar columnas,
// vistas guardadas, guardado automático por celda y cambios de otros usuarios en tiempo real.
import { api, mensajeError } from '../data/api.js';
import { store, etiqueta, esGestor, puede, cargarCatalogo } from '../core/store.js';
import { esc, html, normalizar, parseFecha, fmtFecha, num, debounce, libExcel } from '../core/util.js';
import { toast, error, confirmar, modal } from './ui.js';
import { nombreArchivo } from '../services/pdf.js';

const SOLO_LOCAL = k => k.startsWith('_');
// Vistas de cada grilla en memoria: al volver a una pantalla no se vuelven a pedir al servidor
const cacheVistas = new Map();
function pedirVistas(grillaId) {
  if (!grillaId || !store.area) return Promise.resolve([]);
  const clave = `${store.area.id}|${grillaId}`;
  if (!cacheVistas.has(clave)) {
    cacheVistas.set(clave, api.list('vistas', { eq: { grilla: grillaId, area_id: store.area.id } })
      .catch(() => { cacheVistas.delete(clave); return []; }));
  }
  return cacheVistas.get(clave);
}

/**
 * Editor de texto de varias líneas (como en Excel): la caja crece hacia abajo mientras se escribe,
 * Enter guarda, Alt+Enter o Shift+Enter agregan una línea, Esc cancela.
 */
function editorTextoLargo(cell, onRendered, success, cancel) {
  const caja = document.createElement('textarea');
  caja.value = cell.getValue() ?? '';
  caja.rows = 1;
  caja.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:4px;border:0;outline:none;resize:none;' +
    'white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;font:inherit;line-height:1.35;background:#fff;align-self:stretch;';
  // La celda puede dejar de existir mientras se escribe (p. ej. la fila se actualizó con datos del servidor):
  // entonces no se ajusta la altura, pero lo escrito se guarda igual
  const elementoCelda = () => { try { const e = cell.getElement(); return e instanceof Element ? e : null; } catch { return null; } };
  const crecer = () => {
    caja.style.height = 'auto';
    const celda = elementoCelda();
    const h = Math.max(caja.scrollHeight, celda ? celda.clientHeight - 2 : 0);
    caja.style.height = h + 'px';
    // Tabulator pone height inline en celda y en fila; hay que pisar ambos.
    // La celda tiene overflow:hidden que recorta el textarea aunque la fila crezca.
    if (celda) { celda.style.height = h + 'px'; celda.style.overflow = 'visible'; }
    const fila = celda?.closest('.tabulator-row');
    if (fila) {
      fila.style.height = h + 'px'; fila.style.overflow = 'visible';
      // En tablas agrupadas (Look Ahead, Plan Semanal con agrupación) el contenedor de grupo
      // también tiene overflow recortado — hay que quitarlo para que la fila crezca visualmente.
      const grupo = fila.closest('.tabulator-row-group');
      if (grupo) { grupo.style.overflow = 'visible'; }
    }
    try { cell.checkHeight(); } catch { /* no disponible */ }
  };
  const limpiarFila = () => {
    const celda = elementoCelda();
    if (celda) { celda.style.height = ''; celda.style.overflow = ''; }
    const fila = celda?.closest('.tabulator-row');
    if (fila) {
      fila.style.height = ''; fila.style.overflow = '';
      const grupo = fila.closest('.tabulator-row-group');
      if (grupo) { grupo.style.overflow = ''; }
    }
  };
  let listo = false;
  const guardar = () => { if (listo) return; listo = true; try { limpiarFila(); } catch { /* solo estética */ } success(caja.value); };
  caja.addEventListener('input', crecer);
  caja.addEventListener('blur', guardar);
  caja.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.altKey || e.shiftKey)) {
      e.preventDefault(); e.stopPropagation();
      const i = caja.selectionStart, f = caja.selectionEnd;
      caja.setRangeText('\n', i, f, 'end');
      crecer();
    } else if (e.key === 'Enter') {
      e.preventDefault(); guardar();
    } else if (e.key === 'Escape') {
      listo = true; try { limpiarFila(); } catch { /* solo estética */ } cancel();
    } else if (e.key !== 'Tab') {
      e.stopPropagation();   // flechas, Inicio, Fin… se mueven dentro del texto (Tab sigue pasando a la celda siguiente)
    }
  });
  onRendered(() => {
    crecer();
    caja.focus({ preventScroll: true }); caja.setSelectionRange(caja.value.length, caja.value.length);
    // Se vuelve a medir cuando el navegador terminó de dibujar la celda (antes el ancho puede no ser el final)
    requestAnimationFrame(crecer); setTimeout(crecer, 60);
  });
  return caja;
}

// Globo de ayuda para las opciones de las listas desplegables (data-ayuda): aparece al pasar el mouse
if (!window.__lpsgtAyudaOpciones) {
  window.__lpsgtAyudaOpciones = true;
  let globo = null;
  const quitar = () => { globo?.remove(); globo = null; };
  document.addEventListener('mouseover', e => {
    const item = e.target.closest?.('[data-ayuda]');
    if (!item) return quitar();
    if (globo?.dataset.de === item.dataset.ayuda) return;
    quitar();
    globo = document.createElement('div');
    globo.className = 'globo-ayuda'; globo.dataset.de = item.dataset.ayuda; globo.textContent = item.dataset.ayuda;
    document.body.append(globo);
    const r = item.getBoundingClientRect(), g = globo.getBoundingClientRect();
    const izq = r.right + 8 + g.width < innerWidth ? r.right + 8 : Math.max(8, r.left - g.width - 8);
    globo.style.left = izq + 'px'; globo.style.top = Math.min(innerHeight - g.height - 8, Math.max(8, r.top)) + 'px';
  });
  document.addEventListener('mousedown', quitar, true);
  document.addEventListener('keydown', quitar, true);
}

// Tabulator enfoca celdas y la tabla al hacer clic; el navegador desplazaba entonces la página para mostrar el elemento
// enfocado y el segundo clic de un doble clic (o el clic derecho) caía en otra fila. Dentro de una grilla, enfocar
// nunca desplaza la página: Tabulator ya se encarga de mostrar la celda activa dentro de su propio scroll.
if (!HTMLElement.prototype.focus.__lpsgt) {
  const enfocar = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (opciones) {
    return enfocar.call(this, this.closest?.('.tabulator') ? { ...(opciones || {}), preventScroll: true } : opciones);
  };
  HTMLElement.prototype.focus.__lpsgt = true;
}

function opcionesDe(col, fila) {
  const o = typeof col.opciones === 'function' ? col.opciones(fila) : col.opciones;
  return o || [];
}
function etiquetaOpcion(col, v, fila) {
  if (v == null || v === '') return '';
  const o = opcionesDe(col, fila).find(x => String(x.value) === String(v));
  if (o) return o.label;
  // Valor que ya no está entre las opciones (p. ej. proyecto desactivado): se sigue mostrando su nombre
  const pr = store.proyectos.find(x => x.id === v);
  if (pr) return `${pr.codigo} · ${pr.nombre_corto}${pr.estado === 'cerrado' ? ' (desactivado)' : ''}`;
  return col.tipo === 'lista' ? etiqueta(v) : String(v);
}
/** Texto visible de un HTML de celda (para el PDF): "<span class=badge>Solicitud</span>" → "Solicitud". */
function textoHTML(h) {
  if (h == null) return '';
  const t = document.createElement('template');
  t.innerHTML = String(h);
  return t.content.textContent.trim();
}
/**
 * Columna de una tabla PDF a partir de la definición de una columna de grilla: mismo título, texto que la celda
 * (incluidas las columnas calculadas que se dibujan con "formato") y el ancho dado.
 * La usan el botón PDF de cada pantalla y el módulo Reportes, para que ambos coincidan con la pantalla.
 */
export function definicionPDF(c, ancho = c.ancho || 100) {
  if (!c || c.pdf === false || c.click) return null;   // botones (🚧, 💬, Ficha…) no van al PDF
  const valorDe = fila => (c.valor ? c.valor(fila) : fila[c.field]);
  const texto = fila => {
    const v = valorDe(fila);
    if (c.exportar) return c.exportar(v, fila);
    if (c.formato && !c.colorear) return textoHTML(c.formato(v, fila));
    if (c.tipo === 'lista') return etiquetaOpcion(c, v, fila);
    if (c.tipo === 'fecha') return fmtFecha(v);
    if (c.tipo === 'casilla') return v ? 'Sí' : '';
    if (c.tipo === 'numero') return v === 0 && c.ocultarCero ? '' : (v == null || v === '' ? '' : num(v, 2));
    return v ?? '';
  };
  const color = fila => (opcionesDe(c, fila).find(o => o.value === valorDe(fila)) || {}).color;
  return {
    titulo: c.title, ancho, num: c.tipo === 'numero', fecha: c.tipo === 'fecha' && !c.exportar && !c.formato,
    html: !!c.colorear,
    valor: c.colorear
      ? fila => { const t = texto(fila); const k = color(fila); return t ? `<span class="badge" style="--c:${k || '#4E79A7'}">${esc(t)}</span>` : ''; }
      : texto,
  };
}
/** Convierte el texto pegado o escrito al valor que guarda la columna. */
function convertir(col, texto, fila) {
  if (texto == null) return null;
  if (typeof texto !== 'string') return texto;
  const t = texto.trim();
  switch (col.tipo) {
    case 'numero': {
      if (t === '') return col.vacioCero ? 0 : null;
      const n = Number(t.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
      return isNaN(n) ? (col.vacioCero ? 0 : null) : n;
    }
    case 'fecha': return t ? parseFecha(t) : null;
    case 'casilla': return ['1', 'si', 'sí', 'x', 'true', 'verdadero'].includes(normalizar(t));
    case 'lista': {
      if (!t) return null;
      const ops = opcionesDe(col, fila);
      const n = normalizar(t);
      // Coincide con el texto mostrado, o con el nombre completo o el código del valor (p. ej. "GOC" o "Gerencia de Obras Civiles")
      const valorDe = x => store.valores.get(x.value);
      const o = ops.find(x => x.value != null && (String(x.value) === t || normalizar(x.label) === n))
        || ops.find(x => x.value != null && valorDe(x) && (normalizar(valorDe(x).valor) === n || normalizar(valorDe(x).codigo || '') === n))
        || ops.find(x => x.value != null && normalizar(x.label).startsWith(n))
        || ops.find(x => x.value != null && n.length >= 3 && normalizar(x.label).includes(n));
      return o ? o.value : undefined;   // undefined = no reconocido
    }
    default: return t;
  }
}

/** Analiza texto copiado de Excel (TSV con comillas). */
export function parseTSV(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  const s = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '"' && s[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"' && campo === '') comillas = true;
    else if (c === '\t') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  while (filas.length && filas[filas.length - 1].every(x => x === '')) filas.pop();
  return filas;
}

// Cambios sin guardar de todas las grillas abiertas: si hay alguno, el navegador pide confirmar antes de cerrar la página
const registroPendientes = new Map();
let contadorGrillas = 0;
window.addEventListener('beforeunload', e => {
  if ([...registroPendientes.values()].some(n => n > 0)) { e.preventDefault(); e.returnValue = ''; }
});

export function crearGrilla(contenedor, cfg) {
  const registroId = ++contadorGrillas;
  const vistasPedidas = pedirVistas(cfg.id);   // en paralelo con los datos de la pantalla
  const columnasCfg = cfg.columnas.filter(Boolean);
  const porCampo = new Map(columnasCfg.map(c => [c.field, c]));
  const servidor = new Map();              // id → copia de la fila tal como está guardada
  let guardando = false;
  let pendiente = false;
  // ---------- Sincronización segura (como las apps «offline primero») ----------
  // · Cada fila nueva lleva un identificador creado aquí (_cid) que se envía como id: si un envío se repite (reintento),
  //   el servidor responde «ya existe» y se toma como guardada: no hay duplicados.
  // · Cada envío tiene tiempo límite: si la red se cuelga, se libera y se reintenta solo (5 s, 10 s, 20 s… hasta 60 s),
  //   y también al volver la conexión. Un envío colgado ya no bloquea los siguientes.
  // · Si falla por la red, el cambio se conserva (no se revierte) y queda guardado en el navegador hasta enviarse.
  const LIMITE_MS = Number(window.GYC_LIMITE_GUARDADO_MS) || 20000;   // configurable solo para pruebas
  const nuevoCid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const conLimite = p => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('TIEMPO_AGOTADO')), LIMITE_MS))]);
  const esDeRed = e => /Failed to fetch|NetworkError|Load failed|TIEMPO_AGOTADO|network|fetch/i.test(String(e?.message || e || ''));
  const esDuplicado = e => /duplicate key|23505|ya existe un registro/i.test(String(e?.message || e?.code || e || ''));
  let intentos = 0, temporizadorReintento = null, avisoRedMostrado = false;
  function reintentarLuego() {
    clearTimeout(temporizadorReintento);
    const ms = Math.min(60000, 5000 * 2 ** intentos++);
    temporizadorReintento = setTimeout(() => programarGuardado(), ms);
  }
  const alVolverConexion = () => { intentos = 0; programarGuardado(); };
  window.addEventListener('online', alVolverConexion);

  const editableCampo = (fila, col) => {
    if (!col || col.calc || col.editable === false) return false;
    if (cfg.puedeEditarFila && !cfg.puedeEditarFila(fila)) return false;
    if (typeof col.editable === 'function') return col.editable(fila);
    return true;
  };

  // ---------- Barra de herramientas ----------
  const raiz = html(`<div class="grilla">
    <div class="grilla-barra">
      ${cfg.puedeCrear === false ? '' : '<button class="btn btn-primario btn-sm" data-a="nueva" title="Agregar fila (Ctrl+Enter)">＋ Fila</button>'}
      ${cfg.puedeCrear === false ? '' : '<button class="btn btn-sm" data-a="pegar" title="Pegar varias filas copiadas desde Excel">📋 Pegar filas de Excel</button>'}
      <button class="btn btn-sm" data-a="rellenar" title="Copia el valor de la primera celda seleccionada a las demás (Ctrl+D)">⬇ Rellenar</button>
      <button class="btn btn-sm" data-a="deshacer" title="Deshacer (Ctrl+Z)">↶</button>
      <button class="btn btn-sm" data-a="rehacer" title="Rehacer (Ctrl+Y)">↷</button>
      <span class="sep"></span>
      <label class="grilla-agrupar">Agrupar <select data-a="agrupar"><option value="">—</option>
        ${(cfg.agrupar || []).map(g => `<option value="${g.field}">${esc(g.label)}</option>`).join('')}</select></label>
      <button class="btn btn-sm" data-a="columnas" title="Mostrar, ocultar y fijar columnas">▥ Columnas</button>
      <button class="btn btn-sm" data-a="vistas" title="Vistas guardadas">👁 Vista</button>
      <input class="grilla-buscar" type="search" placeholder="Buscar…" aria-label="Buscar en la grilla">
      <span class="grilla-estado" aria-live="polite"></span>
      <span class="flex"></span>
      ${cfg.extraBarra || ''}
      <button class="btn btn-sm" data-a="excel" title="Exportar a Excel">⬇ Excel ▾</button>
    </div>
    <div class="grilla-tabla"></div>
    <div class="grilla-ayuda">Doble clic o Enter para editar · Alt+Enter: nueva línea en Actividad · Selecciona un rango con el mouse o Shift+flechas · Ctrl+C / Ctrl+V con Excel · Supr borra · Clic derecho en una fila para más opciones, o en el título de Gerencia, Proyecto o Servicio para editar sus opciones</div>
  </div>`);
  contenedor.innerHTML = '';
  contenedor.append(raiz);
  const estadoEl = raiz.querySelector('.grilla-estado');
  const setEstado = t => { estadoEl.textContent = t; };
  // Cambios que aún no llegan al servidor (filas nuevas con contenido y ediciones pendientes)
  function contarPendientes() {
    let n = 0;
    for (const row of tabla.getRows()) {
      const d = row.getData();
      if (!d.id) { if (!cfg.listaParaCrear || cfg.listaParaCrear(d)) n++; }
      else if (servidor.has(d.id)) { const dif = diferencias(d); if (dif && Object.keys(dif).length) n++; }
    }
    return n;
  }
  function pintarPendientes(n = contarPendientes()) {
    registroPendientes.set(registroId, n);
    if (!n) { if (/sin guardar/.test(estadoEl.textContent)) setEstado(''); return; }
    estadoEl.innerHTML = `<span class="grilla-pendientes" title="Estos cambios aún no llegan al servidor. Se reintenta solo; no cierre la página.">⚠ ${n} sin guardar</span>
      <button class="btn btn-xs" data-a="reintentar" title="Enviar ahora">Reintentar</button>`;
  }

  // ---------- Acceso directo para editar las opciones de una columna de lista ----------
  // Clic derecho en el título de Gerencia, Proyecto, CET / Servicio o CNC lleva a donde se editan sus opciones.
  const DESTINOS = {
    gerencia_id: { lista: 'gerencias', texto: 'gerencias' }, servicio_id: { lista: 'servicios', texto: 'CET / Servicio' },
    cnc_id: { lista: 'cnc', texto: 'causas de no cumplimiento (CNC)' },
    fase_id: { lista: 'fases', texto: 'fases' }, pais_id: { lista: 'paises', texto: 'países' },
    proyecto_id: { ruta: '#/config/listas?lista=__proyectos', rutaSinConfig: '#/proyectos', texto: 'proyectos / procesos' },
  };
  function menuTitulo(c) {
    const d = c.editarEn || DESTINOS[c.field === '_cet' ? 'servicio_id' : c.field] || (c.lista ? { lista: c.lista, texto: c.title } : null);
    if (!d) return null;
    const items = [];
    // CET / Servicio: los líderes con "agregar_cet" agregan uno nuevo sin salir de la grilla (pedido 100)
    if (d.lista === 'servicios' && (esGestor())) {
      items.push({ label: '＋ Agregar CET / Servicio…', action: async () => {
        const id = await (await import('../views/proyectos.js')).nuevoCETServicio({ proyectoId: store.proyectoSel || null });
        if (id) tabla.getRows().forEach(r => r.reformat());
      } });
    }
    // Proyecto / Proceso: el formulario de proyecto nuevo se abre aquí mismo
    if (d.ruta && (esGestor() || puede('crear_cartera'))) {
      items.push({ label: `＋ ${esGestor() ? 'Agregar' : 'Proponer'} proyecto…`, action: async () => {
        await (await import('../views/proyectos.js')).formularioProyecto();
        tabla.getRows().forEach(r => r.reformat());
      } });
    }
    const permitido = esGestor();
    if (permitido) {
      const ruta = (d.rutaSinConfig && !esGestor() ? d.rutaSinConfig : d.ruta) || `#/config/listas?lista=${encodeURIComponent(d.lista)}`;
      items.push({ label: `✎ ${d.ruta && !esGestor() ? 'Agregar' : 'Agregar, editar o eliminar'} ${esc(d.texto)}`, action: () => { location.hash = ruta; } });
    }
    return items.length ? items : null;
  }

  // ---------- Valores pegados que no existen en una lista ----------
  // pend: [{ row, col, texto }]. Si la columna tiene una lista editable, se ofrece agregarlos y completar las celdas.
  const listaDe = c => (c.editarEn || DESTINOS[c.field] || (c.lista ? { lista: c.lista } : null))?.lista;
  async function agregarDesconocidos(pend) {
    if (!pend.length) return;
    const sinLista = pend.filter(x => !listaDe(x.col) || !store.listas[listaDe(x.col)]);
    const conLista = pend.filter(x => !sinLista.includes(x));
    if (sinLista.length) {
      toast(`${sinLista.length} valor(es) no coinciden con las opciones de ${[...new Set(sinLista.map(x => x.col.title))].join(', ')} y se omitieron.`, 'warn', 7000);
    }
    if (!conLista.length) return;
    const porLista = new Map();
    for (const x of conLista) {
      const clave = listaDe(x.col);
      if (!porLista.has(clave)) porLista.set(clave, { titulo: x.col.title, textos: new Set() });
      porLista.get(clave).textos.add(x.texto.trim());
    }
    const resumen = [...porLista.values()].map(g => `${g.titulo}: ${[...g.textos].join(', ')}`).join(' · ');
    const puedeAgregar = () => esGestor();
    if (![...porLista.keys()].every(puedeAgregar)) {
      toast(`Estos valores no existen en las listas y se omitieron (pida al administrador que los agregue): ${resumen}`, 'warn', 9000);
      return;
    }
    if (!await confirmar(`Estos valores no existen en las listas: ${resumen}. ¿Agregarlos a las listas y completar las celdas?`,
      { titulo: 'Valores nuevos en las listas', texto: 'Agregar a las listas' })) return;
    try {
      for (const [clave, g] of porLista) {
        const lista = store.listas[clave].lista;
        let orden = Math.max(0, ...store.listas[clave].valores.map(v => Number(v.orden) || 0));
        for (const texto of g.textos) {
          orden += 10;
          await api.insert('lista_valores', { lista_id: lista.id, valor: texto, codigo: clave === 'gerencias' && texto.length <= 12 ? texto : null,
            orden, activo: true, extra: {} });
        }
      }
      await cargarCatalogo();
      for (const x of conLista) {
        const v = convertir(x.col, x.texto, x.row.getData());
        if (v === undefined) continue;
        const der = cfg.derivar ? cfg.derivar({ ...x.row.getData(), [x.col.field]: v }, { [x.col.field]: v }) : {};
        x.row.update({ [x.col.field]: v, ...der });
      }
      toast(`Se agregaron ${[...porLista.values()].reduce((n, g) => n + g.textos.size, 0)} valor(es) a las listas.`, 'ok');
      programarGuardado();
    } catch (e) { error(mensajeError(e)); }
  }

  // ---------- Columnas Tabulator ----------
  /** Crea un <select> para el filtro de cabecera de columnas tipo lista */
  function filtroSelectLista(c, val) {
    return (cell, onRendered, success) => {
      const ops = typeof c.opciones === 'function' ? c.opciones() : (c.opciones || []);
      const sel = document.createElement('select');
      sel.style.cssText = 'width:100%;height:100%;border:none;background:transparent;font-size:inherit;padding:0 2px;cursor:pointer';
      const optVacio = document.createElement('option'); optVacio.value = ''; optVacio.textContent = '—'; sel.appendChild(optVacio);
      for (const op of ops) {
        if (op.value == null || op.value === '') continue;
        const o = document.createElement('option'); o.value = String(op.value); o.textContent = op.label ?? ''; sel.appendChild(o);
      }
      sel.addEventListener('change', () => success(sel.value));
      return sel;
    };
  }

  function colTabulator(c) {
    // c.valor(fila): columna cuyo valor se toma de otro campo (p. ej. CET = el servicio de la fila)
    const val = (v, fila) => (c.valor ? c.valor(fila) : v);
    const usarCombo = c.filtro !== false && c.tipo === 'lista' && c.opciones;
    const def = {
      field: c.field, title: c.title, width: c.ancho, minWidth: c.minAncho || 40, frozen: !!c.fijo,
      visible: c.visible !== false, headerSort: c.ordenable !== false, hozAlign: c.align || (c.tipo === 'numero' ? 'right' : 'left'),
      headerTooltip: c.ayuda || c.title, resizable: true,
      editable: cell => editableCampo(cell.getRow().getData(), c),
      headerFilter: c.filtro === false ? false : (usarCombo ? filtroSelectLista(c, val) : 'input'),
      headerFilterPlaceholder: '',
      headerFilterFunc: usarCombo
        ? (term, valor, fila) => !term || String(val(valor, fila) ?? '') === String(term)
        : (term, valor, fila) => {
        const t = normalizar(term);
        const texto = c.tipo === 'lista' ? etiquetaOpcion(c, val(valor, fila), fila) : c.tipo === 'fecha' ? fmtFecha(valor) : String((c.exportar ? c.exportar(valor, fila) : valor) ?? '');
        return normalizar(texto).includes(t);
      },
      accessorClipboard: (v, fila) => c.tipo === 'lista' ? etiquetaOpcion(c, val(v, fila), fila) : c.tipo === 'fecha' ? fmtFecha(v) : c.tipo === 'casilla' ? (v ? 'Sí' : '') : c.exportar ? c.exportar(v, fila) : v,
      accessorDownload: (v, fila) => c.tipo === 'lista' ? etiquetaOpcion(c, val(v, fila), fila) : c.tipo === 'casilla' ? (v ? 'Sí' : 'No') : c.exportar ? c.exportar(v, fila) : v,
    };
    const menuT = menuTitulo(c);
    if (menuT) { def.headerContextMenu = menuT; def.headerTooltip = `${c.ayuda || c.title} · Clic derecho para editar sus opciones`; }
    if (c.total) def.bottomCalc = 'sum', def.bottomCalcFormatter = cell => num(cell.getValue(), 1);
    const clases = [c.clase, c.calc ? 'celda-calc' : ''].filter(Boolean).join(' ');
    if (clases) def.cssClass = clases;
    switch (c.tipo) {
      case 'texto': def.editor = 'input'; break;
      case 'textoLargo': def.editor = editorTextoLargo; def.formatter = 'textarea'; def.variableHeight = true; break;
      case 'numero': def.editor = 'number'; def.editorParams = { step: c.paso || 0.5, min: c.min ?? 0, selectContents: true }; break;
      // Calendario del navegador (aaaa-mm-dd, como se guarda). Con «format», Tabulator exige la librería luxon (no incluida)
      case 'fecha': def.editor = 'date'; break;
      case 'casilla': def.editor = 'tickCross'; def.formatter = 'tickCross'; def.hozAlign = 'center'; break;
      case 'lista':
        def.editor = 'list';
        def.editorParams = cell => {
          // opcionesEdicion: lo que se puede elegir (p. ej. solo 3 estados); opciones: lo que se puede mostrar
          const ops = c.opcionesEdicion ? c.opcionesEdicion(cell.getRow().getData()) : opcionesDe(c, cell.getRow().getData());
          const ayudas = new Map(ops.filter(o => o.ayuda).map(o => [String(o.value), o.ayuda]));
          return {
            values: ops.map(o => ({ label: o.label, value: o.value })),
            autocomplete: true, allowEmpty: true, listOnEmpty: true, clearable: true, freetext: false,
            filterFunc: (term, label) => normalizar(label).includes(normalizar(term)),
            // Significado de cada opción: aparece al pasar el mouse
            itemFormatter: (label, value, item, el) => {
              const a = ayudas.get(String(value));
              if (a && el) { el.dataset.ayuda = a; el.removeAttribute('title'); }
              return esc(label ?? '');
            },
          };
        };

        break;
      default: break;
    }
    if (c.formato) def.formatter = cell => c.formato(cell.getValue(), cell.getRow().getData(), cell);
    else if (c.tipo === 'lista') def.formatter = cell => {
      const v = val(cell.getValue(), cell.getRow().getData());
      const t = etiquetaOpcion(c, v, cell.getRow().getData());
      const op = v != null ? opcionesDe(c, cell.getRow().getData()).find(o => o.value === v) : null;
      // La celda también muestra el significado de su valor al pasar el mouse
      const ayuda = op?.ayuda ? ` data-ayuda="${esc(op.ayuda)}"` : '';
      if (c.colorear && op?.color) return `<span class="badge" style="--c:${op.color}"${ayuda}>${esc(t)}</span>`;
      return ayuda ? `<span${ayuda}>${esc(t)}</span>` : esc(t);
    };
    else if (c.tipo === 'fecha') def.formatter = cell => fmtFecha(cell.getValue());
    else if (c.tipo === 'numero') def.formatter = cell => {
      const v = cell.getValue();
      return v === 0 && c.ocultarCero ? '' : num(v, 2);
    };
    if (c.tipo === 'lista' || c.formato) def.sorter = (a, b, ra, rb) => {
      const x = normalizar(c.tipo === 'lista' ? etiquetaOpcion(c, val(a, ra.getData()), ra.getData()) : c.exportar ? c.exportar(a, ra.getData()) : a);
      const y = normalizar(c.tipo === 'lista' ? etiquetaOpcion(c, val(b, rb.getData()), rb.getData()) : c.exportar ? c.exportar(b, rb.getData()) : b);
      return x > y ? 1 : x < y ? -1 : 0;
    };
    if (c.click) def.cellClick = (e, cell) => c.click(cell.getRow().getData(), e, cell);
    return def;
  }

  // ---------- Pegado (rango) ----------
  function parserPegado(texto) {
    const datos = parseTSV(texto);
    const rango = tabla.getRanges?.()[0];
    if (!datos.length || !rango) return false;
    const celdas = rango.getCells?.() || [];
    const primera = celdas[0]?.[0] || celdas[0];
    const colInicio = primera?.getColumn ? primera.getColumn() : null;
    const visibles = tabla.getColumns().filter(c => c.isVisible());
    const idx = Math.max(0, visibles.indexOf(colInicio));
    const filasTabla = tabla.getRows('active');
    const filaInicio = primera?.getRow ? filasTabla.indexOf(primera.getRow()) : 0;
    return { datos, columnas: visibles.slice(idx), filaInicio: Math.max(0, filaInicio) };
  }

  function accionPegado(p) {
    if (!p) return [];
    const filasTabla = tabla.getRows('active');
    let omitidas = 0, nuevas = 0;
    const tocadas = [];
    const sobrantes = [];
    const pend = [];
    p.datos.forEach((valores, i) => {
      const fila = filasTabla[p.filaInicio + i];
      if (fila) aplicarValores(fila, p.columnas, valores);
      else if (cfg.puedeCrear !== false) sobrantes.push(valores);
    });
    if (sobrantes.length && bloqueado()) sobrantes.length = 0;
    if (sobrantes.length) {
      (async () => {
        for (const valores of sobrantes) {
          const fila = await tabla.addRow({ ...(cfg.nuevaFila?.() || {}), _nueva: true }, false);
          aplicarValores(fila, p.columnas, valores, true);
          nuevas++;
        }
        toast(`${nuevas} fila(s) nuevas agregadas desde el portapapeles.`, 'ok');
        programarGuardado();
        await agregarDesconocidos(pend);
      })();
    }
    function aplicarValores(fila, columnas, valores, esNueva = false) {
      const datos = fila.getData();
      const cambios = {};
      valores.forEach((texto, j) => {
        const colT = columnas[j];
        if (!colT) return;
        if (esNueva && !String(texto ?? '').trim()) return;   // fila nueva: una celda vacía no borra el valor por defecto
        const col = porCampo.get(colT.getField());
        if (!editableCampo(datos, col)) { omitidas++; return; }
        const v = convertir(col, texto, { ...datos, ...cambios });
        if (v === undefined) { pend.push({ row: fila, col, texto }); return; }
        cambios[col.field] = v;
      });
      if (Object.keys(cambios).length) {
        const derivados = cfg.derivar ? cfg.derivar({ ...datos, ...cambios }, cambios) : {};
        fila.update({ ...cambios, ...derivados });
        tocadas.push(fila);
      }
    }
    if (omitidas) toast(`${omitidas} celda(s) no editables se omitieron.`, 'warn');
    if (!sobrantes.length) agregarDesconocidos(pend);
    programarGuardado();
    return tocadas;
  }

  // ---------- Tabulator ----------
  const tabla = new window.Tabulator(raiz.querySelector('.grilla-tabla'), {
    data: [],
    index: 'id',
    // alturaAuto: la grilla crece con sus filas, sin barra vertical propia (varias grillas en una página).
    // Un alto máximo hacía que las barras horizontal y vertical se activaran por turnos y la grilla "saltara".
    ...(cfg.alturaAuto ? {} : { height: cfg.altura || 'calc(100vh - 260px)' }),
    layout: 'fitDataStretch',
    columnDefaults: { headerHozAlign: 'left', tooltip: false },
    columns: columnasCfg.map(colTabulator),
    selectableRange: 1,
    // Al redibujarse (p. ej. otra grilla de la página cambia de alto) Tabulator recreaba la selección y tomaba el foco,
    // interrumpiendo la edición en otra grilla. El foco solo cambia cuando el usuario hace clic.
    selectableRangeAutoFocus: false,
    groupUpdateOnCellEdit: true,   // al cambiar el campo agrupado (p. ej. la semana) la fila pasa a su grupo
    selectableRangeColumns: true,
    selectableRangeRows: true,
    selectableRangeClearCells: true,
    selectableRangeFill: true,
    editTriggerEvent: 'dblclick',
    clipboard: true,
    clipboardCopyStyled: false,
    clipboardCopyConfig: { rowHeaders: false, columnHeaders: false, columnCalcs: false, rowGroups: false },
    clipboardCopyRowRange: 'range',
    clipboardPasteParser: parserPegado,
    clipboardPasteAction: accionPegado,
    history: true,
    movableColumns: true,
    headerSortClickElement: 'icon',
    rowHeader: { resizable: false, frozen: true, width: 36, hozAlign: 'center', formatter: 'rownum', cssClass: 'col-numero', headerSort: false },
    placeholder: cfg.vacio || 'Sin filas. Use "＋ Fila" o pegue desde Excel.',
    groupStartOpen: true,
    groupHeader: (valor, cantidad, datos) => {
      const g = porCampo.get(tabla.options.groupBy);
      const t = g ? (g.formatoGrupo ? g.formatoGrupo(valor, datos[0]) : g.tipo === 'lista' ? etiquetaOpcion(g, valor, datos[0]) : g.tipo === 'fecha' ? fmtFecha(valor) : valor) : valor;
      const hh = datos.reduce((s, d) => s + (Number(d.hh_total) || 0), 0);
      return `${esc(t || '(vacío)')} <span class="grupo-info">${cantidad} fila(s)${hh ? ` · ${num(hh)} HH` : ''}</span>`;
    },
    rowFormatter: row => {
      const d = row.getData();
      const el = row.getElement();
      el.classList.toggle('fila-ajena', !!cfg.puedeEditarFila && !cfg.puedeEditarFila(d));
      el.classList.toggle('fila-nueva', !d.id);
      if (cfg.claseFila) {
        el.dataset.clase && el.classList.remove(...el.dataset.clase.split(' ').filter(Boolean));
        const cl = cfg.claseFila(d) || '';
        el.dataset.clase = cl;
        if (cl) el.classList.add(...cl.split(' ').filter(Boolean));
      }
    },
    rowContextMenu: (e, row) => menuFila(row),
    locale: 'es',
    langs: { es: { data: { loading: 'Cargando', error: 'Error' }, groups: { item: 'fila', items: 'filas' },
      pagination: {}, headerFilters: { default: 'filtrar…' } } },
  });

  // ---------- Guardado automático ----------
  // Normaliza "" a null en campos no-texto: Tabulator devuelve "" al limpiar un list-editor;
  // La base rechaza "" en columnas UUID con "invalid input syntax for type uuid: ''".
  const camposDB = fila => Object.fromEntries(
    Object.entries(fila)
      .filter(([k]) => !SOLO_LOCAL(k) && !porCampo.get(k)?.calc && !(cfg.camposCalc || []).includes(k))
      .map(([k, v]) => {
        const col = porCampo.get(k);
        if (v === '' && col && col.tipo !== 'texto' && col.tipo !== 'textoLargo') return [k, null];
        return [k, v];
      })
  );

  function diferencias(fila) {
    const prev = servidor.get(fila.id);
    if (!prev) return null;
    const dif = {};
    for (const [k, v] of Object.entries(camposDB(fila))) {
      if (JSON.stringify(v ?? null) !== JSON.stringify(prev[k] ?? null)) dif[k] = v;
    }
    return dif;
  }

  const programarGuardado = debounce(async () => { await guardar(); guardarBorradores(); guardarCambiosPendientes(); pintarPendientes(); }, 350);

  // Filas nuevas aún sin datos (no se guardan en la base hasta tener contenido): se conservan al recargar
  // la grilla o la página, por usuario, grilla y pantalla (p. ej. cada semana del Plan).
  const claveBorradores = () => (cfg.id && store.usuario ? `gyc-borradores:${store.usuario.id}:${cfg.id}:${location.hash.split('&')[0]}` : null);
  const limpiarFila = d => Object.fromEntries(Object.entries(d).filter(([k]) => !['_guardando', '_nueva'].includes(k)));
  function filasSinGuardar() { return tabla.getRows().map(r => r.getData()).filter(d => !d.id); }
  function guardarBorradores() {
    const k = claveBorradores(); if (!k) return;
    try {
      const filas = filasSinGuardar().map(limpiarFila);
      if (filas.length) localStorage.setItem(k, JSON.stringify(filas)); else localStorage.removeItem(k);
    } catch { /* sin almacenamiento local */ }
  }
  function leerBorradores() {
    try { return JSON.parse(localStorage.getItem(claveBorradores()) || '[]'); } catch { return []; }
  }
  // Ediciones de filas ya guardadas que aún no llegan al servidor: { id: { cambios, base } } (base = valores del servidor
  // antes del cambio; al reaplicarlas se verifica que nadie más haya cambiado esos campos)
  const claveCambios = () => (claveBorradores() ? claveBorradores() + ':cambios' : null);
  function guardarCambiosPendientes() {
    const k = claveCambios(); if (!k) return;
    try {
      const pend = {};
      for (const row of tabla.getRows()) {
        const d = row.getData();
        if (!d.id || !servidor.has(d.id)) continue;
        const dif = diferencias(d);
        if (dif && Object.keys(dif).length) {
          const prev = servidor.get(d.id);
          pend[d.id] = { cambios: dif, base: Object.fromEntries(Object.keys(dif).map(c => [c, prev[c] ?? null])) };
        }
      }
      if (Object.keys(pend).length) localStorage.setItem(k, JSON.stringify(pend)); else localStorage.removeItem(k);
    } catch { /* sin almacenamiento local */ }
  }
  function reaplicarCambiosPendientes() {
    let pend = {};
    try { pend = JSON.parse(localStorage.getItem(claveCambios()) || '{}'); } catch { return; }
    let aplicados = 0, conflicto = 0;
    for (const [id, { cambios, base }] of Object.entries(pend)) {
      const row = tabla.getRow(id), prev = servidor.get(id);
      if (!row || !prev) continue;
      const libres = Object.fromEntries(Object.entries(cambios).filter(([c]) => JSON.stringify(prev[c] ?? null) === JSON.stringify(base?.[c] ?? null)));
      conflicto += Object.keys(cambios).length - Object.keys(libres).length;
      if (Object.keys(libres).length) { row.update(libres); aplicados++; }
    }
    if (conflicto) toast(`${conflicto} cambio(s) pendiente(s) no se aplicaron porque otra persona modificó esos datos mientras tanto.`, 'warn', 8000);
    return aplicados;
  }

  async function guardar() {
    if (guardando) { pendiente = true; return; }
    guardando = true;
    let fallasDeRed = 0;
    try {
      const filas = tabla.getRows();
      let n = 0;
      for (const row of filas) {
        const d = row.getData();
        // Valores no permitidos (p. ej. relleno sobre celdas de otro): se revierten
        if (d.id && servidor.has(d.id)) {
          let dif = diferencias(d);
          if (!dif || !Object.keys(dif).length) continue;
          const prev = servidor.get(d.id);
          // Cambios que no pasaron por la edición de celda (p. ej. arrastrar la esquina para rellenar): se aplican las
          // mismas reglas de la fila (p. ej. «Trasladada al plan» compromete la actividad)
          if (cfg.derivar) {
            const der = cfg.derivar({ ...d }, dif, { antes: prev }) || {};
            const extra = Object.fromEntries(Object.entries(der).filter(([k, v]) => !SOLO_LOCAL(k) && JSON.stringify(v ?? null) !== JSON.stringify(d[k] ?? null)));
            if (Object.keys(extra).length) { row.update(extra); dif = diferencias(row.getData()) || {}; }
          }
          const revertir = {};
          for (const k of Object.keys(dif)) {
            const col = porCampo.get(k) || porCampo.get(k.split('.')[0]);
            if (k !== 'extra' && col && !editableCampo(prev, col)) revertir[k] = prev[k];
          }
          if (Object.keys(revertir).length) { row.update(revertir); for (const k of Object.keys(revertir)) delete dif[k]; }
          if (!Object.keys(dif).length) continue;
          for (const [k, v] of Object.entries(dif)) if (v === '' && porCampo.get(k)?.tipo !== 'texto' && porCampo.get(k)?.tipo !== 'textoLargo') dif[k] = null;
          setEstado('Guardando…');
          try {
            const res = await conLimite(cfg.actualizar ? cfg.actualizar(d, dif) : api.update(cfg.tabla, d.id, dif));
            servidor.set(res.id, structuredClone(res));
            row.update(res);
            n++;
          } catch (e) {
            // Falla de red o sin respuesta: el cambio se conserva y se reintenta. Rechazo del servidor: se revierte.
            if (esDeRed(e)) { fallasDeRed++; continue; }
            error(mensajeError(e));
            const prevFila = servidor.get(d.id);
            row.update(prevFila);
          }
        } else if (!d.id && !d._guardando) {
          if (cfg.listaParaCrear && !cfg.listaParaCrear(d)) continue;
          // Identificador de la fila creado aquí: el mismo en cada reintento (sin duplicados)
          const cid = d._cid || nuevoCid();
          row.update({ _guardando: true, _cid: cid });
          setEstado('Guardando…');
          try {
            const datos = camposDB(row.getData());
            datos.id = cid;
            let res;
            try {
              [res] = await conLimite(cfg.crear ? cfg.crear(datos) : api.insert(cfg.tabla, datos));
            } catch (e) {
              // «Ya existe»: un envío anterior sí llegó (p. ej. se cortó la respuesta). Se toma la fila guardada.
              if (!esDuplicado(e)) throw e;
              [res] = await conLimite(api.list(cfg.tabla, { eq: { id: cid } }));
              if (!res) throw e;
            }
            servidor.set(res.id, structuredClone(res));
            row.update({ ...res, _guardando: false, _nueva: false });
            reformatear(row);   // columnas calculadas que dependen del id (p. ej. "Ficha ›")
            n++;
          } catch (e) {
            row.update({ _guardando: false });
            if (esDeRed(e)) { fallasDeRed++; continue; }
            error(mensajeError(e));
          }
        }
      }
      if (fallasDeRed) {
        if (!avisoRedMostrado) { toast('Sin conexión con el servidor: sus cambios se conservan en este equipo y se enviarán solos al volver la conexión. No cierre la página.', 'warn', 9000); avisoRedMostrado = true; }
        reintentarLuego();
      } else { intentos = 0; avisoRedMostrado = false; clearTimeout(temporizadorReintento); }
      setEstado(n ? '✓ Guardado' : '');
      if (n) cfg.alGuardar?.();
      setTimeout(() => { if (estadoEl.textContent === '✓ Guardado') setEstado(''); }, 2500);
    } finally {
      guardando = false;
      if (pendiente) { pendiente = false; programarGuardado(); }
    }
  }

  // No se redibuja la fila que se está editando: se perdería lo que el usuario está escribiendo
  // (se redibuja sola al terminar la edición, en cellEdited)
  function reformatear(row) { if (!row.getElement()?.querySelector('.tabulator-editing')) row.reformat(); }

  tabla.on('cellEdited', cell => {
    const col = porCampo.get(cell.getField());
    const fila = cell.getRow();
    let v = cell.getValue();
    if (col?.tipo === 'numero' && (v === '' || v == null) && col.vacioCero) { v = 0; cell.setValue(0, false); }
    if (cfg.derivar) {
      // antes: valor anterior de la celda (p. ej. el CET que tenía la fila, para conservar su proyecto; r1)
      const der = cfg.derivar(fila.getData(), { [cell.getField()]: v }, { antes: { [cell.getField()]: cell.getOldValue() } });
      if (der && Object.keys(der).length) fila.update(der);
    }
    fila.reformat();
    programarGuardado();
    cfg.alEditar?.(fila.getData(), cell.getField());
  });
  tabla.on('dataChanged', () => programarGuardado());
  // Al filtrar (títulos de columna o buscador), la pantalla puede recalcular lo que depende de lo visible (p. ej. indicadores)
  tabla.on('dataFiltered', () => setTimeout(() => cfg.alFiltrar?.(), 0));
  tabla.on('historyUndo', () => programarGuardado());
  tabla.on('historyRedo', () => programarGuardado());

  // ---------- Teclado: escribir para editar, Enter, Ctrl+D, Ctrl+Enter ----------
  raiz.querySelector('.grilla-tabla').addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,.tabulator-edit-list')) return;
    const rango = tabla.getRanges()[0];
    const celda = rango?.getCells?.()?.[0]?.[0];
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); rellenar(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); nuevaFila(); return; }
    if (!celda) return;
    // Supr / Retroceso sobre un rango: Tabulator vacía las celdas sin pasar por «derivar». Las columnas que toman su valor de
    // otro campo (CET, Proyecto) no se guardan solas: se aplica aquí la misma regla que al elegir «—» (auditoría 3)
    if ((e.key === 'Delete' || e.key === 'Backspace') && cfg.derivar) {
      let cambio = false;
      for (const c of rango.getCells().flat()) {
        const col = porCampo.get(c.getField());
        const fila = c.getRow();
        if (!col?.valor || !editableCampo(fila.getData(), col)) continue;
        const der = cfg.derivar(fila.getData(), { [c.getField()]: null });
        if (der && Object.keys(der).length) { fila.update(der); cambio = true; }
      }
      if (cambio) programarGuardado();
    }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); celda.edit(true); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const col = porCampo.get(celda.getField());
      if (!editableCampo(celda.getRow().getData(), col) || col.tipo === 'casilla') return;
      e.preventDefault();
      celda.edit(true);
      setTimeout(() => {
        const inp = celda.getElement().querySelector('input,textarea');
        if (inp) { inp.value = e.key; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      }, 0);
    }
  });

  // ---------- Acciones ----------
  function filasSeleccionadas() {
    const set = new Set();
    for (const r of tabla.getRanges()) for (const row of r.getRows()) set.add(row);
    return [...set];
  }

  // Bloqueo momentáneo para crear filas (p. ej. sin un Grupo LPS elegido): cfg.bloqueoCrear() devuelve el motivo o nada
  const bloqueado = () => { const m = cfg.bloqueoCrear?.(); if (m) toast(m, 'warn'); return !!m; };
  async function nuevaFila(posicion, referencia) {
    if (cfg.puedeCrear === false || bloqueado()) return;
    const base = { ...(cfg.nuevaFila?.() || {}), _nueva: true };
    if (referencia) {
      const ref = referencia.getData();
      base.orden = (Number(ref.orden) || 0) + (posicion === 'arriba' ? -0.5 : 0.5);
    }
    const row = await tabla.addRow(base, posicion === 'arriba', referencia);
    tabla.scrollToRow(row, 'center', false).catch(() => {});
    const primera = (cfg.campoInicial && porCampo.get(cfg.campoInicial)) ||
      columnasCfg.find(c => editableCampo(row.getData(), c) && c.visible !== false && (c.tipo === 'texto' || c.tipo === 'textoLargo'));
    if (primera) setTimeout(() => {
      const celda = row.getCell(primera.field);
      if (!celda) return;
      tabla.addRange?.(celda, celda);
      celda.edit(true);
    }, 80);
    programarGuardado();
  }

  async function duplicar(rows) {
    for (const r of rows) {
      const d = camposDB(r.getData());
      delete d.id; delete d.created_at; delete d.updated_at;
      await tabla.addRow({ ...d, ...(cfg.alDuplicar?.(d) || {}), _nueva: true }, false, r);
    }
    programarGuardado();
  }

  async function eliminar(rows) {
    const propias = rows.filter(r => !cfg.puedeEditarFila || cfg.puedeEditarFila(r.getData()));
    if (!propias.length) return toast('No tiene permiso para eliminar esas filas.', 'warn');
    if (!await confirmar(`¿Eliminar ${propias.length} fila(s)? Esta acción no se puede deshacer.`, { texto: 'Eliminar', peligro: true })) return;
    for (const r of propias) {
      const d = r.getData();
      try {
        // cfg.eliminar puede devolver false: no se eliminó (p. ej. se desactivó en su lugar) y la fila se conserva
        if (d.id && (await (cfg.eliminar ? cfg.eliminar(d) : api.remove(cfg.tabla, d.id))) === false) continue;
        servidor.delete(d.id);
        await r.delete();
      } catch (e) { error(mensajeError(e)); }
    }
    // Tras borrar, Tabulator deja la vista descuadrada una fila (el siguiente clic caía en la fila de abajo): se reconstruye
    tabla.redraw(true);
    cfg.alGuardar?.();
  }

  function rellenar() {
    const rango = tabla.getRanges()[0];
    if (!rango) return;
    const filas = rango.getRows();
    const cols = rango.getColumns();
    if (filas.length < 2) return toast('Seleccione un rango de varias filas para rellenar hacia abajo.', 'info');
    for (const colT of cols) {
      const col = porCampo.get(colT.getField());
      const valor = filas[0].getData()[colT.getField()];
      for (const f of filas.slice(1)) {
        if (editableCampo(f.getData(), col)) {
          const der = cfg.derivar ? cfg.derivar({ ...f.getData(), [col.field]: valor }, { [col.field]: valor }) : {};
          f.update({ [col.field]: valor, ...der });
        }
      }
    }
    programarGuardado();
  }

  function menuFila(row) {
    const items = [
      { label: '＋ Insertar fila arriba', action: () => nuevaFila('arriba', row), disabled: cfg.puedeCrear === false },
      { label: '＋ Insertar fila abajo', action: () => nuevaFila('abajo', row), disabled: cfg.puedeCrear === false },
      { label: '⧉ Duplicar fila(s)', action: () => duplicar(filasSeleccionadas().length ? filasSeleccionadas() : [row]), disabled: cfg.puedeCrear === false },
      { label: '⬇ Rellenar hacia abajo', action: rellenar },
      ...(cfg.menuFila ? cfg.menuFila(row.getData(), row) : []),
      { separator: true },
      { label: '🗑 Eliminar fila(s)', action: () => eliminar(filasSeleccionadas().length > 1 ? filasSeleccionadas() : [row]) },
    ];
    return items;
  }

  function dialogoPegar() {
    const cols = tabla.getColumns().filter(c => c.isVisible() && porCampo.has(c.getField()) && !porCampo.get(c.getField()).calc);
    // Columna de la grilla que corresponde a un título del Excel (por nombre, campo o alias)
    const colPorTitulo = t => cols.find(c => normalizar(c.getDefinition().title) === t || normalizar(c.getField()) === t ||
      (porCampo.get(c.getField())?.alias || []).some(x => normalizar(x) === t)) || null;
    const esCabecera = fila => fila.filter(t => colPorTitulo(normalizar(t))).length >= 2;
    const cuerpo = html(`<div>
      <p>Copie la tabla en Excel (Ctrl+C) y péguela aquí (Ctrl+V). <b>Incluya la fila de títulos</b> para que cada columna vaya a su lugar
        aunque el orden sea distinto. Sin títulos, las columnas se asignan en este orden:</p>
      <p class="nota">${cols.map(c => esc(c.getDefinition().title)).join(' · ')}</p>
      <label class="chk"><input type="checkbox" data-cab> La primera fila tiene títulos (se detecta sola)</label>
      <textarea rows="10" class="pegar-area" placeholder="Pegue aquí…"></textarea>
      <div class="pegar-previa nota"></div></div>`);
    const area = cuerpo.querySelector('textarea');
    const previa = cuerpo.querySelector('.pegar-previa');
    const chkCab = cuerpo.querySelector('[data-cab]');
    area.addEventListener('input', () => {
      const d = parseTSV(area.value);
      if (!d.length) { previa.textContent = ''; return; }
      if (esCabecera(d[0])) chkCab.checked = true;
      const cab = chkCab.checked ? d[0] : null;
      const asignacion = cab
        ? cab.map(t => { const c = colPorTitulo(normalizar(t)); return `${t || '(vacío)'} → ${c ? c.getDefinition().title : 'se ignora'}`; }).join(' · ')
        : d[0].map((_, j) => `col. ${j + 1} → ${cols[j] ? cols[j].getDefinition().title : 'se ignora'}`).join(' · ');
      previa.innerHTML = `<b>${d.length - (cab ? 1 : 0)} fila(s)</b> × ${d[0].length} columna(s). ${esc(asignacion)}`;
    });
    chkCab.addEventListener('change', () => area.dispatchEvent(new Event('input')));
    modal({
      titulo: 'Pegar filas desde Excel', cuerpo, ancho: 820,
      botones: [{ texto: 'Cancelar' }, {
        texto: 'Agregar filas', clase: 'btn-primario', accion: async () => {
          let datos = parseTSV(area.value);
          if (!datos.length) { toast('No hay datos para pegar.', 'warn'); return false; }
          let columnas = cols;
          if (chkCab.checked || esCabecera(datos[0])) columnas = datos.shift().map(t => colPorTitulo(normalizar(t)));
          const pend = [];
          for (const valores of datos) {
            if (!valores.some(v => String(v ?? '').trim())) continue;   // filas vacías
            const fila = await tabla.addRow({ ...(cfg.nuevaFila?.() || {}), _nueva: true }, false);
            const d = fila.getData();
            const cambios = {};
            valores.forEach((texto, j) => {
              const colT = columnas[j];
              if (!colT || !String(texto ?? '').trim()) return;   // celda vacía: se conserva el valor por defecto
              const col = porCampo.get(colT.getField());
              if (!editableCampo({ ...d, ...cambios }, col)) return;
              const v = convertir(col, texto, { ...d, ...cambios });
              if (v === undefined) pend.push({ row: fila, col, texto });
              else cambios[col.field] = v;
            });
            const der = cfg.derivar ? cfg.derivar({ ...d, ...cambios }, cambios) : {};
            fila.update({ ...cambios, ...der });
          }
          programarGuardado();
          toast(`${datos.length} fila(s) agregadas.`, 'ok');
          setTimeout(() => agregarDesconocidos(pend), 50);
        },
      }],
    });
  }

  function dialogoColumnas() {
    const cols = tabla.getColumns().filter(c => c.getField() && porCampo.has(c.getField()));
    const cuerpo = html(`<div class="lista-columnas">${cols.map(c => {
      const d = c.getDefinition();
      return `<div class="fila-col"><label class="chk"><input type="checkbox" data-f="${esc(c.getField())}" ${c.isVisible() ? 'checked' : ''}> ${esc(d.title)}</label>
        <label class="chk peque"><input type="checkbox" data-fijo="${esc(c.getField())}" ${d.frozen ? 'checked' : ''}> fijar</label></div>`;
    }).join('')}</div><p class="nota">También puede arrastrar los títulos de columna para cambiar el orden y sus bordes para cambiar el ancho.</p>`);
    modal({
      titulo: 'Columnas visibles', cuerpo, ancho: 460, botones: [{ texto: 'Cerrar', clase: 'btn-primario', accion: () => {
        for (const inp of cuerpo.querySelectorAll('[data-f]')) {
          const c = tabla.getColumn(inp.dataset.f);
          if (inp.checked) c.show(); else c.hide();
        }
        for (const inp of cuerpo.querySelectorAll('[data-fijo]')) {
          const c = tabla.getColumn(inp.dataset.fijo);
          if (!!c.getDefinition().frozen !== inp.checked) c.updateDefinition({ frozen: inp.checked });
        }
        guardarVistaAuto();
      } }],
    });
  }

  // ---------- Vistas guardadas ----------
  let vistas = [];
  const soloDisposicion = ({ field, width, visible, frozen }) =>
    Object.fromEntries(Object.entries({ field, width, visible, frozen }).filter(([, v]) => v !== undefined));
  const usuarioId = () => store.usuario?.id;
  function estadoVista() {
    return {
      // Solo orden, ancho, visibilidad y fijación: el título lo pone la pantalla (p. ej. "L 26/10" cambia con la semana)
      columnas: tabla.getColumnLayout().map(soloDisposicion),
      orden: tabla.getSorters().map(s => ({ column: s.field, dir: s.dir })),
      agrupar: tabla.options.groupBy || '',
    };
  }
  function aplicarVista(cfgVista) {
    if (!cfgVista) { cfg.alAplicarVista?.(); return; }
    try {
      if (cfgVista.columnas?.length) {
        // Las vistas guardadas antes también traían el título: se descarta y se usa el actual
        // anchoFijo: el ancho lo define la columna (p. ej. días L–D angostos), no la vista guardada
        // visibilidadFija: la visibilidad la decide la pantalla (p. ej. sábado y domingo según el parámetro), no la vista guardada
        // Solo la disposición: las vistas guardadas antes traían también el editor ("input"), que reemplazaba
        // la caja de varias líneas de Actividad y Comentario (no crecía al escribir)
        const conocidas = cfgVista.columnas.filter(c => porCampo.has(c.field)).map(c => {
          c = soloDisposicion(c);
          const def = porCampo.get(c.field);
          if (def.anchoFijo) delete c.width;
          if (def.visibilidadFija) c.visible = def.visible !== false;
          return c;
        });
        // Columnas que no estaban en la vista guardada (p. ej. agregadas en una versión nueva): van en su lugar
        // original, antes de la columna que las sigue, y no al final
        const disposicion = [...conocidas];
        columnasCfg.forEach((c, i) => {
          // Columnas con posición fija: se reubican aunque la vista guardada las tenga en otro lugar
          if (c.posicionFija) { const j = disposicion.findIndex(k => k.field === c.field); if (j >= 0) disposicion.splice(j, 1); }
          if (disposicion.some(k => k.field === c.field)) return;
          const siguiente = columnasCfg.slice(i + 1).find(x => disposicion.some(k => k.field === x.field));
          const pos = siguiente ? disposicion.findIndex(k => k.field === siguiente.field) : disposicion.length;
          disposicion.splice(pos, 0, { field: c.field });
        });
        tabla.setColumnLayout(disposicion);
        ajustarAltos();
      }
      if (cfgVista.orden) tabla.setSort(cfgVista.orden);
      raiz.querySelector('[data-a="agrupar"]').value = cfgVista.agrupar || '';
      tabla.setGroupBy(cfgVista.agrupar || false);
    } catch (e) { console.warn('Vista no aplicable', e); }
    cfg.alAplicarVista?.();   // la pantalla puede reajustar lo que decide ella (p. ej. columna y agrupación por Grupo LPS)
  }
  // Solo se guarda cuando la persona cambia la disposición: antes cada carga de datos (evento dataSorted) la
  // volvía a escribir en la base, y si se adelantaba a cargarVistas creaba filas duplicadas
  let vistasCargadas = false, ultimaGuardada = '';
  const guardarVistaAuto = debounce(async () => {
    if (!store.area || !cfg.id || !vistasCargadas) return;
    const datos = { area_id: store.area.id, usuario_id: usuarioId(), grilla: cfg.id, nombre: '__auto__', config: estadoVista() };
    const firma = JSON.stringify(datos.config);
    if (firma === ultimaGuardada) return;
    ultimaGuardada = firma;
    const ex = vistas.find(v => v.nombre === '__auto__' && v.usuario_id === usuarioId());
    try {
      if (ex) Object.assign(ex, await api.update('vistas', ex.id, { config: datos.config }));
      else vistas.push(...await api.insert('vistas', datos));
    } catch { /* la vista personal no es crítica */ }
  }, 1200);
  async function cargarVistas() {
    if (!cfg.id || !store.area) return;
    vistas = await vistasPedidas;
    const auto = vistas.find(v => v.nombre === '__auto__' && v.usuario_id === usuarioId());
    const estandar = vistas.find(v => v.nombre === '__estandar__' && !v.usuario_id);
    aplicarVista((auto || estandar)?.config);
    ultimaGuardada = JSON.stringify(estadoVista());
    vistasCargadas = true;
  }
  function menuVistas(boton) {
    const propias = vistas.filter(v => v.usuario_id === usuarioId() && !v.nombre.startsWith('__'));
    const estandar = vistas.find(v => v.nombre === '__estandar__' && !v.usuario_id);
    const cuerpo = html(`<div class="menu-vistas">
      ${estandar ? '<button class="btn btn-sm" data-v="estandar">Vista estándar del equipo</button>' : ''}
      ${propias.map(v => `<div class="fila-vista"><button class="btn btn-sm" data-id="${v.id}">${esc(v.nombre)}</button>
        <button class="btn-icono" data-borrar="${v.id}" title="Eliminar vista">✕</button></div>`).join('')}
      <button class="btn btn-sm" data-v="restablecer">Restablecer columnas</button>
      <hr><button class="btn btn-sm btn-primario" data-v="guardar">Guardar vista actual como…</button>
      ${esGestor() ? '<button class="btn btn-sm" data-v="estandarizar">Usar la vista actual como estándar del equipo</button>' : ''}
    </div>`);
    const m = modal({ titulo: 'Vistas de la grilla', cuerpo, ancho: 420 });
    cuerpo.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.id) { aplicarVista(vistas.find(v => v.id === b.dataset.id)?.config); guardarVistaAuto(); m.cerrar(); }
      if (b.dataset.borrar) { await api.remove('vistas', b.dataset.borrar); const i = vistas.findIndex(v => v.id === b.dataset.borrar); if (i >= 0) vistas.splice(i, 1); m.cerrar(); }
      if (b.dataset.v === 'estandar') { aplicarVista(estandar.config); guardarVistaAuto(); m.cerrar(); }
      if (b.dataset.v === 'restablecer') {
        tabla.setColumns(columnasCfg.map(colTabulator)); tabla.clearSort(); tabla.setGroupBy(false);
        raiz.querySelector('[data-a="agrupar"]').value = '';
        guardarVistaAuto(); m.cerrar();
      }
      if (b.dataset.v === 'guardar') {
        const nombre = prompt('Nombre de la vista:');
        if (!nombre) return;
        vistas.push(...await api.insert('vistas', { area_id: store.area.id, usuario_id: usuarioId(), grilla: cfg.id, nombre, config: estadoVista() }));
        toast('Vista guardada.', 'ok'); m.cerrar();
      }
      if (b.dataset.v === 'estandarizar') {
        try {
          if (estandar) Object.assign(estandar, await api.update('vistas', estandar.id, { config: estadoVista() }));
          else vistas.push(...await api.insert('vistas', { area_id: store.area.id, usuario_id: null, grilla: cfg.id, nombre: '__estandar__', config: estadoVista() }));
          toast('Vista estándar del equipo actualizada.', 'ok');
        } catch (err) { error(mensajeError(err)); }
        m.cerrar();
      }
    });
  }

  for (const ev of ['columnMoved', 'columnResized', 'columnVisibilityChanged', 'dataSorted']) tabla.on(ev, () => guardarVistaAuto());

  // ---------- Eventos de barra ----------
  raiz.querySelector('.grilla-barra').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'nueva') nuevaFila();
    if (a === 'reintentar') { intentos = 0; programarGuardado(); }
    if (a === 'pegar') dialogoPegar();
    if (a === 'rellenar') rellenar();
    if (a === 'deshacer') tabla.undo();
    if (a === 'rehacer') tabla.redo();
    if (a === 'columnas') dialogoColumnas();
    if (a === 'vistas') menuVistas(e.target);
    if (a === 'excel') menuExcel(e.target.closest('[data-a="excel"]'));
  });
  raiz.querySelector('[data-a="agrupar"]').addEventListener('change', e => {
    tabla.setGroupBy(e.target.value || false);
    guardarVistaAuto();
  });
  raiz.querySelector('.grilla-buscar').addEventListener('input', debounce(e => {
    const t = normalizar(e.target.value);
    if (!t) return tabla.clearFilter();
    tabla.setFilter(d => columnasCfg.some(c => {
      const v = d[c.field.split('.')[0]];
      const texto = c.tipo === 'lista' ? etiquetaOpcion(c, d[c.field], d) : c.field.includes('.') ? d.extra?.[c.field.split('.')[1]] : v;
      return normalizar(texto).includes(t);
    }));
  }, 250));

  function menuExcel(boton) {
    document.querySelector('.menu-excel-fl')?.remove();

    // Semanas disponibles en los datos activos
    const filasVivas = tabla.getData('active').filter(f => f.id);
    const semanas = [...new Set(filasVivas.map(f => f.semana).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const colSem = porCampo.get('semana');
    const labelSem = s => {
      if (colSem?.tipo === 'lista') return etiquetaOpcion(colSem, s, {}) || `S-${s}`;
      if (colSem?.formato) return textoHTML(colSem.formato(s, {})) || `S-${s}`;
      return `S-${s}`;
    };
    const opsSem = semanas.map(s =>
      `<label class="mex-radio"><input type="radio" name="mex-sem" value="${s}"> ${labelSem(s)}</label>`
    ).join('');

    const div = document.createElement('div');
    div.className = 'menu-excel-fl';
    div.innerHTML = `
      <div class="menu-excel-tit">Período</div>
      <label class="mex-radio"><input type="radio" name="mex-sem" value="" checked> Todas las semanas</label>
      ${opsSem}
      <div class="menu-excel-sep"></div>
      <div class="menu-excel-tit">Agrupar por</div>
      <button data-ag="todo">📊 Todo el equipo</button>
      <button data-ag="resp">👤 Resp. 1</button>
      <button data-ag="gerencia">🏛 Gerencia</button>
      <button data-ag="proyecto">🏗 Proyecto</button>`;
    const r = boton.getBoundingClientRect();
    div.style.cssText = `position:fixed;top:${r.bottom + 4}px;right:${innerWidth - r.right}px`;
    document.body.append(div);

    div.addEventListener('click', e => {
      const btn = e.target.closest('[data-ag]');
      if (!btn) return;
      const ag = btn.dataset.ag;
      const sem = div.querySelector('input[name="mex-sem"]:checked')?.value || null;
      div.remove();
      exportarExcel(ag, sem || null);
    });
    // Cerrar al clic fuera del menú
    setTimeout(() => {
      const cerrar = e => { if (!div.contains(e.target)) { div.remove(); document.removeEventListener('click', cerrar); } };
      document.addEventListener('click', cerrar);
    }, 0);
  }

  async function exportarExcel(agrupacion = 'todo', semFiltro = null) {
    if (cfg.exportar === false) return;
    try { await libExcel(); } catch (e) { error(e.message); return; }
    const XLSX = window.XLSX;

    // Columnas visibles, excluye botones (los que tienen .click o pdf===false)
    const colsDef = tabla.getColumns()
      .filter(col => col.isVisible() && porCampo.has(col.getField()))
      .map(col => porCampo.get(col.getField()))
      .filter(c => !c.click && c.pdf !== false);

    // Valor legible de cada celda; números como Number para que Excel los reconozca
    const valExcel = (c, f) => {
      const v = c.valor ? c.valor(f) : f[c.field];
      if (c.exportar) return c.exportar(v, f);
      if (c.formato && !c.colorear) return textoHTML(c.formato(v, f));
      if (c.tipo === 'lista') return etiquetaOpcion(c, v, f);
      if (c.tipo === 'casilla') return v ? 'Sí' : '';
      if (c.tipo === 'numero') return (v == null || v === '') ? null : +Number(v).toFixed(2) || null;
      return v ?? '';
    };

    // Filas activas, filtradas por período si se eligió uno
    // eslint-disable-next-line eqeqeq
    const filasData = tabla.getData('active').filter(f => f.id && (!semFiltro || f.semana == semFiltro));
    const wb = XLSX.utils.book_new();

    // — Hoja "Datos": todas las columnas, filas del período, con auto-filtro —
    const hdrs = colsDef.map(c => c.title);
    const rows = filasData.map(f => colsDef.map(c => valExcel(c, f)));
    const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
    ws['!autofilter'] = { ref: ws['!ref'] };
    ws['!cols'] = colsDef.map(c => ({ wch: Math.max(8, Math.min(50, (c.ancho || 100) / 7)) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    // — Hoja "Resumen": tabla dinámica pre-calculada agrupada por dimensión —
    const dimMap = {
      resp:     { field: 'responsable_id', label: 'Responsable', titulo: 'Por Responsable' },
      gerencia: { field: 'gerencia_id',    label: 'Gerencia',    titulo: 'Por Gerencia'    },
      proyecto: { field: 'proyecto_id',    label: 'Proyecto',    titulo: 'Por Proyecto'    },
    };
    const dim = dimMap[agrupacion];
    const colDim = dim ? porCampo.get(dim.field) : null;
    const etqFila = f => colDim ? (etiquetaOpcion(colDim, f[dim.field], f) || '(sin asignar)') : 'Total general';
    const tituloRes = dim?.titulo || 'Resumen';
    const labelDim = dim?.label || 'Indicador';

    const grupos = new Map();
    for (const f of filasData) {
      const k = etqFila(f);
      const g = grupos.get(k) || { n: 0, hh: 0 };
      g.n++;
      g.hh += Number(f.hh_total) || 0;
      grupos.set(k, g);
    }
    const totalN = filasData.length;
    const totalHH = filasData.reduce((s, f) => s + (Number(f.hh_total) || 0), 0);

    const aoaRes = [
      [tituloRes + (semFiltro ? ` · S-${semFiltro}` : '')],
      [],
      [labelDim, '# Actividades', 'HH Total'],
      ...[...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, { n, hh }]) => [k, n, +hh.toFixed(1)]),
      [],
      ['TOTAL', totalN, +totalHH.toFixed(1)],
      [],
      ['Exportado: ' + new Date().toLocaleDateString('es-PE')],
    ];
    const wsRes = XLSX.utils.aoa_to_sheet(aoaRes);
    wsRes['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsRes, tituloRes.slice(0, 30));

    const sufSem = semFiltro ? ` S-${semFiltro}` : '';
    const sufijos = { todo: '', resp: ' - Resp', gerencia: ' - Gerencia', proyecto: ' - Proyecto' };
    const nombre = nombreArchivo(cfg.titulo || cfg.id || 'Datos') + sufSem + (sufijos[agrupacion] || '') + '.xlsx';
    XLSX.writeFile(wb, nombre);
  }

  // ---------- API pública ----------
  let listo = false;
  const alListo = new Promise(r => tabla.on('tableBuilt', () => { listo = true; r(); }));
  // Alto de las filas con textos de varias líneas: se recalcula cuando cambia el ancho de las columnas
  // (vista guardada, arrastre) o termina de cargar la fuente; si no, el final del texto quedaba cortado.
  const ajustarAltos = debounce(() => {
    if (!listo || !columnasCfg.some(c => c.tipo === 'textoLargo')) return;
    tabla.getRows().forEach(r => r.normalizeHeight());
  }, 80);
  tabla.on('columnResized', ajustarAltos);
  tabla.on('dataProcessed', ajustarAltos);
  tabla.on('columnVisibilityChanged', ajustarAltos);
  alListo.then(() => { ajustarAltos(); document.fonts?.ready.then(ajustarAltos); });
  const api_ = {
    tabla,
    listo: alListo,
    async setDatos(filas, { borradores = false } = {}) {
      await alListo;
      // Las filas nuevas que aún no se guardan (sin datos) no se pierden al recargar la grilla
      const pendientes = borradores ? leerBorradores() : filasSinGuardar().map(limpiarFila);
      servidor.clear();
      for (const f of filas) if (f.id) servidor.set(f.id, structuredClone(f));
      await tabla.replaceData([...filas, ...pendientes.map(d => ({ ...d, _nueva: true }))]);
      tabla.clearHistory();
      // Al abrir la pantalla: se reaplican las ediciones que no llegaron y se envía todo lo pendiente
      if (borradores) reaplicarCambiosPendientes();
      if (contarPendientes()) programarGuardado(); else pintarPendientes(0);
    },
    async inicializar(filas) {
      await alListo;
      await cargarVistas();
      await api_.setDatos(filas, { borradores: true });
    },
    /** Cambio recibido en tiempo real (de otro usuario o de otra pestaña). */
    aplicarRemoto({ tipo, fila, anterior }, pertenece) {
      if (!listo) return;
      const id = fila?.id || anterior?.id;
      const existente = id && tabla.getRow(id);
      // El eco debe comprobarse ANTES del filtro de pertenece: si ya aplicamos este cambio
      // localmente (misma updated_at), ignorarlo evita que una fila recién guardada con un
      // proyecto_id fuera del filtro actual desaparezca antes de que el usuario pueda verla.
      if (fila && tipo !== 'DELETE') {
        const previo = servidor.get(fila.id);
        if (previo && previo.updated_at === fila.updated_at) return;   // eco de un cambio propio
      }
      if (tipo === 'DELETE' || (fila && pertenece && !pertenece(fila))) {
        if (existente) { existente.delete(); servidor.delete(id); }
        return;
      }
      if (!fila) return;
      servidor.set(fila.id, structuredClone(fila));
      if (existente) {
        const editando = existente.getCells().some(c => c.getElement().classList.contains('tabulator-editing'));
        if (!editando) existente.update(fila);
      } else if (tipo === 'INSERT') {
        // Eco de una fila propia que aún espera respuesta: es la misma (mismo id creado aquí); no se agrega otra
        const propia = tabla.getRows().find(r => !r.getData().id && r.getData()._cid === fila.id);
        if (propia) { propia.update({ ...fila, _guardando: false, _nueva: false }); return; }
        const local = tabla.getRows().find(r => !r.getData().id && r.getData()._guardando && !r.getData()._cid);
        if (!local) tabla.addRow(fila);
      }
      cfg.alCambioRemoto?.();
    },
    filas() { return tabla.getData(); },
    /**
     * Columnas visibles tal como se ven en la grilla (mismo orden, títulos y ancho relativo) para los PDF:
     * [{ titulo, ancho, num, html, valor(fila) }]. Se omiten las columnas de botones (pdf: false).
     */
    columnasPDF() {
      return tabla.getColumns().filter(col => col.isVisible() && porCampo.has(col.getField()))
        .map(col => definicionPDF(porCampo.get(col.getField()), col.getWidth())).filter(Boolean);
    },
    refrescar() { tabla.getRows().forEach(reformatear); },
    /** Agrupa por un campo (o quita la agrupación con '') y lo refleja en el selector «Agrupar». */
    agruparPor(campo) {
      const sel = raiz.querySelector('[data-a="agrupar"]');
      if (sel && [...sel.options].some(o => o.value === (campo || ''))) sel.value = campo || '';
      tabla.setGroupBy(campo || false);
    },
    agrupadoPor() { return tabla.options.groupBy || ''; },
    /** Filas que se ven ahora (respeta los filtros de los títulos de columna y el buscador), sin las filas nuevas sin guardar. */
    filasFiltradas() { return tabla.getData('active').filter(d => d.id); },
    /** Valor elegido en el filtro del título de una columna (o null). */
    filtroDe(campo) { return tabla.getHeaderFilters().find(f => f.field === campo)?.value ?? null; },
    /** Muestra u oculta una columna sin cambiar la vista guardada del usuario. */
    mostrarColumna(campo, ver) { const c = tabla.getColumn(campo); if (c) (ver ? c.show() : c.hide()); },
    /** Filtro propio de la vista (además de los filtros de cada columna); fn(datosFila) → true para mostrar. */
    filtrar(fn) { if (fn) tabla.setFilter(d => fn(d)); else tabla.clearFilter(); },
    refrescarFiltro() { tabla.refreshFilter(); },
    actualizarFila(id, datos) {
      const r = tabla.getRow(id);
      if (r) { r.update(datos); servidor.set(id, structuredClone(r.getData())); }
    },
    guardarAhora: guardar,
    destruir() {
      clearTimeout(temporizadorReintento);
      window.removeEventListener('online', alVolverConexion);
      registroPendientes.delete(registroId);
      try { tabla.destroy(); } catch { /* ya destruida */ }
    },
    /** Cambios que aún no llegan al servidor. */
    pendientes() { return contarPendientes(); },
  };
  return api_;
}
