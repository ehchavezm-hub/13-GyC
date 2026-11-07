// Registro de asistencia a un acta de reunión por QR (w1). Página pública (app/asistencia.html): los asistentes
// —también externos, sin cuenta en GyC— se registran desde su teléfono con el enlace secreto del acta.
//   GET  /api/asistencia?t=<token>  → datos generales del acta (solo lo necesario para mostrarla)
//   POST /api/asistencia            → { t, dni, nombres, apellidos, cargo, empresa, firma }
// Solo funciona mientras el administrador tenga la asistencia ABIERTA y el acta no esté cerrada. Un DNI se registra
// una vez por acta (si lo envía de nuevo, se actualizan sus datos y su firma).
import { query } from './_lib/db.js';
import { leerCuerpo } from './_lib/auth.js';

const TOKEN_RE = /^[a-f0-9]{24,64}$/;
const DNI_RE = /^[A-Za-z0-9-]{4,20}$/;
const FIRMA_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const MAX_FIRMA = 200_000;
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function actaPorToken(t) {
  if (!TOKEN_RE.test(String(t || ''))) return null;
  const [a] = await query(
    `SELECT a.id, a.numero, a.tipo, a.asunto, a.fecha, a.hora, a.estado, a.asistencia_abierta,
            p.codigo AS proyecto_codigo, p.nombre_corto AS proyecto
       FROM actas a JOIN proyectos p ON p.id = a.proyecto_id WHERE a.token_asistencia = $1`, [String(t)]);
  return a || null;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const a = await actaPorToken(url.searchParams.get('t'));
      if (!a) return res.status(404).json({ error: 'El enlace de asistencia no es válido.' });
      return res.status(200).json({
        proyecto: `${a.proyecto_codigo} · ${a.proyecto}`, numero: a.numero, tipo: a.tipo, asunto: a.asunto,
        fecha: a.fecha, hora: a.hora, abierta: a.asistencia_abierta && a.estado !== 'cerrada',
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
    let d;
    try { d = await leerCuerpo(req); } catch { return res.status(400).json({ error: 'Datos inválidos.' }); }
    const a = await actaPorToken(d.t);
    if (!a) return res.status(404).json({ error: 'El enlace de asistencia no es válido.' });
    if (!a.asistencia_abierta || a.estado === 'cerrada') return res.status(409).json({ error: 'El registro de asistencia de esta reunión está cerrado.' });
    const r = {
      dni: texto(d.dni, 20).replace(/\s/g, ''), nombres: texto(d.nombres, 120), apellidos: texto(d.apellidos, 120),
      cargo: texto(d.cargo, 120) || null, empresa: texto(d.empresa, 120) || null, firma: typeof d.firma === 'string' ? d.firma : null,
    };
    if (!DNI_RE.test(r.dni)) return res.status(400).json({ error: 'Ingrese un DNI o documento válido (4 a 20 caracteres, sin espacios).' });
    if (!r.nombres || !r.apellidos) return res.status(400).json({ error: 'Ingrese sus nombres y apellidos.' });
    if (!r.firma || !FIRMA_RE.test(r.firma) || r.firma.length > MAX_FIRMA) return res.status(400).json({ error: 'Firme en el recuadro antes de registrar.' });
    const [fila] = await query(
      `INSERT INTO acta_asistentes (acta_id, dni, nombres, apellidos, cargo, empresa, firma)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (acta_id, dni) DO UPDATE SET nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos,
         cargo = EXCLUDED.cargo, empresa = EXCLUDED.empresa, firma = EXCLUDED.firma, registrado_en = now()
       RETURNING (xmax = 0) AS nuevo`,
      [a.id, r.dni, r.nombres, r.apellidos, r.cargo, r.empresa, r.firma]);
    return res.status(200).json({ ok: true, nuevo: !!fila?.nuevo });
  } catch (e) {
    console.error('[asistencia]', e?.message ?? e);
    return res.status(500).json({ error: 'No se pudo registrar la asistencia. Intente nuevamente.' });
  }
}
