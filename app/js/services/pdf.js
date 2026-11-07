// Formato estándar de PDF (sección 12.3): encabezado y pie de 6 pt en Urbanist, título de 12 pt #003366,
// contenido en Manrope, márgenes de 10 mm, A4 vertical u horizontal, nombre PROYECTO-Módulo-DDMMAAAA.pdf.
import { store, param, nombreProyecto, nombreSeleccion } from '../core/store.js';
import { esc } from '../core/util.js';

function dosDig(n) { return String(n).padStart(2, '0'); }

/**
 * Nombre de archivo de todos los reportes y para todos los usuarios: GT-LPS_Usuario_Reporte_Fecha
 * (fecha DD-MM-AAAA; sin caracteres que Windows no admite en un nombre de archivo).
 */
export function nombreArchivo(reporte, d = new Date()) {
  const fecha = `${dosDig(d.getDate())}-${dosDig(d.getMonth() + 1)}-${d.getFullYear()}`;
  const limpio = t => String(t || '').replace(/[\\/:*?"<>|_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `GT-LPS_${limpio(store.usuario?.nombre || 'Usuario')}_${limpio(reporte)}_${fecha}`;
}

/** Quita lo que Windows no admite en un nombre de archivo (\\ / : * ? " < > |) y los espacios de más */
export function limpiarNombre(t) {
  return String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

export function nombreProyectoActual() {
  return store.proyectoSel ? nombreProyecto(store.proyectoSel) : store.nivelSel ? nombreSeleccion() : 'Todos los proyectos';
}

// Estilos del documento PDF (encabezado y pie de página, tablas, KPIs). Se usan en la ventana de impresión
// y en la presentación preliminar del módulo Reportes.
function estilosPDF({ version, proy, fecha, hora, firma }) {
  const cssTxt = s => JSON.stringify(String(s));
  return `  @page {
    margin: 10mm;
    @top-left { content: ${cssTxt(version)}; font: 6pt 'Urbanist', sans-serif; color: #555555; }
    @top-center { content: ${cssTxt(proy)}; font: 6pt 'Urbanist', sans-serif; color: #555555; }
    @top-right { content: ${cssTxt(fecha + ', ' + hora)}; font: 6pt 'Urbanist', sans-serif; color: #555555; }
    @bottom-left { content: ${cssTxt(firma)}; font: 6pt 'Urbanist', sans-serif; color: #777777; }
    @bottom-center { content: "—"; font: 6pt 'Urbanist', sans-serif; color: #777777; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 6pt 'Urbanist', sans-serif; color: #777777; }
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Manrope', Arial, sans-serif; color: #1A1A2E; margin: 0; font-size: 9pt; background: #E0E0E0; }
  .barra { position: sticky; top: 0; background: #1A1A2E; color: #fff; padding: 8px 14px; display: flex; gap: 8px; align-items: center; font: 13px 'Manrope', sans-serif; z-index: 5; }
  .barra button { border: 1px solid #ffffff44; background: transparent; color: #fff; border-radius: 6px; padding: 5px 12px; cursor: pointer; font: inherit; }
  .barra button.pri { background: #E8762B; border-color: #E8762B; font-weight: 700; }
  .barra button.act { background: #ffffff22; }
  .barra input { font: inherit; padding: 4px 8px; border-radius: 5px; border: none; width: 380px; }
  .hoja { background: #fff; width: 210mm; margin: 16px auto; padding: 10mm; box-shadow: 0 4px 16px rgba(0,0,0,.2); }
  .hoja.land { width: 297mm; }
  .enc { display: flex; justify-content: space-between; font: 6pt 'Urbanist', sans-serif; color: #555555; border-bottom: .5pt solid #E0E0E0; padding-bottom: 2mm; margin-bottom: 4mm; }
  .pie { display: flex; justify-content: space-between; font: 6pt 'Urbanist', sans-serif; color: #777777; border-top: .5pt solid #E0E0E0; padding-top: 2mm; margin-top: 4mm; }
  h1.titulo { font-family: 'Urbanist', sans-serif; font-size: 12pt; color: #003366; text-align: center; margin: 0 0 5mm; }
  h2 { font-size: 10pt; color: #003366; margin: 5mm 0 2mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; page-break-inside: auto; }
  table.fija { table-layout: fixed; }
  table.fija td, table.fija th { overflow-wrap: break-word; word-break: normal; hyphens: auto; white-space: pre-wrap; }
  table.fija .badge { white-space: nowrap; overflow-wrap: normal; }
  table.fija td.fecha { white-space: nowrap; overflow-wrap: normal; }
  tr { page-break-inside: avoid; }
  th { background: #EAEFF4; color: #003366; text-align: left; font-weight: 700; }
  th, td { border: .5pt solid #E0E0E0; padding: 1.4mm 2mm; font-size: 8pt; vertical-align: top; }
  td.num, th.num { text-align: right; }
  .kpis { display: flex; gap: 3mm; margin-bottom: 4mm; flex-wrap: wrap; }
  .kpi { flex: 1; min-width: 28mm; border: .5pt solid #E0E0E0; border-top: 2pt solid var(--kc, #4E79A7); border-radius: 2mm; padding: 2mm 3mm; }
  .kpi small { display: block; color: #777777; font-size: 6.5pt; text-transform: uppercase; }
  .kpi b { font-size: 13pt; color: var(--kc, #003366); }
  .badge { display: inline-block; padding: 0 2mm; border-radius: 2mm; font-size: 7pt; font-weight: 700; color: var(--c); border: .5pt solid var(--c); }
  .nota { color: #777777; font-size: 7.5pt; }
  .barra-prog { height: 2.4mm; background: #F8FAFC; border: .3pt solid #E0E0E0; border-radius: 1mm; overflow: hidden; min-width: 12mm; }
  .barra-prog > i { display: block; height: 100%; background: var(--bc, #59A14F); }
  img, svg, canvas { max-width: 100%; }
  @media print {
    body { background: #fff; }
    .barra, .enc, .pie { display: none; }
    .hoja { width: auto; margin: 0; padding: 0; box-shadow: none; }
  }
`;
}

/**
 * Abre la presentación preliminar de un PDF (igual a la del módulo Reportes): papel A0–A6, orientación,
 * "Todo en 1 hoja", nombre del archivo y Guardar PDF. La usan todos los botones PDF de la aplicación.
 */
export function imprimirPDF(modulo, contenidoHTML, { orientacion = 'portrait', proyectoTexto, archivo: archivoPropuesto } = {}) {
  document.querySelector('.vista-pdf')?.remove();
  let pref = { papel: 'A4', unaHoja: false };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem('gyc-reportes') || '{}') }; } catch { /* sin almacenamiento */ }
  if (!PAPELES[pref.papel]) pref.papel = 'A4';
  const estado = { orientacion };
  const archivo = archivoPropuesto ? limpiarNombre(archivoPropuesto) : nombreArchivo(modulo);
  const capa = document.createElement('div');
  capa.className = 'vista-pdf';
  capa.innerHTML = `<div class="vista-pdf-caja reportes-vista" role="dialog" aria-label="Presentación preliminar">
      <div class="vista-pdf-cab"><b>🖨 ${esc(modulo)}</b><span class="flex"></span><button class="btn-icono" data-x title="Cerrar (Esc)">✕</button></div>
      <div class="reportes-barra">
        <label>Papel <select data-o="papel">${Object.keys(PAPELES).map(p => `<option${p === pref.papel ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
        <span class="seg"><button data-ori="landscape">▭ Horizontal</button><button data-ori="portrait">▯ Vertical</button></span>
        <label><input type="checkbox" data-o="unaHoja"${pref.unaHoja ? ' checked' : ''}> Todo en 1 hoja</label>
        <label class="archivo">📁 <input data-o="archivo" value="${esc(archivo)}.pdf"></label>
        <span class="flex"></span>
        <button class="btn btn-sm" data-a="imprimir" title="Abrir el diálogo de impresión (papel)">🖨 Imprimir</button>
        <button class="btn btn-primario btn-sm" data-a="pdf" title="Descargar el PDF con el nombre indicado">⬇ Guardar PDF</button>
      </div>
      <div class="reportes-hojas"><iframe title="Presentación preliminar"></iframe></div>
    </div>`;
  document.body.append(capa);
  const marco = capa.querySelector('iframe');
  const pintar = () => {
    const papel = capa.querySelector('[data-o="papel"]').value, unaHoja = capa.querySelector('[data-o="unaHoja"]').checked;
    try { localStorage.setItem('gyc-reportes', JSON.stringify({ ...pref, papel, unaHoja })); } catch { /* sin almacenamiento */ }
    capa.querySelectorAll('[data-ori]').forEach(b => b.classList.toggle('activo', b.dataset.ori === estado.orientacion));
    marco.srcdoc = documentoReporte(modulo, contenidoHTML, { papel, orientacion: estado.orientacion, unaHoja, proyectoTexto, archivo });
  };
  // Chrome propone como nombre del PDF el título de la pestaña: se fija desde que se abre la vista previa (no justo
  // antes de imprimir, cuando a veces todavía no lo ha tomado) y se restituye al cerrar.
  const tituloApp = document.title;
  const entrada = capa.querySelector('[data-o="archivo"]');
  const nombrePDF = () => limpiarNombre((entrada.value || archivo).replace(/\.pdf$/i, '')) || archivo;
  const fijarTitulo = () => { document.title = nombrePDF(); try { marco.contentDocument.title = nombrePDF(); } catch { /* aún cargando */ } };
  entrada.addEventListener('input', fijarTitulo);
  marco.addEventListener('load', fijarTitulo);
  fijarTitulo();
  const cerrar = () => { capa.remove(); document.title = tituloApp; removeEventListener('keydown', tecla); removeEventListener('hashchange', cerrar); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); };
  addEventListener('keydown', tecla);
  addEventListener('hashchange', cerrar);   // al ir a otra pantalla se cierra la vista previa
  capa.querySelector('[data-x]').onclick = cerrar;
  capa.addEventListener('mousedown', e => { if (e.target === capa) cerrar(); });
  capa.querySelectorAll('[data-ori]').forEach(b => { b.onclick = () => { estado.orientacion = b.dataset.ori; pintar(); }; });
  capa.querySelectorAll('[data-o="papel"], [data-o="unaHoja"]').forEach(x => { x.onchange = pintar; });
  capa.querySelector('[data-a="imprimir"]').onclick = () => {
    fijarTitulo();
    marco.contentWindow.focus(); marco.contentWindow.print();
  };
  capa.querySelector('[data-a="pdf"]').onclick = async e => {
    const papel = capa.querySelector('[data-o="papel"]').value, unaHoja = capa.querySelector('[data-o="unaHoja"]').checked;
    try { await guardarPDF(e.currentTarget, modulo, contenidoHTML, { papel, orientacion: estado.orientacion, unaHoja, proyectoTexto, archivo: nombrePDF() }); }
    catch (err) { (await import('../ui/ui.js')).error(err.message || String(err)); }
  };
  pintar();
}

// Ancho relativo por defecto cuando la columna no lo indica: textos largos más anchos, números angostos.
// No depende de los datos, así todas las tablas de un mismo informe tienen exactamente los mismos anchos.
const LARGOS = /actividad|descripci|restricci|acci[oó]n|comentario|nombre|proyecto|servicio/i;
function anchoPorDefecto(c) {
  if (c.num) return 50;
  if (LARGOS.test(c.titulo)) return c.titulo.match(/actividad|descripci|restricci|acci/i) ? 260 : 150;
  return 100;
}

/**
 * Construye una tabla HTML para PDF a partir de columnas [{titulo, valor(fila), num, html, ancho}].
 * Los anchos son fijos y proporcionales (ancho = px de la grilla o relativo); el texto se ajusta en varias líneas.
 */
export function tablaPDF(columnas, filas) {
  const pesos = columnas.map(c => Number(c.ancho) || anchoPorDefecto(c));
  // Mínimos legibles: ninguna palabra del título se corta ("Responsable", "identificada") y las fechas van en una línea.
  // Se expresan como fracción del ancho de la tabla; las demás columnas ceden ese espacio en proporción.
  const base = pesos.reduce((a, b) => a + b, 0) || 1;
  const palabraMax = t => Math.max(0, ...String(t ?? '').split(/[\s/·,;:()–-]+/).map(w => w.length));
  const muestra = filas.slice(0, 200);
  const minimo = c => {
    const enTitulo = palabraMax(c.titulo) * 0.0065 + 0.016;
    const enCeldas = c.html || c.fecha ? 0 : Math.min(0.12, Math.max(0, ...muestra.map(f => palabraMax(c.valor(f)))) * 0.0058 + 0.016);
    return Math.max(c.fecha ? 0.075 : 0, enTitulo, enCeldas);
  };
  const mins = columnas.map(minimo);
  if (mins.reduce((a, b) => a + b, 0) < 0.95) {
    for (let k = 0; k < 3; k++) {
      const t = pesos.reduce((a, b) => a + b, 0);
      pesos.forEach((w, i) => { if (w / t < mins[i]) pesos[i] = mins[i] * t; });
    }
  }
  const total = pesos.reduce((a, b) => a + b, 0) || base;
  const colgroup = `<colgroup>${pesos.map(w => `<col style="width:${(w * 100 / total).toFixed(2)}%">`).join('')}</colgroup>`;
  return `<table class="fija">${colgroup}<thead><tr>${columnas.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.titulo)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(f => `<tr>${columnas.map(c => `<td${c.num ? ' class="num"' : c.fecha ? ' class="fecha"' : ''}${c.estilo && c.estilo(f) ? ` style="${esc(c.estilo(f))}"` : ''}>${c.html ? c.valor(f) : esc(c.valor(f) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/**
 * Columnas y filas de tablaPDF a partir de una tabla HTML de la pantalla (Tablero, Equipo y capacidad):
 * mismos títulos, anchos proporcionales a los de la pantalla, el texto elegido en cada lista desplegable,
 * barras de avance y color de fondo de cada celda.
 */
export function tablaDePantalla(tabla) {
  if (!tabla) return '';
  const filas = [...tabla.querySelectorAll('tr')];
  const cab = filas.find(tr => tr.querySelector('th'));
  if (!cab) return '';
  const ths = [...cab.children];
  const datos = filas.filter(tr => tr !== cab).map(tr => [...tr.children].map(td => {
    const c = td.cloneNode(true);
    c.querySelectorAll('select').forEach(sel => {
      const orig = td.querySelector(`select[data-u="${sel.dataset.u}"][data-f="${sel.dataset.f}"]`) || sel;
      const t = orig.selectedIndex > 0 ? orig.options[orig.selectedIndex].text : '';
      sel.replaceWith(document.createTextNode(t));
    });
    return { html: c.innerHTML.trim(), estilo: td.getAttribute('style') || '' };
  }));
  const columnas = ths.map((th, i) => ({
    titulo: th.textContent.trim(), ancho: Math.max(40, th.offsetWidth || 100), num: th.classList.contains('num'), html: true,
    valor: f => f[i]?.html ?? '', estilo: f => (f[i]?.estilo || '').replace(/min-width:[^;]*;?/g, ''),
  }));
  return tablaPDF(columnas, datos);
}

export function kpisPDF(items) {
  return `<div class="kpis">${items.map(([t, v, color]) => `<div class="kpi" style="--kc:${color || '#4E79A7'}"><small>${esc(t)}</small><b>${esc(v)}</b></div>`).join('')}</div>`;
}

// ---------- Presentación preliminar (módulo Reportes) ----------
// Tamaños ISO 216 (serie A), en mm: ancho × alto en vertical
export const PAPELES = { A6: [105, 148], A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };

/**
 * Documento completo de un reporte para mostrarlo en un iframe e imprimirlo/guardarlo como PDF.
 * papel: A0 … A6 · orientacion: portrait | landscape · unaHoja: escala para que entre en una sola hoja.
 */
export function documentoReporte(titulo, contenidoHTML, { papel = 'A4', orientacion = 'portrait', unaHoja = false, proyectoTexto, archivo } = {}) {
  const d = new Date();
  const fecha = `${dosDig(d.getDate())}-${dosDig(d.getMonth() + 1)}-${d.getFullYear()}`;
  const hora = `${dosDig(d.getHours())}:${dosDig(d.getMinutes())}`;
  const proy = proyectoTexto || nombreProyectoActual();
  const version = param('version_app') || 'GyC V1.00.00';
  const firma = param('firma_pdf') || 'By EHCM';
  const [a, b] = PAPELES[papel] || PAPELES.A4;
  const [ancho, alto] = orientacion === 'landscape' ? [b, a] : [a, b];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(archivo || titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&family=Urbanist:wght@500;700&display=swap" rel="stylesheet">
<style>${estilosPDF({ version, proy, fecha, hora, firma })}</style>
<style>
  @page { size: ${ancho}mm ${alto}mm; }
  body { padding: 14px 0; }
  .barra { display: none; }
  .hoja { width: ${ancho}mm; min-height: ${alto}mm; }
  .hoja.land { width: ${ancho}mm; }
  @media screen { .hoja { zoom: var(--vista, 1); } }   /* la hoja entera cabe en el ancho de la vista previa */
</style></head><body>
<div class="hoja" id="hoja">
  <div class="enc"><span>${esc(version)}</span><span>${esc(proy)}</span><span>${fecha}, ${hora}</span></div>
  <h1 class="titulo">${esc(titulo)}</h1>
  <div id="contenido">${contenidoHTML}</div>
  <div class="pie"><span>${esc(firma)}</span><span>—</span><span>Vista preliminar</span></div>
</div>
<script>
  // Escala para que la hoja entera (con sus márgenes) entre en el ancho visible del marco: clientWidth descuenta la
  // barra de desplazamiento (innerWidth no), y así no se corta el borde derecho de la hoja (q67)
  const encajar = () => { const h = document.getElementById('hoja'); document.documentElement.style.setProperty('--vista', 1);
    const m = 32;   // 16 px de margen a cada lado (los márgenes «auto» no sirven para medir)
    document.documentElement.style.setProperty('--vista', Math.min(1, (document.documentElement.clientWidth - 12) / (h.offsetWidth + m))); };
  addEventListener('resize', encajar); addEventListener('load', encajar); encajar();
  // "Todo en 1 hoja": reduce el contenido hasta que entre en el alto útil de la hoja
  if (${unaHoja ? 'true' : 'false'}) {
    const ajustar = () => {
      const c = document.getElementById('contenido'); c.style.zoom = 1;
      const mm = 96 / 25.4, util = (${alto} - 20) * mm - 70, anchoUtil = (${ancho} - 20) * mm;
      const z = Math.min(1, util / c.scrollHeight, anchoUtil / c.scrollWidth);
      c.style.zoom = z;
    };
    addEventListener('load', ajustar); setTimeout(ajustar, 50);
  }
<\/script></body></html>`;
}

/**
 * Genera el informe como ARCHIVO PDF (para adjuntarlo a un correo), con el mismo documento de la vista preliminar.
 * Devuelve el contenido en base64 (sin el prefijo "data:").
 */
/** Descarga un PDF (base64) con el nombre exacto: no depende del título de la página ni del diálogo de impresión */
export function descargarPDF(nombre, base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = `${limpiarNombre(String(nombre).replace(/\.pdf$/i, ''))}.pdf`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/**
 * «Guardar PDF» (q69): genera el archivo y lo descarga con el nombre del campo, siempre el mismo. Calidad para leer
 * texto de 6,5 pt. Devuelve cuando terminó (el botón muestra «Generando…» mientras tanto).
 */
export async function guardarPDF(boton, titulo, contenidoHTML, opciones) {
  const texto = boton.textContent;
  boton.disabled = true; boton.textContent = '⏳ Generando PDF…';
  try {
    const b64 = await generarArchivoPDF(titulo, contenidoHTML, { escala: 2, calidad: 0.92, ...opciones });
    descargarPDF(opciones.archivo, b64);
  } finally { boton.disabled = false; boton.textContent = texto; }
}

export async function generarArchivoPDF(titulo, contenidoHTML, { orientacion = 'landscape', papel = 'A4', proyectoTexto, archivo, unaHoja = false, escala = 1.6, calidad = 0.82 } = {}) {
  const [a, b] = PAPELES[papel] || PAPELES.A4;
  const [anchoMm, altoMm] = orientacion === 'landscape' ? [b, a] : [a, b];
  const MARGEN = { izq: 10, der: 10, sup: 14, inf: 12 };              // mm (encabezado y pie van en los márgenes)
  const utilMm = anchoMm - MARGEN.izq - MARGEN.der;
  const utilPx = Math.round(utilMm * 96 / 25.4);
  // El marco mide exactamente el ancho útil y no tiene barras de desplazamiento: así la captura empieza en el borde
  // izquierdo del contenido y no se corta nada a la derecha (q70: en Windows la barra corría el contenido ~4 mm)
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.style.cssText = `position:fixed;left:-20000px;top:0;width:${utilPx}px;height:1200px;border:0;visibility:hidden`;
  document.body.append(marco);
  try {
    await new Promise(ok => { marco.onload = ok; marco.srcdoc = documentoReporte(titulo, contenidoHTML, { papel, orientacion, proyectoTexto, archivo, unaHoja }); });
    const doc = marco.contentDocument;
    // La librería se carga dentro del documento del informe (sus estilos no se mezclan con los del aplicativo)
    await new Promise((ok, mal) => {
      const s = doc.createElement('script');
      s.src = new URL('vendor/html2pdf.bundle.min.js', location.href).href;
      s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar el generador de PDF.'));
      doc.head.append(s);
    });
    await doc.fonts?.ready?.catch?.(() => {});
    await new Promise(r => setTimeout(r, 150));
    // Encabezado y pie: se leen del documento y se dibujan en TODAS las hojas (abajo, con jsPDF)
    const enc = [...doc.querySelectorAll('.enc span')].map(x => x.textContent.trim());
    const firma = doc.querySelector('.pie span')?.textContent.trim() || '';
    doc.querySelector('.enc')?.remove();
    doc.querySelector('.pie')?.remove();
    const estilo = doc.createElement('style');
    estilo.textContent = 'html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }';
    doc.head.append(estilo);
    const hoja = doc.getElementById('hoja');
    Object.assign(hoja.style, { zoom: 1, width: `${utilPx}px`, minHeight: '0', padding: '0', margin: '0', boxShadow: 'none', boxSizing: 'border-box' });
    // Las opciones se crean dentro del marco: la librería valida con "instanceof Array" de su propio documento
    const opciones = marco.contentWindow.JSON.parse(JSON.stringify({
      margin: [MARGEN.sup, MARGEN.der, MARGEN.inf, MARGEN.izq],
      image: { type: 'jpeg', quality: calidad },
      html2canvas: { scale: escala, useCORS: true, backgroundColor: '#FFFFFF', scrollX: 0, scrollY: 0, x: 0, windowWidth: utilPx, width: utilPx },
      jsPDF: { unit: 'mm', format: papel.toLowerCase(), orientation: orientacion },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'h3', '.pa-pdf-graf', '.kpi', 'figure', '.pdf-bloque'] },   // .pdf-bloque: título junto a su tabla
    }));
    const pdf = await marco.contentWindow.html2pdf().set(opciones).from(hoja).toPdf().get('pdf');
    const n = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor(85, 85, 85);
      const ySup = 8, yInf = altoMm - 6;
      if (enc[0]) pdf.text(enc[0], MARGEN.izq, ySup);
      if (enc[1]) pdf.text(enc[1], anchoMm / 2, ySup, { align: 'center' });
      if (enc[2]) pdf.text(enc[2], anchoMm - MARGEN.der, ySup, { align: 'right' });
      pdf.setDrawColor(224, 224, 224); pdf.setLineWidth(0.2);
      pdf.line(MARGEN.izq, ySup + 1.6, anchoMm - MARGEN.der, ySup + 1.6);
      pdf.line(MARGEN.izq, yInf - 3, anchoMm - MARGEN.der, yInf - 3);
      pdf.setTextColor(119, 119, 119);
      if (firma) pdf.text(firma, MARGEN.izq, yInf);
      pdf.text(`Página ${i} de ${n}`, anchoMm - MARGEN.der, yInf, { align: 'right' });
    }
    return String(pdf.output('datauristring')).split(',')[1];
  } finally {
    marco.remove();
  }
}
