// Operaciones sobre usuarios compartidas por /api/datos y /api/admin-usuarios.
import { query, transaccion } from './db.js';
import { AuthError, clerk, esAdmin, esSuper } from './auth.js';

/** Matriz de permisos de la empresa activa (public.puede). */
export async function puede(perfil, accion) {
  const [r] = await query(`SELECT puede($1, $2) AS ok`, [perfil.id, accion]);
  return !!r?.ok;
}

/** Elimina (o retira de la empresa) a un usuario. Lo usan /api/datos (rpc) y /api/admin-usuarios. */
export async function eliminarUsuario(yo, id, { plataforma = false } = {}) {
  if (!plataforma) {
    if (!esAdmin(yo) || !(await puede(yo, 'eliminar_usuarios'))) throw new AuthError('Solo el administrador puede eliminar usuarios.', 403);
  }
  const [obj] = await query(`SELECT id, rol, area_id, es_admin_principal, es_plataforma FROM profiles WHERE id = $1`, [id]);
  if (!obj) throw new Error('Usuario no encontrado.');
  if (obj.id === yo.id) throw new Error('No puede eliminarse a sí mismo.');
  if (obj.es_admin_principal) throw new Error('El administrador principal no se puede eliminar.');
  if (!plataforma) {
    const [m] = await query(`SELECT pertenece($1, $2) AS ok`, [id, yo.area_id]);
    if (!m?.ok) throw new Error('Usuario no encontrado.');
    if (['superadmin', 'admin'].includes(obj.rol) && !esSuper(yo)) throw new Error('Solo el super administrador elimina a un administrador.');
  }
  let resultado;
  if (plataforma) {
    // Desde la consola de la plataforma: se elimina de todas las empresas
    await transaccion(yo.id, [
      [`DELETE FROM empresa_miembros WHERE usuario_id = $1`, [id]],
      [`DELETE FROM proyecto_lideres WHERE usuario_id = $1`, [id]],
      [`UPDATE profiles SET eliminado = true, activo = false, email = NULL, es_plataforma = false,
               rol = CASE WHEN rol IN ('superadmin','admin','delegado') THEN 'lider' ELSE rol END WHERE id = $1`, [id]],
    ]);
    resultado = 'desactivado';
  } else {
    // Si es de la empresa activa de esa persona, eliminar_usuario la retira o la desactiva;
    // si solo es miembro de esta empresa (trabaja en otra), se quita la membresía
    if (obj.area_id === yo.area_id) {
      const [r] = await query(`SELECT eliminar_usuario($1) AS v`, [id], yo.id);
      resultado = r.v;
    } else {
      await transaccion(yo.id, [
        [`DELETE FROM proyecto_lideres WHERE usuario_id = $1 AND proyecto_id IN (SELECT id FROM proyectos WHERE area_id = $2)`, [id, yo.area_id]],
        [`DELETE FROM empresa_miembros WHERE usuario_id = $1 AND area_id = $2`, [id, yo.area_id]],
      ]);
      resultado = 'retirado';
    }
  }
  // Cuenta desactivada en todas partes: se borra también en Clerk para liberar el correo
  if (resultado === 'desactivado' && process.env.CLERK_SECRET_KEY) {
    try { await clerk().users.deleteUser(id); } catch (e) { console.error('[datos] deleteUser:', e?.message ?? e); }
  }
  return resultado;
}
