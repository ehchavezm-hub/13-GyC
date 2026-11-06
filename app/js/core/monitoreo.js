// Monitoreo de errores y lentitud con Sentry (opcional).
// Solo se activa si config.js trae "sentryDsn" (variable SENTRY_DSN del repositorio en GitHub);
// si no, no se descarga nada y medir() solo ejecuta la función.
// Privacidad: no se envían correos, nombres, IPs ni el contenido de los datos; el usuario se identifica por su id interno.

const cfg = window.GYC_CONFIG || {};
const UMBRAL_LENTO_MS = 3000;
const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
let sentry = null;
let iniciado = false;
const pendientes = [];

const limpiar = t => (typeof t === 'string' ? t.replace(CORREO, '[correo]') : t);

function depurar(evento) {
  delete evento.user?.email; delete evento.user?.ip_address; delete evento.user?.username;
  if (evento.request) { delete evento.request.cookies; delete evento.request.headers; }
  evento.message = limpiar(evento.message);
  for (const ex of evento.exception?.values || []) ex.value = limpiar(ex.value);
  for (const b of evento.breadcrumbs || []) {
    b.message = limpiar(b.message);
    if (b.data?.url) b.data.url = b.data.url.split('?')[0];   // los filtros de Supabase van en la URL
  }
  return evento;
}

function cargarScript(src) {
  return new Promise((ok, falla) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = ok; s.onerror = falla;
    document.head.appendChild(s);
  });
}

export async function iniciarMonitoreo() {
  if (!cfg.sentryDsn || iniciado) return;
  iniciado = true;
  // Errores ocurridos mientras se descarga el SDK
  const guardar = e => pendientes.push(e.reason || e.error || e.message);
  addEventListener('error', guardar); addEventListener('unhandledrejection', guardar);
  try {
    await cargarScript('vendor/sentry.min.js');
    sentry = window.Sentry;
    sentry.init({
      dsn: cfg.sentryDsn,
      environment: cfg.entorno || (location.hostname.includes('vercel.app') || !location.hostname.includes('localhost') && !location.hostname.includes('127.0') ? 'produccion' : 'desarrollo'),
      release: (window.GYC_VERSION || '').split(' ')[0] || undefined,
      sendDefaultPii: false,
      integrations: [sentry.browserTracingIntegration()],
      tracesSampleRate: Number(cfg.sentryMuestreo ?? 0.1),
      tracePropagationTargets: [],
      beforeSend: depurar,
      beforeSendTransaction: depurar,
    });
    pendientes.splice(0).forEach(e => e && sentry.captureException(e));
  } catch (e) {
    console.warn('Monitoreo no disponible', e);
  } finally {
    removeEventListener('error', guardar); removeEventListener('unhandledrejection', guardar);
  }
}

/** Identifica al usuario solo por id, rol y área (sin correo ni nombre). */
export function usuarioMonitoreo(u, areaId) {
  if (!sentry || !u) return;
  sentry.setUser({ id: u.id });
  sentry.setTag('rol', u.rol);
  if (areaId) sentry.setTag('area', areaId);
}

export function reportarError(e, contexto) {
  if (!sentry) return;
  sentry.withScope(s => { if (contexto) s.setTag('operacion', contexto); sentry.captureException(e); });
}

/**
 * Mide una operación (carga de pantallas, indicadores, importaciones, cierre de semana).
 * Con Sentry: la registra como transacción y avisa si supera UMBRAL_LENTO_MS o si falla.
 */
export async function medir(nombre, fn) {
  const inicio = performance.now();
  const ejecutar = async () => {
    try { return await fn(); } catch (e) { reportarError(e, nombre); throw e; }
  };
  const r = sentry ? await sentry.startSpan({ name: nombre, op: 'gyc.operacion' }, ejecutar) : await ejecutar();
  const ms = Math.round(performance.now() - inicio);
  if (sentry && ms > UMBRAL_LENTO_MS) {
    sentry.withScope(s => {
      s.setLevel('warning'); s.setTag('operacion', nombre); s.setExtra('duracion_ms', ms);
      sentry.captureMessage(`Operación lenta: ${nombre}`);
    });
  }
  return r;
}
