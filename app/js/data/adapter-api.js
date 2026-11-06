/**
 * Adaptador de datos para Vercel API + Clerk Auth.
 * Reemplaza adapter-supabase.js; misma interfaz pública.
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

    alCambiar(cb) {
      if (!window.Clerk) return () => {};
      const unsub = window.Clerk.addListener(({ user }) => cb('AUTH_CHANGE', user ?? null));
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

    async cambiarClave(clave) {
      const user = window.Clerk?.user;
      if (!user) throw new Error('No hay sesión activa.');
      return post('/admin-usuarios', {
        accion: 'clave',
        usuario_id: user.id,
        clave,
      });
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
    list, insert, upsert, update, updateWhere,
    remove, removeWhere, rpc,
    adminUsuarios, fijarArea, subscribe, auth,
    usuariosDemo, reiniciar,
  };
}
