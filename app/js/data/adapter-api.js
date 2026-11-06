/**
 * Adaptador de datos para Vercel API (api/datos.js, api/admin-usuarios.js) + Clerk Auth.
 * Misma interfaz pública que adapter-demo.js.
 */

export function crearAdaptadorApi(apiBase = '/api') {
  let _areaId = null;

  // ── Helpers de red ──────────────────────────────────────────────────────────

  async function token() {
    const session = window.Clerk?.session;
    if (!session) throw new Error('No hay sesión de Clerk activa.');
    return session.getToken();
  }

  async function post(endpoint, body) {
    const tk = await token();
    if (!tk) throw new Error('La sesión expiró. Vuelva a ingresar.');
    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tk}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function datos(body) {
    return post('/datos', body);
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async function list(tabla, f = {}) {
    return datos({ accion: 'list', tabla, ...f });
  }

  async function insert(tabla, filas) {
    const data = Array.isArray(filas) ? filas : [filas];
    return datos({ accion: 'insert', tabla, data });
  }

  async function upsert(tabla, filas, onConflict = 'id') {
    const data = Array.isArray(filas) ? filas : [filas];
    return datos({ accion: 'upsert', tabla, data, onConflict });
  }

  async function update(tabla, id, cambios) {
    return datos({ accion: 'update', tabla, id, data: cambios });
  }

  async function updateWhere(tabla, filtros, cambios) {
    return datos({ accion: 'updateWhere', tabla, data: cambios, ...filtros });
  }

  async function remove(tabla, id) {
    return datos({ accion: 'remove', tabla, id });
  }

  async function removeWhere(tabla, filtros) {
    return datos({ accion: 'removeWhere', tabla, ...filtros });
  }

  async function rpc(nombre, params = {}) {
    return datos({ accion: 'rpc', nombre, params });
  }

  // ── Admin usuarios ──────────────────────────────────────────────────────────

  async function adminUsuarios(accion, datos_) {
    return post('/admin-usuarios', { accion, ...datos_ });
  }

  // ── fijarArea ───────────────────────────────────────────────────────────────

  function fijarArea(id) {
    _areaId = id ?? null;
  }

  // ── subscribe (no-op: sin Realtime en Vercel) ───────────────────────────────

  function subscribe(_tablas, _cb) {
    return () => {};
  }

  // ── auth ────────────────────────────────────────────────────────────────────

  const auth = {
    usuario() {
      return Promise.resolve(window.Clerk?.user ?? null);
    },

    // Eventos con los mismos nombres que usaba Supabase: SIGNED_IN / SIGNED_OUT / USER_UPDATED
    alCambiar(cb) {
      if (!window.Clerk?.addListener) return () => {};
      let previo = window.Clerk.user?.id ?? null;
      const unsub = window.Clerk.addListener(({ user }) => {
        const actual = user?.id ?? null;
        if (actual === previo) return;
        const evento = !actual ? 'SIGNED_OUT' : !previo ? 'SIGNED_IN' : 'USER_UPDATED';
        previo = actual;
        cb(evento, user ?? null);
      });
      return typeof unsub === 'function' ? unsub : () => {};
    },

    async ingresar(_email, _password) {
      // Clerk maneja el inicio de sesión via componentes UI; no se usa aquí.
      throw new Error('Use el componente de Clerk para iniciar sesión.');
    },

    async registrar(_email, _password, _nombre) {
      throw new Error('Use el componente de Clerk para registrarse.');
    },

    async recuperar(_email) {
      throw new Error('Use el componente de Clerk para recuperar contraseña.');
    },

    // Cambio de la propia contraseña (p. ej. la temporal que asignó el administrador): lo hace Clerk en el navegador;
    // luego el perfil deja de pedir el cambio
    async cambiarClave(clave, claveActual) {
      const user = window.Clerk?.user;
      if (!user) throw new Error('No hay sesión activa.');
      try {
        await user.updatePassword({ newPassword: clave, currentPassword: claveActual || undefined, signOutOfOtherSessions: true });
      } catch (e) {
        throw new Error(e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || String(e));
      }
      return update('profiles', user.id, { debe_cambiar_clave: false });
    },

    async salir() {
      await window.Clerk?.signOut?.();
    },
  };

  // ── usuariosDemo ─────────────────────────────────────────────────────────────

  function usuariosDemo() {
    return [];
  }

  // ── reiniciar ────────────────────────────────────────────────────────────────

  function reiniciar() {
    _areaId = null;
  }

  return {
    tipo: 'api',
    list, insert, upsert, update, updateWhere,
    remove, removeWhere, rpc,
    adminUsuarios, fijarArea, subscribe, auth,
    usuariosDemo, reiniciar,
  };
}
