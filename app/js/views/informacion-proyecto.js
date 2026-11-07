// Ficha del proyecto (CR-PG-SGP-01-F1 r1, pestaña "0.Ficha del proyecto"): datos generales, plazos, presupuesto,
// alcance, volúmenes principales, organización del proyecto y fotos. Se edita por secciones y se puede importar
// directamente de la pestaña del Excel (incluidas sus fotos). La usa el Programa de Arranque como cabecera.
import { api, mensajeError } from '../data/api.js';
import { store, esGestor, haySeleccion, proyecto, misProyectos, emit } from '../core/store.js';
import { esc, html, fmtFecha, libExcel, normalizar } from '../core/util.js';
import { ok, error as mostrarError, pedirDatos, confirmar, modal } from '../ui/ui.js';

// ── Campos ────────────────────────────────────────────────────────────────────
// "Inicio/Fin programado" son inicio_contractual / fin_contractual (los usa el Programa de Arranque y el correo).
const GENERALES = [
  { name: 'nombre_completo', label: 'Nombre del proyecto', full: true, required: true },
  { name: 'cebe', label: 'CeBe' },
  { name: 'cr', label: 'CR', placeholder: 'C202000' },
  { name: 'unidad_negocio', label: 'Unidad de negocios' },
  { name: 'tipo_proyecto', label: 'Tipo de proyecto' },
  { name: 'ubicacion', label: 'Ubicación', full: true },
  { name: 'pais', label: 'País' },
  { name: 'cliente', label: 'Cliente' },
  { name: 'supervision', label: 'Supervisión', full: true },
  { name: 'modalidad_ejecucion', label: 'Modalidad de ejecución' },
  { name: 'sistema_contratacion', label: 'Sistema de contratación' },
];
const PLAZOS = [
  { name: 'inicio_contractual', label: 'Inicio programado', type: 'date' },
  { name: 'fin_contractual', label: 'Fin programado', type: 'date' },
  { name: 'inicio_real', label: 'Inicio real', type: 'date' },
  { name: 'fin_real', label: 'Fin real', type: 'date' },
  { name: 'fecha_movilizacion', label: 'Inicio de movilización', type: 'date' },
  { name: 'fecha_construccion', label: 'Inicio de construcción', type: 'date' },
];
const MONEDAS = ['US$', 'S/', '€'];
const PRESUPUESTO = [
  { name: 'moneda', label: 'Moneda', type: 'select', options: MONEDAS.map(m => ({ value: m, label: m })) },
  { name: 'presupuesto_inicial', label: 'Presupuesto inicial', type: 'number', step: 0.01, min: 0 },
  { name: 'presupuesto_final', label: 'Presupuesto final (incluye todos los cambios)', type: 'number', step: 0.01, min: 0 },
];

/** Campos que exporta el Programa de Arranque a la pestaña "0.Ficha del proyecto" del Excel. */
export const CAMPOS_INFO = [...GENERALES, ...PLAZOS, PRESUPUESTO[1], PRESUPUESTO[2], PRESUPUESTO[0], { name: 'alcance', label: 'Alcance del proyecto' }];

/** ¿Puede la persona editar los documentos de este proyecto? (gestores y miembros del proyecto) */
export function puedeEditarProyecto(id) {
  return esGestor() || misProyectos().some(p => p.id === id);
}

// ── Formatos ──────────────────────────────────────────────────────────────────
const num = (v, dec = 2) => (v == null || v === '' ? '' : Number(v).toLocaleString('es-PE', { maximumFractionDigits: dec }));
const dinero = (v, m) => (v == null || v === '' ? '—' : `${m || 'US$'} ${Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dias = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : null);
const nombreDe = p => p.nombre_completo || p.nombre_corto;
const valor = (p, c) => {
  const v = c.name === 'nombre_completo' ? nombreDe(p) : p[c.name];
  if (v == null || v === '') return '';
  return c.type === 'date' ? fmtFecha(v) : String(v);
};

// ── Pantalla ──────────────────────────────────────────────────────────────────

export async function render(el) {
  el.innerHTML = '';
  const p = store.proyectoSel && proyecto(store.proyectoSel);
  if (!haySeleccion() || !p) {
    el.innerHTML = '<div class="aviso-vacio"><p>Selecciona un proyecto en el menú para ver su ficha.</p></div>';
    return;
  }
  el.innerHTML = '<div class="cargando"><span class="spinner"></span> Cargando…</div>';
  let volumenes = [], staff = [], fotos = [];
  try {
    [volumenes, staff, fotos] = await Promise.all([
      api.list('proyecto_volumenes', { eq: { proyecto_id: p.id }, order: [['orden', true]] }),
      api.list('proyecto_staff', { eq: { proyecto_id: p.id }, order: [['orden', true]] }),
      api.list('proyecto_fotos', { eq: { proyecto_id: p.id }, order: [['orden', true]] }),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="aviso-vacio"><p>${esc(mensajeError(e))}</p></div>`;
    return;
  }
  const editable = puedeEditarProyecto(p.id);
  const f = { el, p, volumenes, staff, fotos, editable };
  el.innerHTML = '';
  const wrap = html(`<div class="ficha">
    <div class="pagina-cab"><h1>Ficha del proyecto</h1><span class="proy-badge">${esc(p.codigo)} · ${esc(p.nombre_corto)}</span>
      <span class="flex"></span>
      ${editable ? '<button class="btn" data-a="importar" title="Cargar la pestaña «0.Ficha del proyecto» del formato CR-PG-SGP-01-F1">⬆ Importar Excel</button>' : ''}
      <button class="btn" data-a="pdf">⬇ PDF</button></div>
    <div data-cabecera></div>
    <div class="ficha-grid">
      <section class="tarjeta" data-sec="generales"></section>
      <section class="tarjeta" data-sec="plazos"></section>
    </div>
    <section class="tarjeta" data-sec="alcance"></section>
    <section class="tarjeta" data-sec="volumenes"></section>
    <section class="tarjeta" data-sec="staff"></section>
    <section class="tarjeta" data-sec="fotos"></section></div>`);
  el.append(wrap);
  f.wrap = wrap;
  pintarTodo(f);
  wrap.querySelector('[data-a="importar"]')?.addEventListener('click', () => importarExcel(f).catch(e => mostrarError(mensajeError(e))));
  wrap.querySelector('[data-a="pdf"]').onclick = () => pdfFicha(f).catch(e => mostrarError(mensajeError(e)));
}

function pintarTodo(f) {
  pintarCabecera(f); pintarGenerales(f); pintarPlazos(f); pintarAlcance(f); pintarVolumenes(f); pintarStaff(f); pintarFotos(f);
}
const sec = (f, s) => f.wrap.querySelector(`[data-sec="${s}"]`);
const cab = (titulo, f, accion = 'editar', texto = '✎ Editar') => `<div class="ficha-sec-cab"><h2>${titulo}</h2><span class="flex"></span>
  ${f.editable ? `<button class="btn btn-sm" data-${accion}>${texto}</button>` : ''}</div>`;

async function guardarCampos(f, cambios, aviso) {
  let act;
  try { act = await api.update('proyectos', f.p.id, cambios); } catch (e) { throw new Error(mensajeError(e)); }
  Object.assign(f.p, act);
  emit('catalogo');
  ok(aviso);
  pintarCabecera(f);
}
function editarCampos(f, titulo, campos, alPintar, validar) {
  return pedirDatos({
    titulo, campos, ancho: 720,
    valores: Object.fromEntries(campos.map(c => [c.name, c.name === 'nombre_completo' ? nombreDe(f.p) : (f.p[c.name] ?? (c.name === 'moneda' ? 'US$' : ''))])),
    alGuardar: async d => { validar?.(d); await guardarCampos(f, d, `${titulo} guardado.`); alPintar(f); },
  });
}

// Cabecera: nombre, cliente y ubicación, e indicadores de plazo y presupuesto
function pintarCabecera(f) {
  const { p } = f;
  const progr = dias(p.inicio_contractual, p.fin_contractual), real = dias(p.inicio_real, p.fin_real);
  const desvPlazo = progr != null && real != null ? real - progr : null;
  const ini = Number(p.presupuesto_inicial), fin = Number(p.presupuesto_final);
  const varPres = p.presupuesto_inicial != null && p.presupuesto_final != null && ini > 0 ? (fin - ini) / ini * 100 : null;
  const chips = [p.tipo_proyecto, p.unidad_negocio, p.modalidad_ejecucion].filter(Boolean);
  const kpi = (t, v, pie, cls = '') => `<div class="ficha-kpi ${cls}"><span class="ficha-kpi-lbl">${t}</span><span class="ficha-kpi-val">${v}</span>${pie ? `<span class="ficha-kpi-pie">${pie}</span>` : ''}</div>`;
  f.wrap.querySelector('[data-cabecera]').innerHTML = `<div class="tarjeta ficha-hero">
      <div class="ficha-hero-nombre">${esc(nombreDe(p))}</div>
      <div class="ficha-hero-meta">${[p.cliente, p.ubicacion, p.pais].filter(Boolean).map(esc).join(' · ') || '<span class="nota">Complete los datos generales</span>'}</div>
      ${chips.length ? `<div class="ficha-chips">${chips.map(c => `<span class="ficha-chip">${esc(c)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="ficha-kpis">
      ${kpi('Plazo programado', progr != null ? `${num(progr, 0)} días` : '—', progr != null ? `${fmtFecha(p.inicio_contractual)} – ${fmtFecha(p.fin_contractual)}` : 'sin fechas', 'azul')}
      ${kpi('Plazo real', real != null ? `${num(real, 0)} días` : '—', desvPlazo != null ? (desvPlazo === 0 ? 'igual a lo programado' : `${desvPlazo > 0 ? '+' : ''}${num(desvPlazo, 0)} días vs. programado`) : (p.inicio_real ? `desde ${fmtFecha(p.inicio_real)}` : 'sin fechas'), desvPlazo > 0 ? 'rojo' : 'verde')}
      ${kpi('Presupuesto inicial', dinero(p.presupuesto_inicial, p.moneda), '', 'navy')}
      ${kpi('Presupuesto final', dinero(p.presupuesto_final, p.moneda), varPres != null ? `${varPres > 0 ? '+' : ''}${num(varPres, 2)} % vs. inicial` : 'incluye todos los cambios', varPres > 0 ? 'rojo' : 'naranja')}
    </div>`;
}

function pintarGenerales(f) {
  const s = sec(f, 'generales');
  s.innerHTML = `${cab('Datos generales', f)}<dl class="ficha-dl">${GENERALES.map(c => `<dt>${esc(c.label)}</dt><dd>${esc(valor(f.p, c)) || '<span class="nota">—</span>'}</dd>`).join('')}</dl>`;
  s.querySelector('[data-editar]')?.addEventListener('click', () => editarCampos(f, 'Datos generales', GENERALES, pintarGenerales));
}

function pintarPlazos(f) {
  const { p } = f, s = sec(f, 'plazos');
  // Barras de programado y real en una misma escala de tiempo
  const fechas = [p.inicio_contractual, p.fin_contractual, p.inicio_real, p.fin_real].filter(Boolean).sort();
  const a = fechas[0], b = fechas.at(-1), total = dias(a, b) || 1;
  const barra = (ini, fin, cls, etiqueta) => (ini && fin ? `<div class="ficha-barra-fila"><span class="ficha-barra-lbl">${etiqueta}</span>
      <div class="ficha-barra-pista"><span class="ficha-barra ${cls}" style="left:${dias(a, ini) / total * 100}%;width:${Math.max(1.5, dias(ini, fin) / total * 100)}%"></span></div>
      <span class="ficha-barra-dias">${num(dias(ini, fin), 0)} d</span></div>` : '');
  s.innerHTML = `${cab('Plazos', f)}
    ${barra(p.inicio_contractual, p.fin_contractual, 'prog', 'Programado') + barra(p.inicio_real, p.fin_real, 'real', 'Real')}
    <dl class="ficha-dl">${PLAZOS.map(c => `<dt>${esc(c.label)}</dt><dd>${esc(valor(p, c)) || '<span class="nota">—</span>'}</dd>`).join('')}
      <dt>Presupuesto inicial</dt><dd>${esc(dinero(p.presupuesto_inicial, p.moneda))}</dd>
      <dt>Presupuesto final</dt><dd>${esc(dinero(p.presupuesto_final, p.moneda))}</dd></dl>
    ${f.editable ? '<div class="ficha-sec-pie"><button class="btn btn-sm" data-presupuesto>✎ Editar presupuesto</button></div>' : ''}`;
  s.querySelector('[data-editar]')?.addEventListener('click', () => editarCampos(f, 'Plazos', PLAZOS, pintarPlazos, d => {
    if (d.inicio_contractual && d.fin_contractual && d.fin_contractual < d.inicio_contractual) throw new Error('El fin programado no puede ser anterior al inicio.');
    if (d.inicio_real && d.fin_real && d.fin_real < d.inicio_real) throw new Error('El fin real no puede ser anterior al inicio real.');
  }));
  s.querySelector('[data-presupuesto]')?.addEventListener('click', () => editarCampos(f, 'Presupuesto', PRESUPUESTO, pintarPlazos));
}

function pintarAlcance(f) {
  const s = sec(f, 'alcance'), texto = f.p.alcance || '';
  const largo = texto.split('\n').length > 8 || texto.length > 900;
  s.innerHTML = `${cab('Alcance del proyecto', f)}
    ${texto ? `<div class="ficha-alcance${largo ? ' plegado' : ''}">${esc(texto)}</div>${largo ? '<button class="btn-link" data-vertodo>Ver todo ▾</button>' : ''}`
      : '<p class="nota">Aún no se registra el alcance.</p>'}`;
  s.querySelector('[data-vertodo]')?.addEventListener('click', e => {
    const caja = s.querySelector('.ficha-alcance'), abierto = caja.classList.toggle('plegado');
    e.currentTarget.textContent = abierto ? 'Ver todo ▾' : 'Ver menos ▴';
  });
  s.querySelector('[data-editar]')?.addEventListener('click', () => editarCampos(f, 'Alcance del proyecto',
    [{ name: 'alcance', label: 'Alcance del proyecto', type: 'textarea', rows: 16 }], pintarAlcance));
}

// ── Tablas editables (volúmenes y organización): se editan en la tabla y se guardan juntas ─────

function tablaEditable(f, opts) {
  const { seccion, titulo, columnas, vacio, nueva, guardar, extraBotones = '' } = opts;
  const filas = opts.filas();   // siempre el estado actual
  const s = sec(f, seccion);
  const editando = s.dataset.editando === '1';
  const celda = (c, r) => c.render ? c.render(r) : esc(r[c.name] ?? '');
  if (!editando) {
    s.innerHTML = `${cab(titulo, f)}${filas.length ? `<div class="admin-tabla-wrap"><table class="simple ficha-tabla"><thead><tr>${columnas.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(r => r.es_titulo ? `<tr class="ficha-subtitulo"><td colspan="${columnas.length}">${esc(r.descripcion)}</td></tr>`
        : `<tr>${columnas.map(c => `<td class="${c.num ? 'num' : ''}">${celda(c, r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="nota">${vacio}</p>`}`;
    s.querySelector('[data-editar]')?.addEventListener('click', () => { s.dataset.editando = '1'; tablaEditable(f, opts); });
    return;
  }
  // Modo edición: filas con campos; se agregan, quitan, ordenan y se guardan todas juntas
  const borrador = (s._borrador ||= filas.map(r => ({ ...r })));
  const inputs = r => columnas.filter(c => c.editar !== false).map(c => `<td class="${c.num ? 'num' : ''}">${r.es_titulo && c.name !== 'descripcion' ? ''
    : `<input data-c="${c.name}" ${c.num ? 'type="number" step="any"' : ''} value="${esc(r[c.name] ?? '')}" placeholder="${esc(c.label)}">`}</td>`).join('');
  s.innerHTML = `<div class="ficha-sec-cab"><h2>${titulo}</h2><span class="flex"></span>
      <button class="btn btn-sm" data-cancelar>Cancelar</button><button class="btn btn-sm btn-primario" data-guardar>Guardar</button></div>
    <div class="admin-tabla-wrap"><table class="simple ficha-tabla editando"><thead><tr>${columnas.filter(c => c.editar !== false).map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}<th style="width:92px"></th></tr></thead>
      <tbody>${borrador.map((r, i) => `<tr data-i="${i}" class="${r.es_titulo ? 'ficha-subtitulo' : ''}">${inputs(r)}
        <td class="ficha-acc"><button class="btn-icono" data-subir="${i}" title="Subir">↑</button><button class="btn-icono" data-bajar="${i}" title="Bajar">↓</button><button class="btn-icono" data-quitar="${i}" title="Quitar">✕</button></td></tr>`).join('')}</tbody></table></div>
    <div class="ficha-sec-pie"><button class="btn btn-sm" data-agregar>＋ Agregar fila</button>${extraBotones}</div>`;
  const leer = () => s.querySelectorAll('tbody tr').forEach(tr => {
    const r = borrador[tr.dataset.i];
    tr.querySelectorAll('[data-c]').forEach(inp => { r[inp.dataset.c] = inp.value; });
  });
  s.querySelector('[data-agregar]').onclick = () => { leer(); borrador.push(nueva()); tablaEditable(f, opts); s.querySelector('tbody tr:last-child input')?.focus(); };
  s.querySelector('[data-subtitulo]')?.addEventListener('click', () => { leer(); borrador.push({ ...nueva(), es_titulo: true }); tablaEditable(f, opts); s.querySelector('tbody tr:last-child input')?.focus(); });
  s.querySelector('tbody').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    leer();
    if (b.dataset.quitar != null) borrador.splice(Number(b.dataset.quitar), 1);
    const i = Number(b.dataset.subir ?? b.dataset.bajar), j = b.dataset.subir != null ? i - 1 : i + 1;
    if ((b.dataset.subir != null || b.dataset.bajar != null) && j >= 0 && j < borrador.length) [borrador[i], borrador[j]] = [borrador[j], borrador[i]];
    tablaEditable(f, opts);
  });
  s.querySelector('[data-cancelar]').onclick = () => { delete s._borrador; s.dataset.editando = ''; tablaEditable(f, opts); };
  s.querySelector('[data-guardar]').onclick = async e => {
    leer();
    e.currentTarget.disabled = true;
    try {
      await guardar(borrador.filter(r => Object.entries(r).some(([k, v]) => !['id', 'es_titulo', 'orden', 'proyecto_id'].includes(k) && v !== '' && v != null)));
      delete s._borrador; s.dataset.editando = '';
      ok(`${titulo}: guardado.`);
    } catch (er) { mostrarError(mensajeError(er)); e.currentTarget.disabled = false; return; }
    tablaEditable(f, opts);
  };
}

// Reemplaza todas las filas de una tabla del proyecto por las del borrador (en orden)
async function reemplazarFilas(tabla, proyId, filas) {
  await api.removeWhere(tabla, { eq: { proyecto_id: proyId } });
  if (!filas.length) return [];
  return api.insert(tabla, filas.map((r, i) => { const { id, created_at, updated_at, ...resto } = r; void id; void created_at; void updated_at; return { ...resto, proyecto_id: proyId, orden: i + 1 }; }));
}

function pintarVolumenes(f) {
  const variacion = r => {
    if (r.cantidad_inicial == null || r.cantidad_final == null || r.cantidad_inicial === '' || r.cantidad_final === '') return '';
    const d = Number(r.cantidad_final) - Number(r.cantidad_inicial);
    return d === 0 ? '<span class="nota">0</span>' : `<span class="${d > 0 ? 'ficha-sube' : 'ficha-baja'}">${d > 0 ? '+' : ''}${num(d)}</span>`;
  };
  tablaEditable(f, {
    seccion: 'volumenes', titulo: 'Volúmenes principales', filas: () => f.volumenes,
    vacio: 'Aún no se registran los volúmenes principales.',
    columnas: [{ name: 'descripcion', label: 'Descripción' }, { name: 'cantidad_inicial', label: 'Cantidad inicial', num: true, render: r => num(r.cantidad_inicial) },
      { name: 'cantidad_final', label: 'Cantidad final', num: true, render: r => num(r.cantidad_final) },
      { name: 'variacion', label: 'Variación', num: true, editar: false, render: variacion }, { name: 'unidad', label: 'Unidad' }],
    nueva: () => ({ descripcion: '', cantidad_inicial: '', cantidad_final: '', unidad: '', es_titulo: false }),
    extraBotones: ' <button class="btn btn-sm" data-subtitulo>＋ Agregar subtítulo</button>',
    guardar: async filas => {
      for (const r of filas) if (!String(r.descripcion || '').trim()) throw new Error('Cada fila debe tener una descripción.');
      const limpias = filas.map(r => ({ id: r.id, descripcion: String(r.descripcion).trim(), es_titulo: !!r.es_titulo, unidad: r.es_titulo ? null : (r.unidad || null),
        cantidad_inicial: r.es_titulo || r.cantidad_inicial === '' || r.cantidad_inicial == null ? null : Number(r.cantidad_inicial),
        cantidad_final: r.es_titulo || r.cantidad_final === '' || r.cantidad_final == null ? null : Number(r.cantidad_final) }));
      f.volumenes = await reemplazarFilas('proyecto_volumenes', f.p.id, limpias);
    },
  });
}

function pintarStaff(f) {
  tablaEditable(f, {
    seccion: 'staff', titulo: 'Organización del proyecto', filas: () => f.staff,
    vacio: 'Aún no se registra la organización del proyecto.',
    columnas: [{ name: 'cargo', label: 'Cargo' }, { name: 'principal', label: 'Responsable principal' }, { name: 'reemplazo', label: 'Contraturno y/o reemplazo' }],
    nueva: () => ({ cargo: '', principal: '', reemplazo: '' }),
    guardar: async filas => {
      for (const r of filas) if (!String(r.cargo || '').trim()) throw new Error('Cada fila debe tener un cargo.');
      f.staff = await reemplazarFilas('proyecto_staff', f.p.id, filas.map(r => ({ id: r.id, cargo: String(r.cargo).trim(), principal: r.principal || null, reemplazo: r.reemplazo || null })));
    },
  });
}

// ── Fotos ─────────────────────────────────────────────────────────────────────

/** Reduce una imagen a JPEG de hasta 1600 px por lado (≈200–500 KB) */
async function reducirImagen(blob, max = 1600) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((ok_, mal) => { const i = new Image(); i.onload = () => ok_(i); i.onerror = () => mal(new Error('No se pudo leer la imagen.')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const cx = c.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55]) { const d = c.toDataURL('image/jpeg', q); if (d.length <= 1_400_000) return d; }
    throw new Error('La imagen es demasiado grande.');
  } finally { URL.revokeObjectURL(url); }
}

function pintarFotos(f) {
  const s = sec(f, 'fotos');
  s.innerHTML = `${cab('Fotos del proyecto', f, 'subir', '＋ Agregar fotos')}
    ${f.fotos.length ? `<div class="ficha-fotos">${f.fotos.map(ft => `<figure data-id="${ft.id}"><img src="${ft.imagen}" alt="${esc(ft.titulo || 'Foto del proyecto')}" loading="lazy">
      <figcaption>${esc(ft.titulo || '')}${f.editable ? ` <span class="ficha-foto-acc"><button class="btn-icono" data-titulo="${ft.id}" title="Cambiar título">✎</button><button class="btn-icono" data-borrar="${ft.id}" title="Quitar">✕</button></span>` : ''}</figcaption></figure>`).join('')}</div>`
      : '<p class="nota">Aún no hay fotos del proyecto.</p>'}
    <input type="file" accept="image/*" multiple hidden data-archivo>`;
  const entrada = s.querySelector('[data-archivo]');
  s.querySelector('[data-subir]')?.addEventListener('click', () => entrada.click());
  entrada.onchange = async () => {
    const archivos = [...entrada.files]; entrada.value = '';
    if (!archivos.length) return;
    try {
      for (const a of archivos) {
        const [nueva] = await api.insert('proyecto_fotos', { proyecto_id: f.p.id, orden: f.fotos.length + 1, titulo: a.name.replace(/\.[^.]+$/, ''), imagen: await reducirImagen(a) });
        f.fotos.push(nueva);
      }
      ok(`${archivos.length} foto${archivos.length === 1 ? '' : 's'} agregada${archivos.length === 1 ? '' : 's'}.`);
    } catch (e) { mostrarError(mensajeError(e)); }
    pintarFotos(f);
  };
  s.querySelector('.ficha-fotos')?.addEventListener('click', async e => {
    const idT = e.target.closest('[data-titulo]')?.dataset.titulo, idB = e.target.closest('[data-borrar]')?.dataset.borrar;
    if (idT) {
      const ft = f.fotos.find(x => x.id === idT);
      const d = await pedirDatos({ titulo: 'Título de la foto', campos: [{ name: 'titulo', label: 'Título', full: true }], valores: ft,
        alGuardar: async v => { try { Object.assign(ft, await api.update('proyecto_fotos', ft.id, { titulo: v.titulo })); } catch (er) { throw new Error(mensajeError(er)); } } });
      if (d) pintarFotos(f);
      return;
    }
    if (idB) {
      if (!await confirmar('¿Quitar esta foto de la ficha?', { titulo: 'Quitar foto', texto: 'Quitar', peligro: true })) return;
      try { await api.remove('proyecto_fotos', idB); f.fotos = f.fotos.filter(x => x.id !== idB); pintarFotos(f); } catch (er) { mostrarError(mensajeError(er)); }
      return;
    }
    const fig = e.target.closest('figure');
    if (fig) { const ft = f.fotos.find(x => x.id === fig.dataset.id); modal({ titulo: ft.titulo || 'Foto del proyecto', ancho: 1100, cuerpo: `<img class="ficha-foto-grande" src="${ft.imagen}" alt="">` }); }
  });
}

// ── Importar la pestaña "0.Ficha del proyecto" del Excel ───────────────────────

const clave = s => normalizar(String(s ?? '')).replace(/[^a-z0-9]/g, '');
const MAPA = {
  nombredelproyecto: 'nombre_completo', proyecto: 'nombre_completo', cebe: 'cebe', cr: 'cr', unidaddenegocios: 'unidad_negocio', unidaddenegocio: 'unidad_negocio',
  ubicacion: 'ubicacion', pais: 'pais', tipodeproyecto: 'tipo_proyecto', cliente: 'cliente', supervision: 'supervision',
  inicioprogramado: 'inicio_contractual', iniciocontractual: 'inicio_contractual', finprogramado: 'fin_contractual', fincontractual: 'fin_contractual',
  inicioreal: 'inicio_real', finreal: 'fin_real', fechainiciomovilizacion: 'fecha_movilizacion', fechainiciodemovilizacion: 'fecha_movilizacion',
  fechainiciodeconstruccion: 'fecha_construccion', modalidaddeejecucion: 'modalidad_ejecucion', sistemadecontratacion: 'sistema_contratacion',
  presupuestoinicial: 'presupuesto_inicial', presupuestofinal: 'presupuesto_final', presupuestofinalincluyetodosloscambios: 'presupuesto_final',
  alcancedelproyecto: 'alcance', alcance: 'alcance',
};
const FECHAS = new Set(PLAZOS.map(c => c.name));
function fechaIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
}
const numero = v => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.,-]/g, '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

/** Lee la pestaña de la ficha (o la "0.Datos" antigua). Devuelve campos, volúmenes, staff y nombre de la hoja. */
export function leerFichaExcel(XLSX, libro) {
  const hoja = libro.SheetNames.find(n => /^0\.?\s*(ficha|datos)/i.test(n));
  if (!hoja) return null;
  const filas = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, defval: null });
  const campos = {}, volumenes = [], staff = [];
  let modo = null;
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i] || [], vacia = f.every(v => v == null || String(v).trim() === '');
    const k0 = clave(f[0]);
    if (k0 === 'volumenesprincipales' || (k0.startsWith('volumen') && clave(f[1]).startsWith('cantidad'))) { modo = 'vol'; continue; }
    if (k0 === 'cargo' && clave(f[1]).includes('principal')) { modo = 'staff'; continue; }   // «Principal» o «Responsable principal»
    if (modo === 'vol') {
      if (vacia) { if (volumenes.length) modo = null; continue; }
      const sinDatos = [f[1], f[2], f[3]].every(v => v == null || v === '');
      volumenes.push(sinDatos ? { descripcion: String(f[0]).trim(), es_titulo: true }
        : { descripcion: String(f[0] ?? '').trim(), es_titulo: false, cantidad_inicial: numero(f[1]), cantidad_final: numero(f[2]), unidad: f[3] == null ? null : String(f[3]).trim() });
      continue;
    }
    if (modo === 'staff') {
      if (vacia) { if (staff.length) modo = null; continue; }
      if (f[0] != null && String(f[0]).trim()) staff.push({ cargo: String(f[0]).trim(), principal: f[1] == null ? null : String(f[1]).trim(), reemplazo: f[2] == null ? null : String(f[2]).trim() });
      continue;
    }
    const n = f.findIndex(v => MAPA[clave(v)]);
    if (n < 0) continue;
    const campo = MAPA[clave(f[n])];
    let v = f[n + 1];
    if (campo === 'alcance' && (v == null || v === '')) v = (filas[i + 1] || [])[n];   // el texto va en la fila siguiente
    if (v == null || v === '') continue;
    if (FECHAS.has(campo)) { const d = fechaIso(v); if (d) campos[campo] = d; }
    else if (campo === 'presupuesto_inicial' || campo === 'presupuesto_final') {
      const n2 = numero(v); if (n2 != null) campos[campo] = n2;
      const mon = String(f[n + 2] ?? '').trim(); if (mon && !campos.moneda) campos.moneda = mon;
    } else campos[campo] = String(v).trim();
  }
  return { hoja, campos, volumenes, staff };
}

/** Fotos incrustadas en una hoja del Excel (requiere leer el libro con bookFiles: true) */
function fotosDeHoja(libro, hoja) {
  const archivos = libro.files || {};
  const texto = ruta => { const a = archivos[ruta] || archivos[`/${ruta}`]; if (!a) return ''; const c = a.content; return typeof c === 'string' ? c : new TextDecoder().decode(c instanceof Uint8Array ? c : new Uint8Array(c)); };
  const destino = (rels, base, tipo) => [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0])
    .filter(r => !tipo || r.includes(tipo)).map(r => ({ id: (r.match(/Id="([^"]+)"/) || [])[1], ruta: new URL((r.match(/Target="([^"]+)"/) || [])[1], `http://x/${base}`).pathname.slice(1) }));
  const wbXml = texto('xl/workbook.xml');
  const rid = (wbXml.match(new RegExp(`<sheet\\b[^>]*name="${hoja.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')}"[^>]*>`)) || [''])[0].match(/r:id="([^"]+)"/)?.[1];
  const hojaRuta = destino(texto('xl/_rels/workbook.xml.rels'), 'xl/').find(r => r.id === rid)?.ruta;
  if (!hojaRuta) return [];
  const relsHoja = `${hojaRuta.replace(/[^/]+$/, '')}_rels/${hojaRuta.split('/').pop()}.rels`;
  const dibujos = destino(texto(relsHoja), hojaRuta.replace(/[^/]+$/, ''), '/drawing');
  const fotos = [];
  for (const d of dibujos) {
    const relsDib = `${d.ruta.replace(/[^/]+$/, '')}_rels/${d.ruta.split('/').pop()}.rels`;
    for (const m of destino(texto(relsDib), d.ruta.replace(/[^/]+$/, ''), '/image')) {
      const a = archivos[m.ruta] || archivos[`/${m.ruta}`];
      if (a && /\.(jpe?g|png|gif|bmp|webp)$/i.test(m.ruta)) fotos.push({ nombre: m.ruta.split('/').pop(), datos: a.content });
    }
  }
  return fotos;
}

async function importarExcel(f) {
  const archivo = await new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsx,.xlsm,.xls'; i.onchange = () => res(i.files[0]); i.click(); });
  if (!archivo) return;
  const XLSX = await libExcel();
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellDates: true, bookFiles: true });
  const ficha = leerFichaExcel(XLSX, libro);
  if (!ficha) throw new Error('El archivo no tiene la pestaña «0.Ficha del proyecto».');
  let fotos = [];
  try { fotos = fotosDeHoja(libro, ficha.hoja); } catch { fotos = []; }
  const n = Object.keys(ficha.campos).length;
  if (!n && !ficha.volumenes.length && !ficha.staff.length && !fotos.length) throw new Error(`La pestaña «${ficha.hoja}» no tiene datos que importar.`);
  const si = await confirmar(`Se cargará la pestaña «${ficha.hoja}» de "${archivo.name}" en la ficha de ${f.p.codigo} · ${f.p.nombre_corto}:
    · ${n} dato(s) generales, de plazos, presupuesto y alcance
    · ${ficha.volumenes.length} fila(s) de volúmenes principales${ficha.volumenes.length ? ' (reemplazan a las actuales)' : ''}
    · ${ficha.staff.length} cargo(s) de la organización del proyecto${ficha.staff.length ? ' (reemplazan a los actuales)' : ''}
    · ${fotos.length} foto(s)${fotos.length ? ' (se agregan a las actuales)' : ''}
    ¿Continuar?`, { titulo: 'Importar ficha del proyecto', texto: 'Importar' });
  if (!si) return;
  if (n) { Object.assign(f.p, await api.update('proyectos', f.p.id, ficha.campos)); emit('catalogo'); }
  if (ficha.volumenes.length) f.volumenes = await reemplazarFilas('proyecto_volumenes', f.p.id, ficha.volumenes);
  if (ficha.staff.length) f.staff = await reemplazarFilas('proyecto_staff', f.p.id, ficha.staff);
  for (const ft of fotos) {
    const tipo = /\.png$/i.test(ft.nombre) ? 'image/png' : 'image/jpeg';
    const [nueva] = await api.insert('proyecto_fotos', { proyecto_id: f.p.id, orden: f.fotos.length + 1, titulo: '', imagen: await reducirImagen(new Blob([ft.datos], { type: tipo })) });
    f.fotos.push(nueva);
  }
  ok('Ficha del proyecto importada.');
  pintarTodo(f);
}

// ── PDF de la ficha ───────────────────────────────────────────────────────────

async function pdfFicha(f) {
  const { imprimirPDF } = await import('../services/pdf.js');
  const { p } = f;
  const filas = cs => cs.map(c => `<tr><th>${esc(c.label)}</th><td>${esc(valor(p, c)) || '—'}</td></tr>`).join('');
  const cuerpo = `<style>
      .ficha-pdf h2 { break-after: avoid; page-break-after: avoid; font-size: 10pt; color: #003366; border-bottom: 1pt solid #003366; padding-bottom: 1.2mm; margin: 5mm 0 2.5mm; }
      .ficha-pdf table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .ficha-pdf th, .ficha-pdf td { font-size: 8pt; padding: 1.4mm 2mm; border: .5pt solid #E0E0E0; vertical-align: top; overflow-wrap: normal; }
      .ficha-pdf .dl th { width: 34%; text-align: left; background: #EAEFF4; color: #003366; }
      .ficha-pdf .num { text-align: right; }
      .ficha-pdf .sub td { font-weight: 700; background: #EAEFF4; color: #003366; }   /* sin color-mix: el generador de PDF no lo admite */
      .ficha-pdf .alcance { font-size: 8pt; white-space: pre-wrap; line-height: 1.4; }
      .ficha-pdf table.fotos td { border: 0; padding: 1.5mm; width: 50%; }
      .ficha-pdf .fotos img { width: 100%; height: 62mm; object-fit: cover; border-radius: 1.5mm; display: block; }
      .ficha-pdf .pie-foto { font-size: 7pt; color: #555555; margin-top: 1mm; }
      .ficha-pdf tr { break-inside: avoid; }
    </style><div class="ficha-pdf">
    <h2>Datos generales</h2><table class="dl">${filas(GENERALES)}</table>
    <h2>Plazos y presupuesto</h2><table class="dl">${filas(PLAZOS)}
      <tr><th>Presupuesto inicial</th><td>${esc(dinero(p.presupuesto_inicial, p.moneda))}</td></tr>
      <tr><th>Presupuesto final (incluye todos los cambios)</th><td>${esc(dinero(p.presupuesto_final, p.moneda))}</td></tr></table>
    ${p.alcance ? `<h2>Alcance del proyecto</h2><div class="alcance">${esc(p.alcance)}</div>` : ''}
    ${f.volumenes.length ? `<div class="pdf-bloque"><h2>Volúmenes principales</h2><table><colgroup><col><col style="width:16%"><col style="width:16%"><col style="width:14%"></colgroup>
      <tr><th>Descripción</th><th class="num">Cantidad inicial</th><th class="num">Cantidad final</th><th>Unidad</th></tr>
      ${f.volumenes.map(r => r.es_titulo ? `<tr class="sub"><td colspan="4">${esc(r.descripcion)}</td></tr>`
        : `<tr><td>${esc(r.descripcion)}</td><td class="num">${num(r.cantidad_inicial)}</td><td class="num">${num(r.cantidad_final)}</td><td>${esc(r.unidad || '')}</td></tr>`).join('')}</table></div>` : ''}
    ${f.staff.length ? `<div class="${f.staff.length <= 30 ? 'pdf-bloque' : ''}"><h2>Organización del proyecto</h2><table><tr><th>Cargo</th><th>Responsable principal</th><th>Contraturno y/o reemplazo</th></tr>
      ${f.staff.map(r => `<tr><td>${esc(r.cargo)}</td><td>${esc(r.principal || '')}</td><td>${esc(r.reemplazo || '')}</td></tr>`).join('')}</table></div>` : ''}
    ${f.fotos.length ? (() => {
      // Dos fotos por fila; el título va en un mismo bloque con la primera fila (no queda solo al pie de una hoja)
      const filaFotos = par => `<table class="fotos"><tr>${[0, 1].map(j => par[j] ? `<td><img src="${par[j].imagen}" alt="">${par[j].titulo ? `<div class="pie-foto">${esc(par[j].titulo)}</div>` : ''}</td>` : '<td></td>').join('')}</tr></table>`;
      const pares = Array.from({ length: Math.ceil(f.fotos.length / 2) }, (_, i) => f.fotos.slice(i * 2, i * 2 + 2));
      return `<div class="pdf-bloque"><h2>Fotos del proyecto</h2>${filaFotos(pares[0])}</div>${pares.slice(1).map(par => `<div class="pdf-bloque">${filaFotos(par)}</div>`).join('')}`;
    })() : ''}
    </div>`;
  const proy = [p.codigo, p.nombre_corto].filter(Boolean).join(' ');
  const d = new Date(), hoyTxt = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  imprimirPDF('Ficha del proyecto', cuerpo, { orientacion: 'portrait', proyectoTexto: `${p.codigo} · ${p.nombre_corto}`, archivo: `${proy}_Ficha del proyecto_${hoyTxt}` });
}
