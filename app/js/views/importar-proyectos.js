// Importar proyectos desde Excel: asistente con vista previa.
// Reconoce los títulos de columna (en cualquier orden y hoja), agrega los proyectos nuevos, actualiza los existentes
// (mismo código) con los datos que traiga el archivo y ofrece agregar a las listas las gerencias, fases o países nuevos.
import { api, mensajeError } from '../data/api.js';
import { store, cargarCatalogo, valoresLista, puede, esGestor } from '../core/store.js';
import { esc, html, normalizar, parseFecha, fmtFecha, libExcel } from '../core/util.js';
import { modal, ok, error, toast } from '../ui/ui.js';

// Campo del proyecto ← títulos posibles en el Excel (normalizados)
const CAMPOS = [
  ['codigo', 'Código', ['codigo', 'cod', 'cod.', 'cr', 'codigo proyecto', 'codigo de proyecto', 'cet', 'codigo (cet)']],
  ['nombre_corto', 'Nombre corto', ['nombre corto', 'proyecto', 'proyecto / proceso', 'nombre', 'nombre del proyecto']],
  ['nombre_completo', 'Nombre completo', ['nombre completo', 'descripcion', 'nombre largo']],
  ['gerencia', 'Gerencia', ['gerencia', 'programa', 'cliente', 'cliente interno']],
  ['fase', 'Fase', ['fase', 'etapa']],
  ['pais', 'País', ['pais', 'país']],
  ['estado', 'Estado', ['estado']],
  ['fecha_inicio', 'Inicio', ['inicio', 'fecha inicio', 'fecha de inicio', 'inicio previsto']],
  ['fecha_fin', 'Fin', ['fin', 'fecha fin', 'fecha de fin', 'fin previsto', 'termino', 'término']],
];
// Si ningún título coincide exacto, se acepta el que contenga una de estas palabras (p. ej. "Gerencia responsable")
const CONTIENE = {
  codigo: ['codigo', 'cod.'], nombre_corto: ['nombre corto', 'proyecto'], nombre_completo: ['completo', 'descripcion'],
  gerencia: ['gerencia', 'cliente', 'programa'], fase: ['fase', 'etapa'], pais: ['pais'], estado: ['estado'],
  fecha_inicio: ['inicio'], fecha_fin: ['fecha fin', 'fin previsto', 'termino', 'fecha de fin'],
};
const LISTA_DE = { gerencia: 'gerencias', fase: 'fases', pais: 'paises' };
const COLUMNA_DE = { gerencia: 'gerencia_id', fase: 'fase_id', pais: 'pais_id' };

/** Abre el selector de archivo. Debe llamarse directamente desde el clic (el navegador lo exige). */
export function elegirArchivoProyectos() {
  const inp = html('<input type="file" accept=".xlsx,.xlsm,.xls,.csv" style="display:none">');
  document.body.append(inp);
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) importarProyectos(f); };
  inp.click();
}

function leerHojas(wb) {
  const hojas = [];
  for (const nombre of wb.SheetNames) {
    const filas = window.XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
    for (let i = 0; i < Math.min(25, filas.length); i++) {
      const cab = (filas[i] || []).map(c => normalizar(c));
      const mapa = {};
      for (const [campo, , titulos] of CAMPOS) {
        const j = cab.findIndex(c => c && titulos.includes(c));
        if (j >= 0 && !Object.values(mapa).includes(j)) mapa[campo] = j;
      }
      for (const [campo] of CAMPOS) {
        if (mapa[campo] !== undefined) continue;
        const j = cab.findIndex((c, k) => c && !Object.values(mapa).includes(k) && CONTIENE[campo].some(w => c.includes(w)));
        if (j >= 0) mapa[campo] = j;
      }
      // Sin "nombre corto" se usa el nombre completo
      if (mapa.nombre_corto === undefined && mapa.nombre_completo !== undefined) mapa.nombre_corto = mapa.nombre_completo;
      if (mapa.codigo === undefined || mapa.nombre_corto === undefined) continue;
      // Basta el código: para un proyecto que ya existe se puede traer solo lo que cambia (p. ej. la fase)
      const datos = filas.slice(i + 1).filter(f => f && f[mapa.codigo] != null && String(f[mapa.codigo]).trim() &&
        !String(f[mapa.nombre_corto] ?? '').startsWith('='));
      hojas.push({ nombre, cab: filas[i], mapa, datos, puntos: Object.keys(mapa).length * 1000 + datos.length });
      break;
    }
  }
  return hojas.sort((a, b) => b.puntos - a.puntos);
}

function valorDeLista(clave, texto) {
  if (!texto) return null;
  const n = normalizar(texto);
  const vs = valoresLista(clave, { inactivos: true });
  return (vs.find(v => normalizar(v.valor) === n || normalizar(v.codigo || '') === n) ||
    (n.length >= 6 ? vs.find(v => normalizar(v.valor).length >= 6 && (normalizar(v.valor).includes(n) || n.includes(normalizar(v.valor)))) : null))?.id || null;
}
function estadoDe(texto) {
  const n = normalizar(texto);
  if (!n) return null;
  const v = valoresLista('estados_proyecto', { inactivos: true }).find(x => normalizar(x.valor) === n || x.codigo === n);
  return v?.codigo || null;
}
/** Datos del proyecto que trae una fila del Excel (solo las celdas con valor). */
function datosDe(f) {
  const d = {};
  if (f.nombre_corto) d.nombre_corto = f.nombre_corto;
  if (f.nombre_completo) d.nombre_completo = f.nombre_completo;
  for (const campo of Object.keys(LISTA_DE)) { const id = valorDeLista(LISTA_DE[campo], f[campo]); if (id) d[COLUMNA_DE[campo]] = id; }
  const est = estadoDe(f.estado); if (est) d.estado = est;
  const fi = parseFecha(f.fecha_inicio); if (fi) d.fecha_inicio = fi;
  const ff = parseFecha(f.fecha_fin); if (ff) d.fecha_fin = ff;
  return d;
}
const NOMBRE_CAMPO = { nombre_corto: 'Nombre corto', nombre_completo: 'Nombre completo', gerencia_id: 'Gerencia', fase_id: 'Fase', pais_id: 'País',
  estado: 'Estado', fecha_inicio: 'Inicio', fecha_fin: 'Fin' };
/** Campos que cambiarían en un proyecto existente (incluye los valores de lista que aún hay que agregar). */
function cambiosDe(p, f, faltantes) {
  const d = datosDe(f);
  const c = Object.keys(d).filter(k => String(p[k] ?? '') !== String(d[k]));
  for (const [campo, vals] of Object.entries(faltantes)) if (vals.includes(f[campo])) c.push(COLUMNA_DE[campo]);
  return [...new Set(c)].map(k => NOMBRE_CAMPO[k] || k);
}
const texto = v => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

function analizar(hoja) {
  const filas = hoja.datos.map(f => {
    const g = campo => (hoja.mapa[campo] === undefined ? '' : texto(f[hoja.mapa[campo]]));
    return { codigo: g('codigo'), nombre_corto: g('nombre_corto'), nombre_completo: g('nombre_completo'), gerencia: g('gerencia'),
      fase: g('fase'), pais: g('pais'), estado: g('estado'), fecha_inicio: g('fecha_inicio'), fecha_fin: g('fecha_fin') };
  });
  // Un código repetido en el archivo: vale la última fila
  const unicas = [...new Map(filas.map(f => [normalizar(f.codigo), f])).values()];
  const existente = f => store.proyectos.find(p => normalizar(p.codigo) === normalizar(f.codigo));
  const nuevos = unicas.filter(f => !existente(f) && f.nombre_corto);
  const sinNombre = unicas.filter(f => !existente(f) && !f.nombre_corto);
  const existentes = unicas.filter(f => existente(f));
  const faltantes = {};
  for (const campo of Object.keys(LISTA_DE)) {
    const vals = [...new Set(unicas.map(f => f[campo]).filter(Boolean))].filter(t => !valorDeLista(LISTA_DE[campo], t));
    if (vals.length) faltantes[campo] = vals;
  }
  return { unicas, nuevos, sinNombre, existentes, faltantes, existente };
}

export async function importarProyectos(archivo) {
  let hojas;
  try {
    await libExcel();
    const wb = window.XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellDates: true });
    hojas = leerHojas(wb);
  } catch (e) { return error('No se pudo leer el archivo: ' + e.message); }
  if (!hojas.length) {
    return modal({ titulo: 'Importar proyectos', ancho: 620, botones: [{ texto: 'Entendido', clase: 'btn-primario' }],
      cuerpo: `<p>No se encontró una hoja con columnas de <b>código</b> y <b>nombre</b> del proyecto.</p>
        <p class="nota">Títulos que se reconocen: ${CAMPOS.map(([, t, alias]) => `<b>${esc(t)}</b> (${esc(alias.slice(0, 3).join(', '))})`).join(' · ')}.
        La fila de títulos puede estar en cualquiera de las primeras 25 filas.</p>` });
  }
  const puedeListas = esGestor();
  const cuerpo = html('<div></div>');
  let hoja = hojas[0], a = analizar(hoja);
  const pintar = () => {
    a = analizar(hoja);
    const asignados = CAMPOS.filter(([c]) => hoja.mapa[c] !== undefined)
      .map(([c, t]) => `${esc(t)} ← “${esc(texto(hoja.cab[hoja.mapa[c]]))}”`).join(' · ');
    const falt = Object.entries(a.faltantes).map(([c, v]) => `${CAMPOS.find(x => x[0] === c)[1]}: ${v.join(', ')}`).join(' · ');
    cuerpo.innerHTML = `
      ${hojas.length > 1 ? `<label>Hoja: <select class="sel" data-hoja>${hojas.map((h, i) => `<option value="${i}"${h === hoja ? ' selected' : ''}>${esc(h.nombre)} (${h.datos.length} filas)</option>`).join('')}</select></label>` : `<p class="nota">Hoja: <b>${esc(hoja.nombre)}</b></p>`}
      <p class="nota" style="margin-top:6px">Columnas reconocidas: ${asignados}</p>
      <div class="kpis" style="margin:10px 0">
        <div class="kpi"><div class="kpi-tit">Nuevos</div><div class="kpi-val">${a.nuevos.length}</div></div>
        <div class="kpi"><div class="kpi-tit">Ya existen (mismo código)</div><div class="kpi-val">${a.existentes.length}</div>
          <div class="kpi-sub">${a.existentes.filter(f => cambiosDe(a.existente(f), f, a.faltantes).length).length} se actualizarán con los datos del archivo</div></div>
        ${a.sinNombre.length ? `<div class="kpi" style="--kc:#E15759"><div class="kpi-tit">Nuevos sin nombre (se omiten)</div><div class="kpi-val">${a.sinNombre.length}</div></div>` : ''}</div>
      <p class="nota">Los proyectos que ya existen se actualizan con los datos del archivo (solo las celdas con valor; una celda vacía no borra nada).</p>
      ${falt ? (puedeListas
        ? `<label class="chk" style="margin-top:6px"><input type="checkbox" data-listas checked> Agregar a las listas los valores nuevos: ${esc(falt)}</label>`
        : `<div class="aviso warn" style="margin-top:6px">Valores que no existen en las listas (quedarán vacíos; pida al administrador que los agregue): ${esc(falt)}</div>`) : ''}
      <div style="max-height:300px;overflow:auto;margin-top:10px"><table class="simple"><tr><th></th><th>Código</th><th>Nombre corto</th><th>Gerencia</th><th>Fase</th><th>País</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Cambios</th></tr>
        ${a.unicas.map(f => `<tr><td>${a.existente(f) ? '<span class="nota">existe</span>' : f.nombre_corto ? '<b style="color:var(--verde)">nuevo</b>' : '<span style="color:var(--rojo)">sin nombre</span>'}</td>
          <td>${esc(f.codigo)}</td><td>${esc(f.nombre_corto)}</td><td>${esc(f.gerencia)}</td><td>${esc(f.fase)}</td><td>${esc(f.pais)}</td>
          <td>${esc(f.estado)}</td><td>${esc(fmtFecha(parseFecha(f.fecha_inicio)) || '')}</td><td>${esc(fmtFecha(parseFecha(f.fecha_fin)) || '')}</td>
          <td class="nota">${a.existente(f) ? esc(cambiosDe(a.existente(f), f, a.faltantes).join(', ') || 'sin cambios') : ''}</td></tr>`).join('')}</table></div>`;
    cuerpo.querySelector('[data-hoja]')?.addEventListener('change', e => { hoja = hojas[Number(e.target.value)]; pintar(); });
  };
  pintar();
  modal({
    titulo: `Importar proyectos · ${archivo.name}`, cuerpo, ancho: 980,
    botones: [{ texto: 'Cancelar' }, { texto: 'Importar', clase: 'btn-primario', accion: async () => {
      const actualizar = true;   // siempre se actualizan los existentes con los datos del archivo
      const agregarListas = cuerpo.querySelector('[data-listas]')?.checked;
      try {
        let valoresNuevos = 0;
        if (agregarListas) {
          for (const [campo, textos] of Object.entries(a.faltantes)) {
            const clave = LISTA_DE[campo];
            const info = store.listas[clave];
            if (!info) continue;
            let orden = Math.max(0, ...info.valores.map(v => Number(v.orden) || 0));
            for (const t of textos) {
              orden += 10;
              await api.insert('lista_valores', { lista_id: info.lista.id, valor: t, codigo: clave === 'gerencias' && t.length <= 12 ? t : null, orden, activo: true, extra: {} });
              valoresNuevos++;
            }
          }
          await cargarCatalogo();
        }
        if (a.nuevos.length) {
          await api.insert('proyectos', a.nuevos.map(f => ({ area_id: store.area.id, codigo: f.codigo, estado: 'activo', extra: {}, ...datosDe(f) })));
        }
        let actualizados = 0;
        if (actualizar) {
          for (const f of a.existentes) {
            const p = a.existente(f);
            const d = datosDe(f);
            if (!p.estado && !d.estado) d.estado = 'activo';   // proyectos que quedaron sin estado
            const cambios = Object.fromEntries(Object.entries(d).filter(([k, v]) => String(p[k] ?? '') !== String(v)));
            if (Object.keys(cambios).length) { await api.update('proyectos', p.id, cambios); actualizados++; }
          }
        }
        await cargarCatalogo();
        ok(`Importación terminada: ${a.nuevos.length} proyecto(s) nuevo(s), ${actualizados} actualizado(s)${valoresNuevos ? `, ${valoresNuevos} valor(es) agregados a las listas` : ''}.`);
        (await import('./proyectos.js')).refrescarCatalogo();
      } catch (e) { error(mensajeError(e)); return false; }
    } }],
  });
  if (!a.nuevos.length && !a.existentes.length) toast('El archivo no tiene filas con código y nombre.', 'warn');
}
