// Equipo y capacidad (6.12): ubicación diaria (reemplaza la hoja "Sitios") y capacidad semanal (M-02).
import { api, mensajeError } from '../data/api.js';
import { store, equipo, esGestor, lideres, valoresLista, horasDia, param, puede, cargarCatalogo } from '../core/store.js';
import { lunes, sumarSemanas, sumarDias, etiquetaSemana, esc, html, num, pct, DIAS_NOMBRE, fmtCorto } from '../core/util.js';
import { error, ok } from '../ui/ui.js';
import { capacidadSemana, colorCarga } from '../services/indicadores.js';
import { imprimirPDF, tablaDePantalla } from '../services/pdf.js';

let estado;

export async function render(el, { query }) {
  estado = { semana: lunes(query?.get('semana') || undefined), heredadas: new Set() };
  el.append(html(`<div>
    <div class="pagina-cab"><h1>Equipo y capacidad</h1>
      <div class="selector-semana"><button class="btn-icono" data-a="ant">◀</button><span data-sem></span><button class="btn-icono" data-a="sig">▶</button></div>
      <button class="btn btn-sm" data-a="hoy">Semana actual</button>
      <button class="btn btn-sm" data-a="copiar" title="Copiar la ubicación de la semana anterior">⧉ Copiar semana anterior</button>
      <span class="flex"></span><span data-finde></span><button class="btn btn-sm" data-a="pdf">🖨 PDF</button></div>
    <div class="aviso">Registre dónde estará cada persona cada día. Los días de vacaciones, licencia o feriado se descuentan de la capacidad semanal
      (días laborables × horas por día). Cada líder edita su fila; el administrador puede editar todas.
      Al abrir la semana actual o una futura, quien no tenga nada registrado hereda su semana anterior (sin vacaciones ni feriados): solo cambie lo que sea distinto.</div>
    <div class="tarjeta" data-tabla></div></div>`));
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'ant') { estado.semana = sumarSemanas(estado.semana, -1); pintar(); }
    if (a === 'sig') { estado.semana = sumarSemanas(estado.semana, 1); pintar(); }
    if (a === 'hoy') { estado.semana = lunes(); pintar(); }
    if (a === 'copiar') copiar();
    if (a === 'finde') {
      // Activa o desactiva el trabajo en sábado y domingo para toda el área (parámetro "trabajo_fin_semana")
      try {
        await api.upsert('parametros', { area_id: store.area.id, clave: 'trabajo_fin_semana', valor: !param('trabajo_fin_semana') }, 'area_id,clave');
        await cargarCatalogo();
        ok(param('trabajo_fin_semana') ? 'Sábado y domingo activados.' : 'Sábado y domingo desactivados.');
        await pintar();
      } catch (err) { error(mensajeError(err)); }
    }
    if (a === 'pdf') imprimirPDF('Equipo y capacidad', `<p>${esc(etiquetaSemana(estado.semana))}</p>` + tablaDePantalla(document.querySelector('[data-tabla] table')),   // anchos fijos, como las demás tablas
      { proyectoTexto: 'Todos los proyectos', orientacion: 'landscape' });
  });
  el.addEventListener('change', async e => {
    const s = e.target.closest('select[data-u]');
    if (!s) return;
    // Feedback visual inmediato: actualizar color del select antes de que llegue la respuesta
    const selColor = s.value ? store.valores.get(s.value)?.color : null;
    s.style.background = selColor ? `color-mix(in srgb,${selColor} 22%,white)` : '';
    s.closest('td').style.background = selColor ? `color-mix(in srgb,${selColor} 14%,white)` : '';
    try {
      const ex = estado.ubic.find(u => u.usuario_id === s.dataset.u && u.fecha === s.dataset.f);
      if (!s.value) { if (ex) await api.remove('ubicaciones_dia', ex.id); }
      else if (ex) await api.update('ubicaciones_dia', ex.id, { ubicacion_id: s.value });
      else await api.insert('ubicaciones_dia', { area_id: store.area.id, usuario_id: s.dataset.u, fecha: s.dataset.f, ubicacion_id: s.value });
      await pintar();
    } catch (err) { error(mensajeError(err)); }
  });
  await pintar();
}

async function pintar() {
  const area = store.area.id;
  const fin = sumarDias(estado.semana, 6);
  const leerUbic = () => api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: estado.semana }, lte: { fecha: fin } });
  // Herencia de la semana anterior y actividades en paralelo; si no se heredó nada, se reutiliza la lectura de la semana
  const [heredada, acts] = await Promise.all([
    heredarSemanaAnterior(), api.list('actividades', { eq: { area_id: area, semana: estado.semana } })]);
  const ubic = heredada.actual && !heredada.copio ? heredada.actual : await leerUbic();
  estado.ubic = ubic;
  document.querySelector('[data-sem]').textContent = etiquetaSemana(estado.semana);
  const laborables = (param('dias_laborables') || [1, 2, 3, 4, 5]).map(Number);
  const finde = !!param('trabajo_fin_semana');
  const dias = Array.from({ length: 7 }, (_, i) => i).filter(i => laborables.includes(i + 1) || i < 5 || finde);
  document.querySelector('[data-finde]').innerHTML = esGestor()
    ? `<button class="btn btn-sm${finde ? ' btn-azul' : ''}" data-a="finde" title="Mostrar u ocultar sábado y domingo para registrar trabajo esos días">${finde ? '✓ Sábado y domingo activos' : '＋ Activar sábado y domingo'}</button>`
    : (finde ? '<span class="nota">Sábado y domingo activos</span>' : '');
  const ops = valoresLista('ubicaciones');
  const personas = equipo(acts);
  document.querySelector('[data-tabla]').innerHTML = `<div style="overflow-x:auto"><table class="simple"><tr><th>Persona</th>
    ${dias.map(i => `<th class="${i >= 5 ? 'dia-finde' : ''}">${DIAS_NOMBRE[i]} ${fmtCorto(sumarDias(estado.semana, i))}</th>`).join('')}
    <th class="num">H/día</th><th class="num">Capacidad</th><th class="num">HH comprometidas</th><th>Carga</th></tr>
    ${personas.map(p => {
      const editable = esGestor() || p.id === store.usuario.id;
      const cap = capacidadSemana(p.id, estado.semana, ubic);
      const hh = acts.filter(a => a.responsable_id === p.id && a.comprometida).reduce((s, a) => s + (Number(a.hh_total) || 0), 0);
      const r = cap ? hh / cap : null;
      const cargo = p.cargo_id ? store.valores.get(p.cargo_id)?.valor : '';
      return `<tr><td><b>${esc(p.nombre)}</b>${cargo ? `<div class="nota">${esc(cargo)}</div>` : ''}</td>${dias.map(i => {
        const f = sumarDias(estado.semana, i);
        const u = ubic.find(x => x.usuario_id === p.id && x.fecha === f);
        const color = u ? store.valores.get(u.ubicacion_id)?.color : null;
        return `<td style="${color ? `background:color-mix(in srgb, ${color} 14%, white)` : ''}">${editable
          ? `<select class="sel" data-u="${p.id}" data-f="${f}" style="width:100%;${color ? `background:color-mix(in srgb,${color} 22%,white);` : ''}"><option value="">—</option>${ops.map(o => `<option value="${o.id}"${u?.ubicacion_id === o.id ? ' selected' : ''}${o.color ? ` style="background:${o.color}33"` : ''}>${esc(o.valor)}</option>`).join('')}</select>`
          : esc(u ? store.valores.get(u.ubicacion_id)?.valor : '')}</td>`;
      }).join('')}
      <td class="num">${num(horasDia(p.id))}</td><td class="num">${num(cap)}</td><td class="num">${num(hh)}</td>
      <td style="min-width:120px"><div class="barra-prog" style="--bc:${colorCarga(r)}"><i style="width:${Math.min(100, (r || 0) * 100)}%"></i></div><span class="nota">${pct(r)}</span></td></tr>`;
    }).join('')}</table></div>`;
}

// Herencia automática: al abrir la semana actual o una futura, cada persona sin nada registrado en ella recibe
// las ubicaciones de su semana anterior (sin vacaciones, licencias ni feriados). No toca semanas pasadas
// ni lo ya registrado; solo personas que quien mira puede editar.
const ES_AUSENCIA = v => !v || v.extra?.cuenta_capacidad === false || ['feriado', 'vacaciones'].includes(v.codigo);
async function heredarSemanaAnterior() {
  if (estado.semana < lunes() || estado.heredadas.has(estado.semana)) return {};
  estado.heredadas.add(estado.semana);   // solo al abrir la semana: si luego alguien borra todo, no se vuelve a heredar
  const area = store.area.id, ant = sumarSemanas(estado.semana, -1);
  try {
    const [actual, prev] = await Promise.all([
      api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: estado.semana }, lte: { fecha: sumarDias(estado.semana, 6) } }),
      api.list('ubicaciones_dia', { eq: { area_id: area }, gte: { fecha: ant }, lte: { fecha: sumarDias(ant, 6) } }),
    ]);
    const conDatos = new Set(actual.map(u => u.usuario_id));
    const copias = prev.filter(u => !conDatos.has(u.usuario_id) && (esGestor() || u.usuario_id === store.usuario.id) && !ES_AUSENCIA(store.valores.get(u.ubicacion_id)))
      .map(u => ({ area_id: area, usuario_id: u.usuario_id, fecha: sumarDias(u.fecha, 7), ubicacion_id: u.ubicacion_id }));
    if (!copias.length) return { actual };
    await api.insert('ubicaciones_dia', copias);
    const personas = new Set(copias.map(c => c.usuario_id)).size;
    ok(`Se heredó la semana anterior para ${personas} persona(s). Cambie solo lo que sea distinto.`);
    return { copio: true };
  } catch (e) { error(mensajeError(e)); return {}; }
}

async function copiar() {
  const ant = sumarSemanas(estado.semana, -1);
  try {
    const prev = await api.list('ubicaciones_dia', { eq: { area_id: store.area.id }, gte: { fecha: ant }, lte: { fecha: sumarDias(ant, 6) } });
    const propias = prev.filter(u => esGestor() || u.usuario_id === store.usuario.id);
    for (const u of propias) {
      const f = sumarDias(u.fecha, 7);
      if (estado.ubic.some(x => x.usuario_id === u.usuario_id && x.fecha === f)) continue;
      const v = store.valores.get(u.ubicacion_id);
      if (ES_AUSENCIA(v)) continue;
      await api.insert('ubicaciones_dia', { area_id: store.area.id, usuario_id: u.usuario_id, fecha: f, ubicacion_id: u.ubicacion_id });
    }
    await pintar();
  } catch (e) { error(mensajeError(e)); }
}
