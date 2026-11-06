// Traer a Supabase los datos cargados en el modo demostración (guardados solo en este navegador).
// Se ejecuta desde Configuración → Respaldo. Conserva los identificadores originales, de modo que se puede
// repetir sin duplicar: lo ya traído se omite.
// planificar() es una función pura (se prueba en pruebas/traer-demo.test.mjs); ejecutar() hace las escrituras.

export const CLAVE_DEMO = 'lpsgt-demo-db';

// Columnas que acepta cada tabla (las calculadas, como hh_total, quedan fuera)
export const COLUMNAS = {
  listas: 'id,area_id,clave,nombre,descripcion,sistema,created_at,updated_at,grupo',
  lista_valores: 'id,lista_id,codigo,valor,descripcion,orden,color,activo,protegido,extra,created_at,updated_at',
  proyectos: 'id,area_id,codigo,cet_id,nombre_corto,nombre_completo,tipo_id,gerencia_id,fase_id,estado,pais_id,fecha_inicio,fecha_fin,observaciones,propuesto_por,aprobado_por,aprobado_at,motivo_rechazo,extra,created_by,created_at,updated_at',
  proyecto_lideres: 'proyecto_id,usuario_id',
  proyecto_favoritos: 'usuario_id,proyecto_id',
  hitos: 'id,area_id,proyecto_id,nombre,fecha,estado,created_at,updated_at',
  cartera: 'id,area_id,f_solicitud,solicitante_id,solicitante,gerencia_id,proyecto_id,servicio_id,descripcion,responsable_id,resp2,f_requerida,f_comprometida,tipo_id,criticidad_id,estado,origen,motivo_rechazo,extra,created_by,created_at,updated_at',
  plantillas: 'id,area_id,tipo,nombre,propietario_id,servicio_id,activa,created_at,updated_at',
  plantilla_items: 'id,plantilla_id,proyecto_id,gerencia_id,cet_id,servicio_id,descripcion,resp2,hh_lu,hh_ma,hh_mi,hh_ju,hh_vi,hh_sa,hh_do,semana_offset,orden',
  actividades: 'id,area_id,semana,responsable_id,resp2,proyecto_id,gerencia_id,cet_id,servicio_id,descripcion,hh_lu,hh_ma,hh_mi,hh_ju,hh_vi,hh_sa,hh_do,hh_real,tipo,comprometida,estado_la,estado,cnc_id,comentario,origen,origen_id,cartera_id,semana_original,orden,extra,created_by,created_at,updated_at',
  restricciones: 'id,area_id,actividad_id,proyecto_id,descripcion,tipo_id,responsable,responsable_id,f_identificada,f_requerida,f_prometida,f_levantada,estado,comentarios,extra,created_by,created_at,updated_at',
  cierres: 'id,area_id,responsable_id,semana,cerrada,cerrado_at,cerrado_por,automatico,reabierto_at,reabierto_por',
  pac_historico: 'id,area_id,semana,responsable_id,responsable_codigo,completadas,no_completadas,canceladas,hh_plan,hh_completadas,fuente,created_at',
  ubicaciones_dia: 'id,area_id,usuario_id,fecha,ubicacion_id,nota',
  reuniones: 'id,area_id,fecha,semana,asistentes,notas,created_by,created_at,updated_at',
  acuerdos: 'id,area_id,reunion_id,cnc_id,accion,responsable_id,fecha,estado,created_by,created_at,updated_at',
  comentarios: 'id,area_id,entidad,entidad_id,autor_id,texto,menciones,created_at',
  enlaces: 'id,area_id,entidad,entidad_id,titulo,url,autor_id,created_at',
  columnas_personalizadas: 'id,area_id,grilla,clave,nombre,tipo,lista_id,orden,activa,created_at,updated_at',
  organigrama_nodos: 'id,area_id,tipo,titulo,usuario_id,padre_id,x,y,orden,created_at,updated_at',
  solicitudes_cambio: 'id,area_id,autor_id,titulo,descripcion,pantalla,prioridad,estado,respuesta,created_at,updated_at',
};

// Orden de carga (cada tabla después de aquellas a las que apunta)
export const ORDEN = ['proyectos', 'proyecto_lideres', 'proyecto_favoritos', 'hitos', 'cartera', 'plantillas', 'plantilla_items',
  'actividades', 'restricciones', 'cierres', 'pac_historico', 'ubicaciones_dia', 'reuniones', 'acuerdos', 'comentarios', 'enlaces',
  'columnas_personalizadas', 'organigrama_nodos', 'solicitudes_cambio'];

export const NOMBRES = {
  proyectos: 'Proyectos', proyecto_lideres: 'Líderes de proyecto', proyecto_favoritos: 'Favoritos', hitos: 'Hitos', cartera: 'Cartera',
  plantillas: 'Plantillas', plantilla_items: 'Ítems de plantilla', actividades: 'Actividades (Plan y Look Ahead)',
  restricciones: 'Restricciones', cierres: 'Cierres de semana', pac_historico: 'PAC histórico', ubicaciones_dia: 'Ubicaciones (capacidad)',
  reuniones: 'Reuniones', acuerdos: 'Acuerdos', comentarios: 'Comentarios', enlaces: 'Enlaces', columnas_personalizadas: 'Columnas personalizadas',
  organigrama_nodos: 'Organigrama', solicitudes_cambio: 'Solicitudes de mejora', lista_valores: 'Valores de listas', listas: 'Listas',
  parametros: 'Parámetros', permisos: 'Permisos',
};

// Dueño del registro: si esa persona no se trae, el registro tampoco
const DUENO = { actividades: 'responsable_id', cierres: 'responsable_id', pac_historico: 'responsable_id', ubicaciones_dia: 'usuario_id',
  plantillas: 'propietario_id', proyecto_lideres: 'usuario_id', proyecto_favoritos: 'usuario_id' };
// Registro padre obligatorio: si el padre no se trae, el registro tampoco
const PADRE = { proyecto_lideres: ['proyecto_id', 'proyectos'], hitos: ['proyecto_id', 'proyectos'], plantilla_items: ['plantilla_id', 'plantillas'],
  acuerdos: ['reunion_id', 'reuniones'], proyecto_favoritos: ['proyecto_id', 'proyectos'] };
const ENTIDAD = { actividad: 'actividades', restriccion: 'restricciones', proyecto: 'proyectos', cartera: 'cartera' };

const elegir = (fila, cols) => Object.fromEntries(cols.split(',').filter(c => c in fila).map(c => [c, fila[c]]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
export const correoValido = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e || '') && !/@demo\.lpsgt$/i.test(e);

/** Lee los datos del modo demostración guardados en este navegador (o null). */
export function leerDemo(almacen = globalThis.localStorage) {
  try {
    const db = JSON.parse(almacen.getItem(CLAVE_DEMO) || 'null');
    return db && Array.isArray(db.profiles) ? db : null;
  } catch { return null; }
}

/** Datos de ejemplo que trae el modo demostración y que nadie modificó (misma fecha de creación que el área de demostración). */
export function esEjemplo(db, fila) {
  const semilla = db.areas?.[0]?.created_at;
  return !!semilla && fila.created_at === semilla && (!fila.updated_at || fila.updated_at === semilla);
}

/** Personas y proyectos que se ofrecen para elegir, con su selección inicial. */
export function opciones(db, reales) {
  const correos = new Map(reales.perfiles.map(p => [norm(p.email), p]));
  const principal = db.profiles.find(p => p.es_admin_principal) || null;
  const personas = db.profiles.filter(p => p !== principal && !p.eliminado).map(p => {
    const existente = correos.get(norm(p.email));
    return { id: p.id, nombre: p.nombre, email: p.email, rol: p.rol, existente: existente?.id || null,
      valido: !!existente || correoValido(p.email), marcado: !!existente || (correoValido(p.email) && !esEjemplo(db, p)) };
  });
  const proyectos = (db.proyectos || []).map(p => ({ id: p.id, codigo: p.codigo, nombre: p.nombre_corto, estado: p.estado, marcado: !esEjemplo(db, p) }));
  return { principal, personas, proyectos };
}

/**
 * Prepara todo lo que se va a escribir.
 * reales: { areaId, yo, listas, valores, perfiles, existentes: { tabla: Set(ids o claves) } }
 * eleccion: { personas: Set(ids demo a traer), proyectos: Set(ids demo), ejemplos: bool }
 * mapaPersonas: Map(id demo → id real) para las personas ya creadas o existentes.
 */
export function planificar(db, reales, eleccion, mapaPersonas) {
  const mapa = new Map(mapaPersonas);
  const principal = db.profiles.find(p => p.es_admin_principal);
  if (principal) mapa.set(principal.id, reales.yo);
  for (const a of db.areas || []) mapa.set(a.id, reales.areaId);
  const excluidas = new Set(db.profiles.map(p => p.id).filter(id => !mapa.has(id)));
  const ejemplo = f => !eleccion.ejemplos && esEjemplo(db, f);
  const plan = { listas: [], valores: [], valoresCambios: [], parametros: [], permisos: [], tablas: {}, omitidos: {} };

  // Listas y valores: se asocian por clave / código / nombre; lo que no existe se crea
  const listasReales = new Map(reales.listas.map(l => [l.clave, l]));
  for (const l of db.listas || []) {
    const real = listasReales.get(l.clave);
    if (real) { mapa.set(l.id, real.id); continue; }
    mapa.set(l.id, l.id);
    plan.listas.push({ ...elegir(l, COLUMNAS.listas), area_id: reales.areaId });
  }
  const valoresPorLista = new Map();
  for (const v of reales.valores) (valoresPorLista.get(v.lista_id) || valoresPorLista.set(v.lista_id, []).get(v.lista_id)).push(v);
  for (const v of db.lista_valores || []) {
    const listaReal = mapa.get(v.lista_id);
    if (!listaReal) continue;
    const candidatos = valoresPorLista.get(listaReal) || [];
    const real = (v.codigo && candidatos.find(x => x.codigo && norm(x.codigo) === norm(v.codigo))) || candidatos.find(x => norm(x.valor) === norm(v.valor));
    if (real) {
      mapa.set(v.id, real.id);
      if (!esEjemplo(db, v) && (real.valor !== v.valor || (real.color || null) !== (v.color || null) || real.activo !== v.activo)) {
        plan.valoresCambios.push({ id: real.id, cambios: { valor: v.valor, color: v.color || null, activo: v.activo !== false } });
      }
    } else {
      mapa.set(v.id, v.id);
      plan.valores.push({ ...elegir(v, COLUMNAS.lista_valores), lista_id: listaReal, protegido: false });
    }
  }
  // Parámetros y permisos: solo los que se cambiaron en el modo demostración
  const semilla = db.areas?.[0]?.created_at;
  const cambiado = f => f.updated_at && f.updated_at !== semilla;
  for (const p of db.parametros || []) if (cambiado(p)) plan.parametros.push({ area_id: reales.areaId, clave: p.clave, valor: p.valor });
  for (const p of db.permisos || []) if (cambiado(p)) plan.permisos.push({ area_id: reales.areaId, rol: p.rol, accion: p.accion, permitido: p.permitido });

  // Proyectos no elegidos: sus registros dependientes quedan sin proyecto (o se omiten si el proyecto es su padre)
  const proyectosFuera = new Set((db.proyectos || []).map(p => p.id).filter(id => !eleccion.proyectos.has(id)));
  const traidos = {};
  const traducir = v => {
    if (typeof v === 'string') return mapa.has(v) ? mapa.get(v) : v;
    if (Array.isArray(v)) return v.map(traducir).filter(x => !(typeof x === 'string' && excluidas.has(x)));
    return v;
  };
  const personasRef = ['responsable_id', 'solicitante_id', 'propietario_id', 'usuario_id', 'propuesto_por', 'aprobado_por', 'cerrado_por', 'reabierto_por', 'created_by', 'autor_id'];

  for (const t of ORDEN) {
    let filas = (db[t] || []).slice();
    if (t === 'organigrama_nodos') {   // los nodos padre primero
      const prof = new Map(); const porId = new Map(filas.map(n => [n.id, n]));
      const nivel = n => prof.get(n.id) ?? (prof.set(n.id, 0), prof.set(n.id, n.padre_id && porId.has(n.padre_id) ? nivel(porId.get(n.padre_id)) + 1 : 0), prof.get(n.id));
      filas.sort((a, b) => nivel(a) - nivel(b));
    }
    const ids = new Set();
    const salida = [];
    const omitir = motivo => { plan.omitidos[t] = plan.omitidos[t] || {}; plan.omitidos[t][motivo] = (plan.omitidos[t][motivo] || 0) + 1; };
    for (const f of filas) {
      if (t === 'proyectos' && proyectosFuera.has(f.id)) { omitir('proyecto no elegido'); continue; }
      if (t !== 'proyectos' && ejemplo(f)) { omitir('dato de ejemplo'); continue; }
      if (DUENO[t] && f[DUENO[t]] && excluidas.has(f[DUENO[t]])) { omitir('persona no elegida'); continue; }
      if (t === 'proyecto_favoritos' && f.usuario_id !== principal?.id) { omitir('favorito de otra persona'); continue; }
      if (PADRE[t]) {
        const [campo, tablaPadre] = PADRE[t];
        if (!traidos[tablaPadre]?.has(f[campo]) && !reales.existentes[tablaPadre]?.has(f[campo])) { omitir('registro relacionado no traído'); continue; }
      }
      if ((t === 'comentarios' || t === 'enlaces')) {
        const tp = ENTIDAD[f.entidad];
        if (!traidos[tp]?.has(f.entidad_id) && !reales.existentes[tp]?.has(f.entidad_id)) { omitir('registro relacionado no traído'); continue; }
      }
      const fila = elegir(f, COLUMNAS[t]);
      for (const [k, v] of Object.entries(fila)) {
        if (personasRef.includes(k) && typeof v === 'string' && excluidas.has(v)) fila[k] = null;
        else if (k === 'proyecto_id' && proyectosFuera.has(v)) fila[k] = null;
        else fila[k] = traducir(v);
      }
      if (COLUMNAS[t].split(',').includes('area_id')) fila.area_id = reales.areaId;
      if (t === 'actividades' && fila.cartera_id && !traidos.cartera?.has(f.cartera_id) && !reales.existentes.cartera?.has(f.cartera_id)) fila.cartera_id = null;
      if (t === 'restricciones' && fila.actividad_id && !traidos.actividades?.has(f.actividad_id) && !reales.existentes.actividades?.has(f.actividad_id)) fila.actividad_id = null;
      if (t === 'organigrama_nodos' && fila.padre_id && !ids.has(f.padre_id) && !reales.existentes.organigrama_nodos?.has(f.padre_id)) fila.padre_id = null;
      if (t === 'comentarios' && !fila.autor_id) fila.autor_id = reales.yo;
      if (t === 'solicitudes_cambio' && !fila.autor_id) fila.autor_id = reales.yo;
      const clave = f.id || `${fila.proyecto_id || fila.usuario_id}|${fila.usuario_id || fila.proyecto_id}`;
      ids.add(f.id || clave);
      const yaEsta = f.id ? reales.existentes[t]?.has(f.id) : reales.existentes[t]?.has(`${fila.proyecto_id}|${fila.usuario_id}`);
      if (yaEsta) { omitir('ya estaba en la base'); continue; }
      salida.push(fila);
    }
    traidos[t] = ids;
    plan.tablas[t] = salida;
  }
  plan.mapa = mapa;
  return plan;
}

/**
 * Ejecuta el plan con el adaptador de Supabase. crearCuenta(persona) → { id, clave } para las personas nuevas.
 * progreso(texto) informa el avance. Devuelve el informe.
 */
export async function ejecutar({ api, db, eleccion, reales, crearCuenta, actualizarPerfil, progreso = () => {} }) {
  const informe = { creados: {}, errores: [], credenciales: [], sinConfirmar: [] };
  const fallo = (donde, e) => { if (informe.errores.length < 40) informe.errores.push(`${donde}: ${e?.message || e}`); };

  // 1. Personas
  const mapaPersonas = new Map();
  const correos = new Map(reales.perfiles.map(p => [norm(p.email), p.id]));
  for (const p of db.profiles) {
    if (!eleccion.personas.has(p.id) || p.es_admin_principal) continue;
    const existente = correos.get(norm(p.email));
    if (existente) { mapaPersonas.set(p.id, existente); continue; }
    progreso(`Creando la cuenta de ${p.nombre}…`);
    try {
      const r = await crearCuenta(p);
      mapaPersonas.set(p.id, r.id);
      informe.credenciales.push({ nombre: p.nombre, email: p.email, clave: r.clave });
      if (!r.sesion) informe.sinConfirmar.push(p.email);
    } catch (e) { fallo(`Cuenta de ${p.nombre}`, e); }
  }
  // Datos de cada persona (rol, código, cargo…): después de crear las listas, para traducir cargo y gerencias
  const plan = planificar(db, reales, eleccion, mapaPersonas);

  progreso('Listas…');
  for (const [t, filas] of [['listas', plan.listas], ['lista_valores', plan.valores]]) {
    if (!filas.length) continue;
    try { await api.insert(t, filas); informe.creados[t] = filas.length; } catch (e) { fallo(NOMBRES[t], e); }
  }
  for (const c of plan.valoresCambios) { try { await api.update('lista_valores', c.id, c.cambios); } catch (e) { fallo('Valor de lista', e); } }
  if (plan.parametros.length) { try { await api.upsert('parametros', plan.parametros, 'area_id,clave'); informe.creados.parametros = plan.parametros.length; } catch (e) { fallo('Parámetros', e); } }
  if (plan.permisos.length) { try { await api.upsert('permisos', plan.permisos, 'area_id,rol,accion'); informe.creados.permisos = plan.permisos.length; } catch (e) { fallo('Permisos', e); } }

  const traducir = id => (id && plan.mapa.get(id)) || id;
  progreso('Datos de las personas…');
  for (const p of db.profiles) {
    const real = p.es_admin_principal ? null : mapaPersonas.get(p.id);
    if (!real) continue;
    try { await actualizarPerfil(real, p, traducir); } catch (e) { fallo(`Datos de ${p.nombre}`, e); }
  }

  for (const t of ORDEN) {
    const filas = plan.tablas[t];
    if (!filas?.length) continue;
    progreso(`${NOMBRES[t]}: ${filas.length}…`);
    let n = 0;
    for (let i = 0; i < filas.length; i += 200) {
      const lote = filas.slice(i, i + 200);
      try { await api.insert(t, lote); n += lote.length; continue; } catch { /* se reintenta fila por fila para ubicar el problema */ }
      for (const f of lote) {
        try { await api.insert(t, f); n++; } catch (e) {
          // Un cierre antiguo sin estados completos se trae como cierre automático (equivale al cierre por plazo vencido)
          if (t === 'cierres' && f.cerrada && !f.automatico) {
            try { await api.insert(t, { ...f, automatico: true }); n++; continue; } catch (e2) { fallo(NOMBRES[t], e2); continue; }
          }
          fallo(NOMBRES[t], e);
        }
      }
    }
    if (n) informe.creados[t] = n;
  }
  informe.omitidos = plan.omitidos;
  return informe;
}
