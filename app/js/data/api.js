// Capa de datos única: API de Vercel (api/) con base Neon y sesión de Clerk.
import { crearAdaptadorApi } from './adapter-api.js';

const cfg = window.GYC_CONFIG || {};

export const api = crearAdaptadorApi(cfg.apiBase || '/api');

export function mensajeError(e) {
  const m = String(e?.message || e || 'Error desconocido');
  if (/row-level security|permission denied|violates row-level/i.test(m)) return 'No tiene permiso para realizar esta acción.';
  if (/duplicate key/i.test(m)) return 'Ya existe un registro con esos datos.';
  if (/violates foreign key/i.test(m)) return 'El registro está siendo usado en otra parte y no puede modificarse así.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor. Intente nuevamente.';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/only request this after (\d+) seconds/i.test(m)) return `Por seguridad, espere ${m.match(/after (\d+) seconds/i)[1]} segundos antes de volver a intentarlo.`;
  if (/email rate limit|over_email_send_rate_limit/i.test(m)) return 'Se alcanzó el límite de correos. Intente más tarde o pida al administrador que confirme su cuenta.';
  if (/User already registered|already been registered/i.test(m)) return 'Ese correo ya tiene una cuenta. Use "Ya tengo cuenta" para ingresar u "Olvidé mi contraseña".';
  if (/weak_password|known to be weak|easy to guess|pwned|leaked/i.test(m)) return 'Esa contraseña aparece en filtraciones públicas de otros sitios y no es segura. Elija otra distinta (larga y que no use en otros sitios).';
  if (/Email not confirmed/i.test(m)) return 'Debe confirmar su correo antes de ingresar (revise su bandeja de entrada).';
  return m;
}
