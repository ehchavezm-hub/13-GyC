// Envío del Programa de Arranque por correo (q37, opción 2): sale "en nombre de" quien lo envía.
//   De:         "<Nombre> (GyC)" <CORREO_REMITENTE>   (dominio verificado en el servicio de correo)
//   Responder a: el correo de quien lo envía          (las respuestas le llegan a esa persona)
// Cuerpo en HTML armado aquí a partir de datos (no se acepta HTML del navegador), Curva S como imagen
// incrustada y el PDF completo adjunto. Servicio: Resend (https://resend.com). Solo administradores del proyecto.
// Variables de entorno en Vercel: RESEND_API_KEY (secreta) y CORREO_REMITENTE (p. ej. notificaciones@midominio.com).
import { query } from './_lib/db.js';
import { verificarAuth, AuthError, leerCuerpo, habilitado } from './_lib/auth.js';

const EMAIL_RE = /^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/;
const MAX_DESTINATARIOS = 25;
const MAX_ADJUNTO = 3_500_000;   // caracteres en base64 (~2,6 MB): el cuerpo de una Vercel Function admite 4,5 MB

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const b64 = s => typeof s === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(s);

// Solo pruebas: reemplaza el envío real
let _enviar = null;
export function usarEnvio(fn) { _enviar = fn; }

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  let yo;
  try { yo = await verificarAuth(req); } catch (e) { return res.status(e instanceof AuthError ? e.status : 401).json({ error: e.message }); }
  let d;
  try { d = await leerCuerpo(req); } catch { return res.status(400).json({ error: 'JSON inválido' }); }
  try {
    res.status(200).json(await enviar(yo, d));
  } catch (e) {
    res.status(e instanceof AuthError ? e.status : 400).json({ error: e.message });
  }
}

async function enviar(yo, d) {
  if (!habilitado(yo)) throw new AuthError('No autorizado.', 403);
  const [p] = await query(`SELECT id, codigo, nombre_corto, area_id FROM proyectos WHERE id = $1`, [String(d.proyecto_id || '')]);
  if (!p) throw new Error('Proyecto no encontrado.');
  const [ok] = await query(`SELECT administra_proyecto($1, $2) AS ok`, [yo.id, p.id]);
  if (!ok?.ok) throw new AuthError('Solo los administradores del proyecto envían el programa de arranque por correo.', 403);

  // Destinatarios: SOLO miembros del proyecto (o de su proyecto, si es un Grupo LPS). Llegan sus ids y los correos
  // se leen de la base: no se acepta ningún correo escrito desde el navegador.
  const ids = [...new Set((Array.isArray(d.para) ? d.para : []).map(String).filter(Boolean))];
  if (!ids.length) throw new Error('Elija al menos un miembro del proyecto.');
  if (ids.length > MAX_DESTINATARIOS) throw new Error(`Máximo ${MAX_DESTINATARIOS} destinatarios por envío.`);
  const miembros = await query(
    `SELECT DISTINCT u.id, lower(u.email) AS email FROM proyecto_lideres l JOIN profiles u ON u.id = l.usuario_id
      WHERE l.proyecto_id IN (SELECT id FROM proyectos WHERE id = $1 UNION SELECT padre_id FROM proyectos WHERE id = $1 AND padre_id IS NOT NULL)
        AND u.id = ANY($2::text[]) AND u.activo AND NOT u.eliminado AND u.email IS NOT NULL`, [p.id, ids]);
  const fuera = ids.filter(id => !miembros.some(m => m.id === id));
  if (fuera.length) throw new AuthError('Solo se puede enviar a miembros activos del proyecto con correo registrado.', 403);
  const para = [...new Set(miembros.map(m => m.email).filter(e => EMAIL_RE.test(e)))];
  if (d.pdf && (!b64(d.pdf) || d.pdf.length > MAX_ADJUNTO)) throw new Error('El PDF adjunto no es válido o es demasiado grande.');
  if (d.curva && (!b64(d.curva) || d.curva.length > 1_500_000)) throw new Error('La imagen de la Curva S no es válida.');

  const proyecto = `${p.codigo} · ${p.nombre_corto}`;
  const r = d.resumen || {};
  const asunto = String(d.asunto || `Programa de Arranque · ${proyecto}`).replace(/[\r\n]+/g, ' ').slice(0, 200);
  const html = cuerpoCorreo({ yo, proyecto, r, mensaje: String(d.mensaje || '').slice(0, 4000), conCurva: !!d.curva, enlace: String(d.enlace || '') });

  const remitente = process.env.CORREO_REMITENTE;
  const clave = process.env.RESEND_API_KEY;
  if (!_enviar && (!clave || !remitente)) {
    throw new Error('Falta configurar el envío de correo: agregue RESEND_API_KEY y CORREO_REMITENTE en las variables de entorno de Vercel.');
  }
  const correo = {
    from: `${String(yo.nombre || 'GyC').replace(/["<>\r\n]/g, '')} (GyC) <${remitente || 'pruebas@gyc.local'}>`,
    to: para,
    reply_to: yo.email || undefined,
    cc: d.copia && yo.email ? [yo.email] : undefined,
    subject: asunto,
    html,
    attachments: [
      ...(d.pdf ? [{ filename: String(d.pdf_nombre || 'Programa de Arranque.pdf').replace(/[^\w .()-]/g, '_').slice(0, 120), content: d.pdf.replace(/\s/g, '') }] : []),
      ...(d.curva ? [{ filename: 'curva-s.png', content: d.curva.replace(/\s/g, ''), content_id: 'curva-s' }] : []),
    ],
  };
  const resultado = _enviar ? await _enviar(correo) : await enviarResend(clave, correo);

  await query(
    `INSERT INTO auditoria (area_id, tabla, registro_id, accion, usuario_id, cambios) VALUES ($1, 'correos', $2, 'enviar', $3, $4::jsonb)`,
    [p.area_id, p.id, yo.id, JSON.stringify({ asunto, para, copia: !!d.copia, documento: 'Programa de Arranque', id: resultado?.id || null })], yo.id,
  ).catch(e => console.error('[correo] auditoría:', e?.message ?? e));
  return { ok: true, enviados: para.length, id: resultado?.id || null };
}

async function enviarResend(clave, correo) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(correo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`El servicio de correo rechazó el envío: ${j.message || j.error || `HTTP ${r.status}`}`);
  return j;
}

// Correo en HTML con estilos en línea y colores de la paleta Tableau (los clientes de correo ignoran las hojas de estilo)
function cuerpoCorreo({ yo, proyecto, r, mensaje, conCurva, enlace }) {
  const kpi = (t, v, c) => `<td style="padding:10px 12px;border:1px solid #E0E0E0;border-top:3px solid ${c};border-radius:6px;background:#FFFFFF">
    <div style="font-size:11px;color:#555555;text-transform:uppercase;letter-spacing:.03em">${esc(t)}</div>
    <div style="font-size:18px;font-weight:700;color:${c}">${esc(v)}</div></td>`;
  const desv = num(r.desviacion);
  const lista = (titulo, filas, color) => (Array.isArray(filas) && filas.length ? `
    <h3 style="margin:18px 0 6px;font-size:14px;color:${color}">${esc(titulo)} (${filas.length})</h3>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12.5px">
      <tr style="background:#F8FAFC">${['It', 'Descripción de actividad', 'Resp.', 'Fin vigente', '% Ava. Acu.'].map(h =>
        `<th align="left" style="padding:6px 8px;border-bottom:2px solid #E0E0E0;color:#555555">${h}</th>`).join('')}</tr>
      ${filas.slice(0, 40).map(f => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #E0E0E0;font-weight:700">${esc(f.codigo)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #E0E0E0">${esc(f.descripcion)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #E0E0E0">${esc(f.responsable || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #E0E0E0">${esc(f.fin || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #E0E0E0">${esc(num(f.avance))}%</td></tr>`).join('')}
    </table>` : '');
  return `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:Segoe UI,Arial,sans-serif;color:#1A1A2E">
  <div style="max-width:760px;margin:0 auto;padding:20px">
    <div style="background:#1A1A2E;color:#FFFFFF;padding:14px 18px;border-radius:10px 10px 0 0">
      <span style="font-weight:800;font-size:18px">Gy<span style="color:#E8762B">C</span></span>
      <span style="opacity:.8;margin-left:10px">Programa de Arranque</span></div>
    <div style="background:#FFFFFF;padding:18px;border:1px solid #E0E0E0;border-top:0;border-radius:0 0 10px 10px">
      <h2 style="margin:0 0 4px;color:#003366;font-size:18px">${esc(proyecto)}</h2>
      <div style="color:#555555;font-size:13px;margin-bottom:12px">Avance al ${esc(r.fecha || '')} · enviado por ${esc(yo.nombre || '')}</div>
      ${mensaje ? `<p style="white-space:pre-wrap;font-size:14px;line-height:1.5;margin:0 0 14px">${esc(mensaje)}</p>` : ''}
      <table cellpadding="0" cellspacing="6" style="border-collapse:separate;width:100%"><tr>
        ${kpi('Avance', `${num(r.avance)}%`, '#E8762B')}${kpi('Programado', `${num(r.programado)}%`, '#4E79A7')}
        ${kpi('Real', `${num(r.real)}%`, '#E8762B')}${kpi('Desviación', `${desv > 0 ? '+' : ''}${desv} pts`, desv < 0 ? '#E74C3C' : '#59A14F')}
      </tr><tr>
        ${kpi('Terminados', `${num(r.terminados)}/${num(r.aplican)}`, '#59A14F')}${kpi('Atrasados', String(num(r.atrasados)), '#E74C3C')}
        ${kpi('Por vencer', String(num(r.por_vencer)), '#F28E2B')}${kpi('Índice', r.indice == null ? '—' : String(r.indice), '#003366')}
      </tr></table>
      ${conCurva ? '<h3 style="margin:18px 0 6px;font-size:14px;color:#003366">Curva S</h3><img src="cid:curva-s" alt="Curva S" style="width:100%;max-width:720px;border:1px solid #E0E0E0;border-radius:8px">' : ''}
      ${lista('Atrasados', r.lista_atrasados, '#E74C3C')}
      ${lista('Por vencer', r.lista_por_vencer, '#F28E2B')}
      <p style="margin:18px 0 0;font-size:13px;color:#555555">El programa completo va adjunto en PDF.${/^https:\/\//.test(enlace) ? ` También puede verlo en <a href="${esc(enlace)}" style="color:#1F77B4">GyC</a>.` : ''}
        Para responder, use «Responder»: el mensaje le llegará a ${esc(yo.nombre || 'quien lo envió')}.</p>
    </div></div></body></html>`;
}
