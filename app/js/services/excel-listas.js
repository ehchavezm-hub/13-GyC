// Pedido d9: exportar e importar por Excel (XLS) cualquier lista de Configuración › Listas.
// Importar nunca borra: agrega los valores nuevos y actualiza los que cambiaron; los que no están en el archivo se conservan.
// Cada fila se reconoce por su ID (columna oculta al exportar), o por su Código, o por su Texto visible.
import { api, mensajeError } from '../data/api.js';
import { store, cargarCatalogo, proyecto } from '../core/store.js';
import { esc, html, normalizar, libExcel } from '../core/util.js';
import { modal, ok, error } from '../ui/ui.js';

const SI = v => /^(si|sí|s|x|1|true|verdadero|activo)$/i.test(String(v ?? '').trim());
const texto = v => String(v ?? '').trim();

// Columnas del archivo según la lista
function columnas(clave) {
  const cols = [{ cab: 'ID', campo: 'id' }];
  if (clave === 'servicios') cols.push({ cab: 'CET', campo: 'codigo' }, { cab: 'Servicio', campo: 'valor' });   // r3: sin Proyecto (como la pantalla; una columna Proyecto en el archivo se ignora)
  else cols.push({ cab: 'Texto visible', campo: 'valor' }, { cab: 'Código', campo: 'codigo' }, { cab: 'Descripción', campo: 'descripcion' }, { cab: 'Color', campo: 'color' });
  cols.push({ cab: 'Orden', campo: 'orden' }, { cab: 'Activo', campo: 'activo' });
  if (clave === 'ubicaciones') cols.push({ cab: 'Cuenta para capacidad', campo: '_cuenta' });
  return cols;
}
const codigoProyecto = id => { const p = proyecto(id); return p ? p.codigo : ''; };
const proyectoPorCodigo = c => { const n = normalizar(texto(c).split('·')[0].trim()); return n ? store.proyectos.find(p => normalizar(p.codigo) === n)?.id || null : null; };

export async function exportarLista(clave) {
  const { lista } = store.listas[clave] || {};
  if (!lista) return;
  const XLSX = await libExcel();
  const valores = await api.list('lista_valores', { eq: { lista_id: lista.id }, order: [['orden', true]] });
  const cols = columnas(clave);
  const filas = valores.map(v => cols.map(c => c.campo === '_proyecto' ? codigoProyecto(v.extra?.proyecto_id)
    : c.campo === '_cuenta' ? (v.extra?.cuenta_capacidad !== false ? 'Sí' : 'No')
    : c.campo === 'activo' ? (v.activo ? 'Sí' : 'No') : (v[c.campo] ?? '')));
  const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c.cab), ...filas]);
  ws['!cols'] = cols.map(c => ({ wch: c.campo === 'id' ? 38 : ['valor', 'descripcion'].includes(c.campo) ? 45 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lista');
  XLSX.writeFile(wb, `Lista_${lista.nombre.replace(/[^\wáéíóúñÁÉÍÓÚÑ]+/g, '_')}.xlsx`);
  ok(`Exportados ${valores.length} valor(es) de "${lista.nombre}". Edite el archivo y use «Importar XLS»: no borre la columna ID.`);
}

export function importarLista(clave, alTerminar) {
  const entrada = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx,.xls,.csv' });
  entrada.onchange = () => entrada.files[0] && leer(clave, entrada.files[0]).then(r => r && alTerminar?.()).catch(e => error(mensajeError(e)));
  entrada.click();
}

async function leer(clave, archivo) {
  const { lista } = store.listas[clave] || {};
  if (!lista) return false;
  const XLSX = await libExcel();
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
  const filasArchivo = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  if (filasArchivo.length < 2) { error('El archivo no tiene filas.'); return false; }
  const cols = columnas(clave);
  const cab = filasArchivo[0].map(c => normalizar(texto(c)));
  const pos = Object.fromEntries(cols.map(c => [c.campo, cab.indexOf(normalizar(c.cab))]));
  const principal = clave === 'servicios' ? 'Servicio' : 'Texto visible';
  if (pos.valor < 0) { error(`Falta la columna «${principal}» en la primera fila del archivo.`); return false; }

  const actuales = await api.list('lista_valores', { eq: { lista_id: lista.id } });
  const porId = new Map(actuales.map(v => [v.id, v]));
  const porCodigo = new Map(actuales.filter(v => v.codigo).map(v => [normalizar(v.codigo), v]));
  const porValor = new Map(actuales.map(v => [normalizar(v.valor), v]));
  const nuevos = [], cambios = [], avisos = [];
  let iguales = 0;
  filasArchivo.slice(1).forEach((f, i) => {
    const celda = campo => (pos[campo] >= 0 ? f[pos[campo]] : undefined);
    const valor = texto(celda('valor'));
    if (!valor && !f.some(x => texto(x))) return;   // fila vacía
    if (!valor) { avisos.push(`Fila ${i + 2}: sin «${principal}», se omite.`); return; }
    const d = { valor };
    if (pos.codigo >= 0) d.codigo = texto(celda('codigo')) || null;
    if (pos.descripcion >= 0) d.descripcion = texto(celda('descripcion')) || null;
    if (pos.color >= 0) d.color = texto(celda('color')) || null;
    if (pos.orden >= 0 && texto(celda('orden')) !== '') { const n = Number(celda('orden')); if (Number.isFinite(n)) d.orden = n; }
    if (pos.activo >= 0 && texto(celda('activo')) !== '') d.activo = SI(celda('activo'));
    const existente = porId.get(texto(celda('id'))) || (d.codigo && porCodigo.get(normalizar(d.codigo))) || porValor.get(normalizar(valor));
    const extra = { ...(existente?.extra || {}) };
    if (pos._proyecto >= 0) {
      const c = texto(celda('_proyecto'));
      const pid = proyectoPorCodigo(c);
      if (c && !pid) avisos.push(`Fila ${i + 2}: el proyecto «${c}» no existe en Proyectos / Procesos; se deja sin proyecto.`);
      extra.proyecto_id = pid;
    }
    if (pos._cuenta >= 0 && texto(celda('_cuenta')) !== '') extra.cuenta_capacidad = SI(celda('_cuenta'));
    // extra solo si cambia algo de verdad (sin proyecto = null o ausente; cuenta para capacidad = true o ausente)
    const ex = existente?.extra || {};
    const cambiaExtra = (extra.proyecto_id ?? null) !== (ex.proyecto_id ?? null) || (extra.cuenta_capacidad ?? true) !== (ex.cuenta_capacidad ?? true);
    if ((pos._proyecto >= 0 || pos._cuenta >= 0) && (!existente || cambiaExtra)) d.extra = extra;
    if (!existente) { nuevos.push({ lista_id: lista.id, activo: true, orden: (actuales.length + nuevos.length + 1) * 10, extra: {}, ...d }); return; }
    // Valor protegido (usado por los cálculos): conserva su código y su estado
    if (existente.protegido) { delete d.codigo; delete d.activo; }
    const dif = Object.fromEntries(Object.entries(d).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(existente[k] ?? null)));
    if (Object.keys(dif).length) cambios.push({ existente, dif }); else iguales++;
  });
  const sinTocar = actuales.length - cambios.length - iguales;
  return confirmarImportacion({ lista, nuevos, cambios, iguales, sinTocar, avisos });
}

function confirmarImportacion({ lista, nuevos, cambios, iguales, sinTocar, avisos }) {
  const lis = (titulo, items) => items.length ? `<p><b>${titulo}</b></p><ul class="lista-compacta">${items.slice(0, 12).map(t => `<li>${esc(t)}</li>`).join('')}${items.length > 12 ? `<li>… y ${items.length - 12} más</li>` : ''}</ul>` : '';
  const cuerpo = html(`<div>
    <p>Lista <b>${esc(lista.nombre)}</b>: <b>${nuevos.length}</b> nuevo(s), <b>${cambios.length}</b> con cambios, ${iguales} sin cambios.
    ${sinTocar > 0 ? `<br>${sinTocar} valor(es) de la lista no están en el archivo: <b>se conservan</b> (importar nunca borra).` : ''}</p>
    ${lis('Se agregan', nuevos.map(n => n.valor))}
    ${lis('Se actualizan', cambios.map(c => `${c.existente.valor}: ${Object.keys(c.dif).map(k => ({ valor: 'texto', codigo: 'código', descripcion: 'descripción', extra: 'proyecto / capacidad' }[k] || k)).join(', ')}`))}
    ${lis('Avisos', avisos)}</div>`);
  if (!nuevos.length && !cambios.length) {
    modal({ titulo: 'Importar XLS', cuerpo, botones: [{ texto: 'Cerrar', clase: 'btn-primario' }] });
    return Promise.resolve(false);
  }
  return new Promise(resolver => {
    let hecho = false;
    modal({
      titulo: 'Importar XLS: revise antes de aplicar', cuerpo, ancho: 640, alCerrar: () => resolver(hecho),
      botones: [{ texto: 'Cancelar' }, { texto: 'Aplicar', clase: 'btn-excel', accion: async () => {
        try {
          if (nuevos.length) await api.insert('lista_valores', nuevos);
          for (const c of cambios) await api.update('lista_valores', c.existente.id, c.dif);
          await cargarCatalogo();
          ok(`Lista "${lista.nombre}": ${nuevos.length} agregado(s) y ${cambios.length} actualizado(s).`);
          hecho = true;
        } catch (e) { error(mensajeError(e)); return false; }
      } }],
    });
  });
}

// ---------- Catálogos de Proyectos / Procesos y de Grupos LPS ----------
const ESTADOS = { activo: 'Activo', en_pausa: 'En pausa', cerrado: 'Cerrado', propuesto: 'Propuesto', rechazado: 'Rechazado' };
const estadoDe = t => Object.entries(ESTADOS).find(([, e]) => normalizar(e) === normalizar(t))?.[0] || null;
const etiquetaLista = id => (id ? store.valores.get(id)?.valor || '' : '');

export async function exportarCatalogo(grupos) {
  const XLSX = await libExcel();
  const ps = store.proyectos.filter(p => !!p.padre_id === !!grupos).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
  const cab = grupos ? ['Código', 'Nombre del grupo', 'Descripción', 'Pertenece al proyecto', 'Estado', 'Inicio', 'Fin']
    : ['Código', 'Nombre corto', 'Nombre completo', 'Gerencia', 'Fase', 'País', 'Estado', 'Inicio', 'Fin'];
  const filas = ps.map(p => grupos
    ? [p.codigo, p.nombre_corto, p.nombre_completo || '', codigoProyecto(p.padre_id), ESTADOS[p.estado] || p.estado, p.fecha_inicio || '', p.fecha_fin || '']
    : [p.codigo, p.nombre_corto, p.nombre_completo || '', etiquetaLista(p.gerencia_id), etiquetaLista(p.fase_id), etiquetaLista(p.pais_id), ESTADOS[p.estado] || p.estado, p.fecha_inicio || '', p.fecha_fin || '']);
  const ws = XLSX.utils.aoa_to_sheet([cab, ...filas]);
  ws['!cols'] = cab.map(c => ({ wch: /Nombre|Descripción/.test(c) ? 40 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, grupos ? 'Grupos LPS' : 'Proyectos');
  XLSX.writeFile(wb, grupos ? 'Grupos_LPS.xlsx' : 'Proyectos_Procesos.xlsx');
  ok(`Exportados ${ps.length} ${grupos ? 'Grupo(s) LPS' : 'proyecto(s)'}.`);
}

/** Grupos LPS desde Excel: se reconocen por su Código; agrega los nuevos y actualiza los existentes. Nunca borra. */
export function importarGrupos(alTerminar) {
  const entrada = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx,.xls,.csv' });
  entrada.onchange = () => entrada.files[0] && leerGrupos(entrada.files[0]).then(r => r && alTerminar?.()).catch(e => error(mensajeError(e)));
  entrada.click();
}

async function leerGrupos(archivo) {
  const XLSX = await libExcel();
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const cab = (filas[0] || []).map(c => normalizar(texto(c)));
  const i = (...nombres) => nombres.map(n => cab.indexOf(normalizar(n))).find(x => x >= 0) ?? -1;
  const c = { codigo: i('Código'), nombre: i('Nombre del grupo', 'Nombre corto', 'Nombre'), desc: i('Descripción', 'Nombre completo'),
    padre: i('Pertenece al proyecto', 'Proyecto'), estado: i('Estado'), ini: i('Inicio'), fin: i('Fin') };
  if (c.codigo < 0 || c.nombre < 0) { error('Faltan las columnas «Código» y «Nombre del grupo» en la primera fila.'); return false; }
  const nuevos = [], cambios = [], avisos = [];
  let iguales = 0;
  filas.slice(1).forEach((f, n) => {
    const codigo = texto(f[c.codigo]), nombre = texto(f[c.nombre]);
    if (!codigo && !nombre) return;
    if (!codigo || !nombre) { avisos.push(`Fila ${n + 2}: falta el código o el nombre, se omite.`); return; }
    const existente = store.proyectos.find(p => normalizar(p.codigo) === normalizar(codigo));
    if (existente && !existente.padre_id) { avisos.push(`Fila ${n + 2}: «${codigo}» es un proyecto, no un Grupo LPS; se omite.`); return; }
    const d = { nombre_corto: nombre };
    if (c.desc >= 0) d.nombre_completo = texto(f[c.desc]) || null;
    if (c.padre >= 0 && texto(f[c.padre])) {
      const pid = proyectoPorCodigo(f[c.padre]);
      if (!pid || proyecto(pid)?.padre_id) { avisos.push(`Fila ${n + 2}: el proyecto «${texto(f[c.padre])}» no existe; se omite.`); return; }
      d.padre_id = pid;
    }
    if (c.estado >= 0 && texto(f[c.estado])) { const e = estadoDe(f[c.estado]); if (e) d.estado = e; else avisos.push(`Fila ${n + 2}: estado «${texto(f[c.estado])}» no reconocido; no se cambia.`); }
    for (const [k, col] of [['fecha_inicio', c.ini], ['fecha_fin', c.fin]]) if (col >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(texto(f[col]))) d[k] = texto(f[col]);
    if (!existente) {
      if (!d.padre_id) { avisos.push(`Fila ${n + 2}: «${codigo}» es nuevo y no indica el proyecto al que pertenece; se omite.`); return; }
      nuevos.push({ area_id: store.area.id, codigo, estado: 'activo', extra: {}, ...d }); return;
    }
    const dif = Object.fromEntries(Object.entries(d).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(existente[k] ?? null)));
    if (Object.keys(dif).length) cambios.push({ existente, dif }); else iguales++;
  });
  const lis = (t, items) => items.length ? `<p><b>${t}</b></p><ul>${items.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join('')}${items.length > 12 ? `<li>… y ${items.length - 12} más</li>` : ''}</ul>` : '';
  const cuerpo = html(`<div><p><b>${nuevos.length}</b> Grupo(s) LPS nuevo(s), <b>${cambios.length}</b> con cambios, ${iguales} sin cambios.
    Los grupos que no están en el archivo <b>se conservan</b> (importar nunca borra) y sus actividades no se tocan.</p>
    ${lis('Se agregan', nuevos.map(x => `${x.codigo} · ${x.nombre_corto}`))}${lis('Se actualizan', cambios.map(x => `${x.existente.codigo}: ${Object.keys(x.dif).join(', ')}`))}${lis('Avisos', avisos)}</div>`);
  if (!nuevos.length && !cambios.length) { modal({ titulo: 'Importar XLS', cuerpo, botones: [{ texto: 'Cerrar', clase: 'btn-primario' }] }); return false; }
  return new Promise(resolver => {
    let hecho = false;
    modal({ titulo: 'Importar Grupos LPS: revise antes de aplicar', cuerpo, ancho: 640, alCerrar: () => resolver(hecho),
      botones: [{ texto: 'Cancelar' }, { texto: 'Aplicar', clase: 'btn-excel', accion: async () => {
        try {
          if (nuevos.length) await api.insert('proyectos', nuevos);
          for (const x of cambios) await api.update('proyectos', x.existente.id, x.dif);
          await cargarCatalogo();
          ok(`Grupos LPS: ${nuevos.length} agregado(s) y ${cambios.length} actualizado(s).`);
          hecho = true;
        } catch (e) { error(mensajeError(e)); return false; }
      } }] });
  });
}
