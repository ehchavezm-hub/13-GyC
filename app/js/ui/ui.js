// Componentes de interfaz: avisos, ventanas modales, formularios, etiquetas y tarjetas.
import { esc, html } from '../core/util.js';

// ---------- Avisos ----------
export function toast(msg, tipo = 'info', ms = 4000) {
  let cont = document.getElementById('toasts');
  if (!cont) { cont = html('<div id="toasts" role="status" aria-live="polite"></div>'); document.body.append(cont); }
  const t = html(`<div class="toast toast-${tipo}">${esc(msg)}</div>`);
  cont.append(t);
  setTimeout(() => t.classList.add('saliendo'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
export const ok = m => toast(m, 'ok');
export const error = m => toast(m, 'error', 7000);

// ---------- Modal ----------
export function modal({ titulo, cuerpo, botones = [], ancho = 560, alCerrar }) {
  const fondo = html(`<div class="modal-fondo"><div class="modal" role="dialog" aria-modal="true" style="max-width:${ancho}px">
    <div class="modal-cab"><h2>${esc(titulo)}</h2><button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="modal-cuerpo"></div><div class="modal-pie"></div></div></div>`);
  const cuerpoEl = fondo.querySelector('.modal-cuerpo');
  if (typeof cuerpo === 'string') cuerpoEl.innerHTML = cuerpo; else if (cuerpo) cuerpoEl.append(cuerpo);
  const pie = fondo.querySelector('.modal-pie');
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', tecla); alCerrar?.(); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', tecla);
  fondo.querySelector('[data-cerrar]').onclick = cerrar;
  fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(); });
  for (const b of botones) {
    const el = html(`<button class="btn ${b.clase || ''}">${esc(b.texto)}</button>`);
    el.onclick = async () => {
      if (!b.accion) return cerrar();
      el.disabled = true;
      try { if ((await b.accion(cerrar)) !== false) cerrar(); } finally { el.disabled = false; }
    };
    pie.append(el);
  }
  if (!botones.length) pie.remove();
  document.body.append(fondo);
  arrastrable(fondo.querySelector('.modal'), fondo.querySelector('.modal-cab'));
  setTimeout(() => fondo.querySelector('input,select,textarea,button.btn-primario')?.focus(), 30);
  return { cerrar, el: fondo, cuerpo: cuerpoEl };
}

/** Permite mover una ventana arrastrando su barra de título (mouse o dedo); no sale de la pantalla. */
export function arrastrable(ventana, barra) {
  if (!ventana || !barra) return;
  barra.classList.add('arrastrable');
  barra.title = 'Arrastre para mover la ventana';
  let x0, y0, dx = 0, dy = 0, bx = 0, by = 0;
  const mover = e => {
    const p = e.touches ? e.touches[0] : e;
    const r = ventana.getBoundingClientRect();
    // límites: al menos 60 px de la barra quedan visibles
    const nx = bx + p.clientX - x0, ny = by + p.clientY - y0;
    const maxX = innerWidth - 60 - (r.left - dx), minX = 60 - (r.right - dx);
    const maxY = innerHeight - 40 - (r.top - dy), minY = -(r.top - dy);
    dx = Math.min(maxX, Math.max(minX, nx)); dy = Math.min(maxY, Math.max(minY, ny));
    ventana.style.transform = `translate(${dx}px, ${dy}px)`;
    e.preventDefault();
  };
  const soltar = () => {
    document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar);
    document.removeEventListener('touchmove', mover); document.removeEventListener('touchend', soltar);
    barra.classList.remove('moviendo');
  };
  const iniciar = e => {
    if (e.target.closest('button,input,select,a')) return;   // la X y otros controles siguen funcionando
    const p = e.touches ? e.touches[0] : e;
    if (!e.touches && e.button !== 0) return;
    x0 = p.clientX; y0 = p.clientY; bx = dx; by = dy;
    barra.classList.add('moviendo');
    document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
    document.addEventListener('touchmove', mover, { passive: false }); document.addEventListener('touchend', soltar);
    e.preventDefault();
  };
  barra.addEventListener('mousedown', iniciar);
  barra.addEventListener('touchstart', iniciar, { passive: false });
}

export function confirmar(mensaje, { titulo = 'Confirmar', texto = 'Aceptar', peligro = false } = {}) {
  return new Promise(res => {
    let r = false;
    modal({
      titulo, cuerpo: `<p>${esc(mensaje)}</p>`, ancho: 440, alCerrar: () => res(r),
      botones: [{ texto: 'Cancelar' }, { texto, clase: peligro ? 'btn-peligro' : 'btn-primario', accion: () => { r = true; } }],
    });
  });
}

// ---------- Formularios ----------
/** campos: [{ name, label, type, options, required, value, help, placeholder, full, min, max, step, unaColumna }] */
export function crearFormulario(campos, valores = {}) {
  const f = html('<form class="form" novalidate></form>');
  for (const c of campos) {
    if (c.type === 'separador') { f.append(html(`<h3 class="form-sep">${esc(c.label)}</h3>`)); continue; }
    if (c.type === 'vacio') { f.append(html('<div class="campo campo-vacio" aria-hidden="true"></div>')); continue; }   // celda libre (alinea el campo siguiente)
    const v = valores[c.name] ?? c.value ?? '';
    const id = 'f-' + c.name + '-' + Math.random().toString(36).slice(2, 6);
    const req = c.required ? ' required' : '';
    let control;
    switch (c.type) {
      case 'textarea':
        control = `<textarea id="${id}" name="${c.name}" rows="${c.rows || 3}"${req} placeholder="${esc(c.placeholder || '')}">${esc(v)}</textarea>`; break;
      case 'select': {
        const ops = (c.options || []).map(o => `<option value="${esc(o.value ?? '')}"${String(o.value ?? '') === String(v ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
        control = `<select id="${id}" name="${c.name}"${req}>${ops}</select>`; break;
      }
      case 'multiselect': {
        const sel = new Set(v || []);
        control = `<div class="multi${c.unaColumna ? ' una-columna' : ''}" id="${id}" data-name="${c.name}">${(c.options || []).map(o =>
          `<label class="chk"><input type="checkbox" value="${esc(o.value)}"${sel.has(o.value) ? ' checked' : ''}> <span>${esc(o.label)}</span>${o.nota ? `<span class="nota">${esc(o.nota)}</span>` : ''}</label>`).join('')}</div>`; break;
      }
      case 'checkbox':
        control = `<label class="chk"><input type="checkbox" id="${id}" name="${c.name}"${v ? ' checked' : ''}> ${esc(c.texto || '')}</label>`; break;
      default:
        control = `<input id="${id}" name="${c.name}" type="${c.type || 'text'}" value="${esc(v)}"${req}
          ${c.min != null ? `min="${c.min}"` : ''} ${c.max != null ? `max="${c.max}"` : ''} ${c.step != null ? `step="${c.step}"` : ''}
          placeholder="${esc(c.placeholder || '')}" ${c.list ? `list="${c.list}"` : ''}>`;
    }
    f.append(html(`<div class="campo${c.full || c.type === 'textarea' || c.type === 'multiselect' ? ' campo-full' : ''}">
      <label for="${id}">${esc(c.label)}${c.required ? ' <span class="req">*</span>' : ''}</label>${control}
      ${c.help ? `<small>${esc(c.help)}</small>` : ''}</div>`));
  }
  f.leer = () => {
    const out = {};
    for (const c of campos) {
      if (c.type === 'separador' || c.type === 'vacio') continue;
      if (c.type === 'multiselect') {
        out[c.name] = [...f.querySelectorAll(`[data-name="${c.name}"] input:checked`)].map(i => i.value);
        continue;
      }
      const el = f.elements[c.name];
      if (!el) continue;
      if (c.type === 'checkbox') out[c.name] = el.checked;
      else if (c.type === 'number') out[c.name] = el.value === '' ? null : Number(el.value);
      else out[c.name] = el.value === '' ? null : el.value;
    }
    return out;
  };
  f.validar = () => {
    for (const c of campos) {
      if (!c.required || c.type === 'separador' || c.type === 'vacio') continue;
      const el = f.elements[c.name];
      if (el && !String(el.value).trim()) { el.focus(); el.classList.add('invalido'); return `Complete el campo "${c.label}".`; }
    }
    return null;
  };
  return f;
}

/** Abre un formulario en una ventana y devuelve los valores (o null si se cancela). */
export function pedirDatos({ titulo, campos, valores, texto = 'Guardar', ancho = 620, antes, alGuardar }) {
  return new Promise(res => {
    const form = crearFormulario(campos, valores);
    let resultado = null;
    if (antes) form.prepend(typeof antes === 'string' ? html(`<div class="campo-full nota">${antes}</div>`) : antes);
    modal({
      titulo, cuerpo: form, ancho, alCerrar: () => res(resultado),
      botones: [{ texto: 'Cancelar' }, {
        texto, clase: 'btn-primario', accion: async () => {
          const err = form.validar();
          if (err) { error(err); return false; }
          const datos = form.leer();
          if (alGuardar) {
            try { await alGuardar(datos); } catch (e) { error(e.message || String(e)); return false; }
          }
          resultado = datos;
        },
      }],
    });
    form.addEventListener('submit', e => e.preventDefault());
  });
}

// ---------- Etiquetas y tarjetas ----------
export function badge(texto, color = '#BAB0AC') {
  return `<span class="badge" style="--c:${color}">${esc(texto)}</span>`;
}

export function kpi(titulo, valor, { sub = '', color = '', icono = '' } = {}) {
  return `<div class="kpi"${color ? ` style="--kc:${color}"` : ''}><div class="kpi-tit">${icono} ${esc(titulo)}</div>
    <div class="kpi-val">${valor}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

export function vacio(texto, accion = '') {
  return `<div class="vacio"><div class="vacio-icono">○</div><p>${esc(texto)}</p>${accion}</div>`;
}

export function cargando(el, texto = 'Cargando…') {
  el.innerHTML = `<div class="cargando"><span class="spinner"></span> ${esc(texto)}</div>`;
}
