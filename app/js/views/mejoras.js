// Solicitudes de cambio del aplicativo (M-15): registro de ampliaciones de alcance (principio P3).
import { api, mensajeError } from '../data/api.js';
import { store, puede, nombre } from '../core/store.js';
import { esc, html, fmtFecha } from '../core/util.js';
import { pedirDatos, ok, error, badge, vacio } from '../ui/ui.js';

const ESTADOS = { recibida: ['Recibida', '#BAB0AC'], en_analisis: ['En análisis', '#EDC948'], aprobada: ['Aprobada', '#4E79A7'],
  en_desarrollo: ['En desarrollo', '#F28E2B'], entregada: ['Entregada', '#59A14F'], descartada: ['Descartada', '#E15759'] };

// Las mejoras son del aplicativo: las ven todos los usuarios de todas las empresas (pedido q7). Las entrega el servidor
// (admin-usuarios), porque cada empresa solo puede leer sus propios datos. Las gestionan los propietarios de la plataforma
// y, en su empresa, quien tiene el permiso «ver_solicitud».
async function leer() {
  try {
    const r = await api.adminUsuarios('mejoras');
    return { items: r.mejoras || [], plataforma: !!r.gestiona, todas: true };
  } catch {
    // Servidor sin la acción todavía: las de la propia empresa
    const items = await api.list('solicitudes_cambio', { eq: { area_id: store.area.id }, order: [['created_at', false]] });
    return { items: items.map(s => ({ ...s, autor_nombre: nombre(s.autor_id), empresa: store.area.nombre })), plataforma: false, todas: false };
  }
}

export async function render(el) {
  el.innerHTML = '';
  const { items, plataforma, todas } = await leer();
  const puedeGestionar = s => plataforma || (puede('ver_solicitud') && s.area_id === store.area.id);
  el.append(html(`<div>
    <div class="pagina-cab"><h1>Mejoras del aplicativo</h1><span class="pagina-sub">Pida mejoras o reporte errores de LPS-GES${todas ? ' · solicitudes de todas las empresas' : ''}</span>
      <span class="flex"></span><button class="btn btn-primario" data-a="nueva">＋ Nueva solicitud</button></div>
    <div class="tarjeta">${items.length ? `<table class="simple"><tr><th>Fecha</th><th>Solicitud</th><th>Pantalla</th><th>Empresa</th><th>Autor</th><th>Prioridad</th><th>Estado</th><th>Respuesta</th><th></th></tr>
      ${items.map(s => `<tr><td>${fmtFecha(s.created_at)}</td><td><b>${esc(s.titulo)}</b><div class="nota">${esc(s.descripcion || '')}</div></td><td>${esc(s.pantalla || '')}</td>
        <td>${esc(s.empresa || '')}</td><td>${esc(s.autor_nombre || nombre(s.autor_id))}</td><td>${esc(s.prioridad)}</td><td>${badge(...(ESTADOS[s.estado] || [s.estado, '#BAB0AC']))}</td><td class="nota">${esc(s.respuesta || '')}</td>
        <td>${puedeGestionar(s) ? `<button class="btn btn-sm" data-g="${s.id}">Gestionar</button>` : ''}</td></tr>`).join('')}</table>` : vacio('Aún no hay solicitudes.')}</div></div>`));
  el.querySelector('[data-a="nueva"]').onclick = async () => {
    await pedirDatos({ titulo: 'Nueva solicitud de mejora',
      campos: [{ name: 'titulo', label: 'Título', required: true, full: true }, { name: 'descripcion', label: 'Descripción', type: 'textarea', required: true },
        { name: 'pantalla', label: 'Pantalla', type: 'select', options: ['Plan semanal', 'Look Ahead', 'Restricciones', 'Cartera', 'Tablero', 'Reunión', 'Equipo', 'Proyectos', 'Configuración', 'Otra'].map(v => ({ value: v, label: v })) },
        { name: 'prioridad', label: 'Prioridad sugerida', type: 'select', options: [{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Media' }, { value: 'baja', label: 'Baja' }], value: 'media' }],
      alGuardar: async d => { await api.insert('solicitudes_cambio', { ...d, area_id: store.area.id, autor_id: store.usuario.id }); ok('Solicitud registrada. ¡Gracias!'); } });
    render(el);
  };
  el.querySelectorAll('[data-g]').forEach(b => b.onclick = async () => {
    const s = items.find(x => x.id === b.dataset.g);
    await pedirDatos({ titulo: 'Gestionar solicitud', valores: s,
      campos: [{ name: 'estado', label: 'Estado', type: 'select', options: Object.entries(ESTADOS).map(([value, [label]]) => ({ value, label })) },
        { name: 'prioridad', label: 'Prioridad', type: 'select', options: [{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Media' }, { value: 'baja', label: 'Baja' }] },
        { name: 'respuesta', label: 'Respuesta al autor', type: 'textarea' }],
      alGuardar: async d => {
        try {
          if (plataforma) await api.adminUsuarios('gestionar_mejora', { id: s.id, estado: d.estado, prioridad: d.prioridad, respuesta: d.respuesta || null });
          else await api.update('solicitudes_cambio', s.id, d);
          ok('Solicitud actualizada.');
        } catch (e) { error(mensajeError(e)); throw e; }
      } });
    render(el);
  });
}
