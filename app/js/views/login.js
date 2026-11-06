// Pantalla de ingreso: monta el componente oficial de Clerk (SignIn).
import { api, mensajeError } from '../data/api.js';
import { esc, html } from '../core/util.js';
import { error } from '../ui/ui.js';

export function mostrarLogin(raiz, continuar) {
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="lema">Gestión y Construcción</div>
    <div id="clerk-signin" style="min-height:60px;margin-top:14px"><div class="cargando"><span class="spinner"></span> Cargando el ingreso…</div></div>
  </div></div>`);
  raiz.append(caja);
  montarClerk(caja.querySelector('#clerk-signin'), continuar);
}

function avisoError(el, texto) {
  el.innerHTML = `<div class="aviso error">${esc(texto)}</div>
    <p class="nota" style="text-align:center;margin-top:10px"><button class="btn" onclick="location.reload()">Reintentar</button></p>`;
}

function montarClerk(el, continuar) {
  const clerk = window.Clerk;
  if (window.__clerkError || !clerk || typeof clerk.mountSignIn !== 'function') {
    return avisoError(el, window.__clerkError || 'No se pudo cargar el ingreso (Clerk). Recargue la página.');
  }
  if (!clerk.loaded) return avisoError(el, 'Clerk no terminó de iniciar. Recargue la página.');
  try {
    el.innerHTML = '';
    clerk.mountSignIn(el, {
      fallbackRedirectUrl: location.pathname + location.search,
      appearance: { variables: { colorPrimary: '#E8762B', borderRadius: '8px' } },
    });
  } catch (e) {
    console.error('mountSignIn:', e);
    return avisoError(el, `No se pudo mostrar el ingreso: ${e?.message || e}`);
  }
  // Si a los 8 s el componente sigue vacío, se avisa en lugar de dejar la caja en blanco
  setTimeout(() => {
    if (el.isConnected && !el.childElementCount && !clerk.user) {
      avisoError(el, 'El formulario de ingreso no apareció. Revise en Clerk que el dominio de este sitio esté permitido y recargue.');
    }
  }, 8000);
  // Detecta ingreso exitoso
  const unsub = clerk.addListener(({ user }) => {
    if (user) { unsub?.(); continuar(); }
  });
}

export function mostrarPendiente(raiz, mensaje) {
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="aviso warn" style="margin-top:14px">${esc(mensaje)}</div>
    <button class="btn" data-a="salir">Cerrar sesión</button></div></div>`);
  raiz.append(caja);
  caja.querySelector('[data-a="salir"]').onclick = async () => { await api.auth.salir(); location.reload(); };
}

// Contraseña temporal asignada por el administrador (debe_cambiar_clave): la persona define la suya antes de entrar.
// Se cambia con Clerk en el navegador (pide la contraseña temporal como actual).
export function mostrarNuevaClave(raiz, motivo = '') {
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    ${motivo ? `<div class="aviso warn" style="margin-top:14px">${esc(motivo)}</div>` : ''}
    <form data-f="clave" style="display:grid;gap:10px;margin-top:14px">
      <label>Contraseña actual (la temporal)<input type="password" name="actual" required autocomplete="current-password"></label>
      <label>Nueva contraseña<input type="password" name="nueva" required minlength="8" autocomplete="new-password"></label>
      <label>Repita la nueva contraseña<input type="password" name="repetir" required minlength="8" autocomplete="new-password"></label>
      <button class="btn btn-primario" type="submit">Guardar y continuar</button>
    </form>
    <p class="nota" style="text-align:center;margin-top:12px"><a href="#" data-a="salir">Cerrar sesión</a></p>
  </div></div>`);
  raiz.append(caja);
  const form = caja.querySelector('[data-f="clave"]');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (d.nueva !== d.repetir) return error('Las contraseñas no coinciden.');
    if (String(d.nueva).length < 8) return error('La contraseña debe tener al menos 8 caracteres.');
    const boton = form.querySelector('button');
    boton.disabled = true;
    try {
      await api.auth.cambiarClave(d.nueva, d.actual);
      location.reload();
    } catch (err) { error(mensajeError(err)); boton.disabled = false; }
  });
  caja.querySelector('[data-a="salir"]').onclick = async e => { e.preventDefault(); await api.auth.salir(); location.reload(); };
}
