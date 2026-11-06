// Datos ficticios del modo demostración (personas y proyectos inventados).
import { LISTAS_INICIALES, PARAMETROS_INICIALES, PERMISOS_INICIALES } from './catalogos.js';
import { uuid, lunes, sumarSemanas, sumarDias, hoy } from '../core/util.js';

function aleatorio(semilla) {
  let s = semilla;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function crearDatosDemo() {
  const r = aleatorio(20261024);
  const elegir = arr => arr[Math.floor(r() * arr.length)];
  const ahora = new Date().toISOString();
  const db = { _semana: lunes() };
  const area = uuid();
  db.areas = [{ id: area, nombre: 'Gerencia Técnica (demo)', descripcion: 'Datos ficticios', activa: true, created_at: ahora, updated_at: ahora }];

  // Listas
  db.listas = [];
  db.lista_valores = [];
  const valores = {};
  for (const [clave, nombre, vals] of LISTAS_INICIALES) {
    const lid = uuid();
    db.listas.push({ id: lid, area_id: area, clave, nombre, sistema: true, created_at: ahora, updated_at: ahora });
    valores[clave] = [];
    vals.forEach(([codigo, valor, color, protegido, extra], i) => {
      const v = { id: uuid(), lista_id: lid, codigo, valor, orden: (i + 1) * 10, color: color || null, activo: true,
        protegido: !!protegido, extra: extra || {}, created_at: ahora, updated_at: ahora };
      db.lista_valores.push(v);
      valores[clave].push(v);
    });
  }
  // Demostración: cada servicio con un CET ficticio, para que se vea el par CET ↔ Servicio
  valores.servicios.forEach((v, i) => { if (!v.codigo) v.codigo = `CET-${String(101 + i)}`; });
  const vid = (clave, codigoOValor) => valores[clave].find(v => v.codigo === codigoOValor || v.valor === codigoOValor)?.id;

  db.parametros = Object.entries(PARAMETROS_INICIALES).map(([clave, valor]) => ({ id: uuid(), area_id: area, clave, valor, updated_at: ahora }));
  db.permisos = [];
  for (const [rol, acciones] of Object.entries(PERMISOS_INICIALES)) {
    for (const [accion, permitido] of Object.entries(acciones)) db.permisos.push({ id: uuid(), area_id: area, rol, accion, permitido });
  }

  // Personas ficticias
  const persona = (nombre, codigo, rol, extra = {}) => ({
    id: uuid(), area_id: area, email: codigo.toLowerCase() + '@demo.lpsgt', nombre, codigo, rol, es_admin_principal: false,
    gerencia_ids: [], horas_dia: null, activo: true, tour_visto: true, created_at: ahora, updated_at: ahora, ...extra });
  const admin = persona('Gerente Técnico (demo)', 'GT', 'superadmin', { es_admin_principal: true, es_plataforma: true });
  const delegado = persona('Diana Rojas', 'DR', 'delegado');
  const lideres = [
    persona('Ana Torres', 'AT', 'lider'), persona('Bruno Salas', 'BS', 'lider'), persona('Carla Medina', 'CM', 'lider'),
    persona('Diego Paredes', 'DP', 'lider'), persona('Elena Quiroga', 'EQ', 'lider', { horas_dia: 6 }),
  ];
  const consulta = persona('Fernando Ruiz (GOC)', 'FR', 'consulta', { gerencia_ids: [vid('gerencias', 'GOC')] });
  const pendiente = persona('Gabriela Núñez', 'GN', 'pendiente');
  db.profiles = [admin, delegado, ...lideres, consulta, pendiente];
  db.delegado_historial = [{ id: uuid(), area_id: area, usuario_id: delegado.id, otorgado_por: admin.id, desde: ahora, hasta: null }];

  // Proyectos ficticios
  const proy = (codigo, nombre, ger, fase, estado = 'activo', extra = {}) => ({
    id: uuid(), area_id: area, codigo, cet_id: null, nombre_corto: nombre, nombre_completo: `Proyecto de demostración ${nombre}`,
    tipo_id: vid('tipos_proyecto', 'Proyecto'), gerencia_id: vid('gerencias', ger), fase_id: vid('fases', fase), estado,
    pais_id: vid('paises', 'Perú'), fecha_inicio: null, fecha_fin: null, observaciones: null, propuesto_por: null,
    aprobado_por: null, aprobado_at: null, motivo_rechazo: null, extra: {}, created_by: admin.id, created_at: ahora, updated_at: ahora, ...extra });
  const proyectos = [
    proy('D-101', 'Hospital Demo Norte', 'GOC', 'Construcción'),
    proy('D-102', 'Planta Concentradora Demo', 'GOI', 'Diseño'),
    proy('D-103', 'Puente Demo Río Azul', 'GOF', 'Preconstrucción'),
    proy('D-104', 'Edificio Corporativo Demo', 'GOC', 'Construcción'),
    proy('D-105', 'Licitación Demo Aeropuerto', 'PyL', 'Diseño'),
    { ...proy('INT-01', 'Gestión del área', 'GI', 'Permanente'), tipo_id: vid('tipos_proyecto', 'Gestión del área') },
    { ...proy('INT-02', 'Biblioteca de estándares BIM', 'GIPT', 'Permanente'), tipo_id: vid('tipos_proyecto', 'Proceso interno') },
    proy('D-106', 'Ampliación Demo Puerto', 'GOF', 'Diseño', 'propuesto', { propuesto_por: lideres[2].id }),
  ];
  db.proyectos = proyectos;
  db.proyecto_lideres = [];
  proyectos.forEach((p, i) => {
    db.proyecto_lideres.push({ proyecto_id: p.id, usuario_id: lideres[i % 5].id });
    if (i % 2 === 0) db.proyecto_lideres.push({ proyecto_id: p.id, usuario_id: lideres[(i + 2) % 5].id });
  });
  db.proyecto_favoritos = [];
  db.hitos = [
    { id: uuid(), area_id: area, proyecto_id: proyectos[0].id, nombre: 'Entrega de modelo BIM coordinado', fecha: sumarSemanas(lunes(), 3), estado: 'pendiente', created_at: ahora, updated_at: ahora },
    { id: uuid(), area_id: area, proyecto_id: proyectos[1].id, nombre: 'Revisión de ingeniería básica', fecha: sumarSemanas(lunes(), 1), estado: 'pendiente', created_at: ahora, updated_at: ahora },
  ];

  // Actividades: 8 semanas cerradas + semana actual + Look Ahead de 3 semanas
  const servicios = valores.servicios.map(v => v.id);
  const cncs = valores.cnc.filter(v => !v.codigo).map(v => v.id);
  const tareas = ['Revisión de planos de especialidades', 'Coordinación de modelo BIM', 'Respuesta a RFI pendientes',
    'Actualización de metrados', 'Reunión de coordinación con obra', 'Informe semanal de avance', 'Revisión de entregables',
    'Capacitación al equipo de obra', 'Actualización de procedimiento', 'Elaboración de presupuesto', 'Control de documentos técnicos',
    'Visita a obra', 'Auditoría de modelo', 'Preparación de propuesta técnica'];
  db.actividades = [];
  db.cierres = [];
  const semanaActual = lunes();
  const crearAct = (lider, semana, extra = {}) => {
    const p = elegir(proyectos.slice(0, 7));
    const hh = {};
    for (const d of ['hh_lu', 'hh_ma', 'hh_mi', 'hh_ju', 'hh_vi']) hh[d] = r() < 0.55 ? elegir([1, 2, 2, 3, 4]) : 0;
    const a = {
      id: uuid(), area_id: area, semana, responsable_id: lider.id, resp2: r() < 0.3 ? elegir(['Apoyo externo', 'Practicante', 'Asistente BIM']) : null,
      proyecto_id: p.id, gerencia_id: p.gerencia_id, cet_id: p.cet_id, servicio_id: elegir(servicios), descripcion: elegir(tareas),
      hh_lu: 0, hh_ma: 0, hh_mi: 0, hh_ju: 0, hh_vi: 0, hh_sa: 0, hh_do: 0, ...hh, hh_real: null, tipo: 'programada', comprometida: true,
      estado_la: 'trasladada', estado: 'programado', cnc_id: null, comentario: null, origen: 'manual', origen_id: null, cartera_id: null,
      semana_original: null, orden: 0, extra: {}, created_by: lider.id, created_at: ahora, updated_at: ahora, ...extra };
    a.hh_total = ['hh_lu', 'hh_ma', 'hh_mi', 'hh_ju', 'hh_vi', 'hh_sa', 'hh_do'].reduce((s, k) => s + a[k], 0);
    db.actividades.push(a);
    return a;
  };
  for (let w = -8; w <= 3; w++) {
    const semana = sumarSemanas(semanaActual, w);
    lideres.forEach((lider, li) => {
      const n = 4 + Math.floor(r() * 4);
      const confiabilidad = [0.88, 0.74, 0.81, 0.62, 0.9][li] + w * 0.01;
      for (let k = 0; k < n; k++) {
        const a = crearAct(lider, semana, w > 0 ? { comprometida: false, estado_la: elegir(['pendiente', 'lista', 'lista']) } : {});
        if (w < 0) {
          const ok = r() < confiabilidad;
          a.estado = r() < 0.04 ? 'cancelado' : ok ? 'completado' : 'no_completado';
          if (a.estado === 'no_completado') a.cnc_id = elegir(cncs);
          a.hh_real = Math.max(0, Math.round((a.hh_total * (0.8 + r() * 0.5)) * 2) / 2);
        } else if (w === 0 && r() < 0.35) {
          a.estado = 'completado';
        }
      }
      if (w < 0) {
        if (r() < 0.25) crearAct(lider, semana, { tipo: 'no_programada', estado: 'completado', hh_real: 2 });
        db.cierres.push({ id: uuid(), area_id: area, responsable_id: lider.id, semana, cerrada: true, cerrado_at: ahora,
          cerrado_por: lider.id, automatico: false, reabierto_at: null, reabierto_por: null });
      }
    });
  }
  // Un arrastre visible
  const arrastre = db.actividades.find(a => a.semana === sumarSemanas(semanaActual, -1) && a.estado === 'no_completado');
  if (arrastre) crearAct(lideres.find(l => l.id === arrastre.responsable_id), semanaActual, {
    descripcion: arrastre.descripcion, proyecto_id: arrastre.proyecto_id, gerencia_id: arrastre.gerencia_id, origen: 'arrastre',
    origen_id: arrastre.id, semana_original: sumarSemanas(semanaActual, -2) });

  // Histórico migrado (semanas anteriores a las del aplicativo)
  db.pac_historico = [];
  for (let w = -16; w <= -9; w++) {
    lideres.forEach(l => {
      const total = 6 + Math.floor(r() * 4);
      const comp = Math.round(total * (0.6 + r() * 0.3));
      db.pac_historico.push({ id: uuid(), area_id: area, semana: sumarSemanas(semanaActual, w), responsable_id: l.id,
        responsable_codigo: l.codigo, completadas: comp, no_completadas: total - comp, canceladas: 0, hh_plan: total * 4,
        hh_completadas: comp * 4, fuente: 'Excel histórico (demo)', created_at: ahora });
    });
  }

  // Restricciones
  const futuras = db.actividades.filter(a => a.semana > semanaActual);
  db.restricciones = [];
  const tiposR = valores.tipos_restriccion.map(v => v.id);
  for (let i = 0; i < 9; i++) {
    const a = futuras[i * 5 % futuras.length];
    const estado = i < 4 ? 'pendiente' : i < 6 ? 'en_gestion' : 'levantada';
    db.restricciones.push({ id: uuid(), area_id: area, actividad_id: a.id, proyecto_id: a.proyecto_id,
      descripcion: elegir(['Falta información del cliente', 'Pendiente aprobación de planos', 'Sin acceso a la plataforma del cliente',
        'Esperando respuesta de otra área', 'Falta licencia de software']),
      tipo_id: elegir(tiposR), responsable: elegir(['Cliente', 'Oficina técnica de obra', 'TI', 'Gerencia de proyecto']),
      responsable_id: null, f_identificada: sumarDias(hoy(), -7 - i), f_requerida: sumarDias(hoy(), i - 3), f_prometida: sumarDias(hoy(), i - 1),
      f_levantada: estado === 'levantada' ? sumarDias(hoy(), -1) : null, estado, comentarios: null, extra: {},
      created_by: a.responsable_id, created_at: ahora, updated_at: ahora });
    if (estado !== 'levantada') a.estado_la = 'con_restriccion';
  }

  // Cartera y solicitudes
  db.cartera = [];
  const crit = valores.criticidad.map(v => v.id);
  lideres.forEach((l, i) => {
    for (let k = 0; k < 3; k++) {
      const p = elegir(proyectos.slice(0, 7));
      db.cartera.push({ id: uuid(), area_id: area, f_solicitud: sumarDias(hoy(), -30 + k * 7 + i), solicitante_id: null,
        solicitante: elegir(['Gerente de proyecto', 'Jefe de oficina técnica', 'Gerencia de ingeniería']), gerencia_id: p.gerencia_id,
        proyecto_id: p.id, servicio_id: elegir(servicios), descripcion: elegir(tareas) + ' — ' + p.nombre_corto, responsable_id: l.id,
        resp2: null, f_requerida: sumarDias(hoy(), 7 + k * 5), f_comprometida: sumarDias(hoy(), 10 + k * 5),
        tipo_id: elegir(valores.tipos_cartera.map(v => v.id)), criticidad_id: elegir(crit), estado: elegir(['abierta', 'en_proceso', 'cerrada']),
        origen: 'interna', motivo_rechazo: null, extra: {}, created_by: l.id, created_at: ahora, updated_at: ahora });
    }
  });
  db.cartera.push({ id: uuid(), area_id: area, f_solicitud: hoy(), solicitante_id: consulta.id, solicitante: consulta.nombre,
    gerencia_id: vid('gerencias', 'GOC'), proyecto_id: proyectos[3].id, servicio_id: vid('servicios', 'Metrados'),
    descripcion: 'Metrados de estructuras del sótano para valorización', responsable_id: lideres[1].id, resp2: null,
    f_requerida: sumarDias(hoy(), 10), f_comprometida: null, tipo_id: null, criticidad_id: crit[0], estado: 'nueva',
    origen: 'solicitud', motivo_rechazo: null, extra: {}, created_by: consulta.id, created_at: ahora, updated_at: ahora });

  // Plantillas recurrentes y de servicio
  db.plantillas = [];
  db.plantilla_items = [];
  lideres.forEach(l => {
    const pl = { id: uuid(), area_id: area, tipo: 'recurrente', nombre: 'Actividades recurrentes', propietario_id: l.id, servicio_id: null, activa: true, created_at: ahora, updated_at: ahora };
    db.plantillas.push(pl);
    db.plantilla_items.push(
      { id: uuid(), plantilla_id: pl.id, proyecto_id: proyectos[5].id, gerencia_id: proyectos[5].gerencia_id, cet_id: proyectos[5].cet_id,
        servicio_id: vid('servicios', 'Planificación, monitoreo y control del área'), descripcion: 'Planificación y revisión de actividades de la semana',
        resp2: null, hh_lu: 1, hh_ma: 0, hh_mi: 0, hh_ju: 0, hh_vi: 1, hh_sa: 0, hh_do: 0, semana_offset: 0, orden: 1 },
      { id: uuid(), plantilla_id: pl.id, proyecto_id: proyectos[5].id, gerencia_id: proyectos[5].gerencia_id, cet_id: proyectos[5].cet_id,
        servicio_id: vid('servicios', 'Planificación, monitoreo y control del área'), descripcion: 'Registro de HH en el sistema corporativo',
        resp2: null, hh_lu: 0, hh_ma: 0, hh_mi: 0, hh_ju: 0, hh_vi: 0.5, hh_sa: 0, hh_do: 0, semana_offset: 0, orden: 2 });
  });
  const ps = { id: uuid(), area_id: area, tipo: 'servicio', nombre: 'Implementación BIM en proyecto', propietario_id: null,
    servicio_id: vid('servicios', 'Seguimiento implementación BIM'), activa: true, created_at: ahora, updated_at: ahora };
  db.plantillas.push(ps);
  [['Reunión de arranque BIM con el proyecto', 0, 2], ['Plan de ejecución BIM', 0, 6], ['Configuración de plataforma colaborativa', 1, 4],
    ['Capacitación al equipo del proyecto', 1, 4], ['Primera auditoría de modelos', 2, 6]].forEach(([d, off, h], i) =>
    db.plantilla_items.push({ id: uuid(), plantilla_id: ps.id, proyecto_id: null, gerencia_id: null, cet_id: null, servicio_id: ps.servicio_id,
      descripcion: d, resp2: null, hh_lu: h / 2, hh_ma: 0, hh_mi: h / 2, hh_ju: 0, hh_vi: 0, hh_sa: 0, hh_do: 0, semana_offset: off, orden: i }));

  // Ubicaciones de la semana actual
  db.ubicaciones_dia = [];
  const ubic = valores.ubicaciones;
  [...lideres, delegado].forEach((p, i) => {
    for (let d = 0; d < 5; d++) {
      const u = i === 4 && d >= 3 ? ubic[3] : (d + i) % 4 === 0 ? ubic[1] : ubic[0];
      db.ubicaciones_dia.push({ id: uuid(), area_id: area, usuario_id: p.id, fecha: sumarDias(semanaActual, d), ubicacion_id: u.id, nota: null });
    }
  });

  db.reuniones = [];
  db.acuerdos = [
    { id: uuid(), area_id: area, reunion_id: null, cnc_id: cncs[2], accion: 'Solicitar al cliente la información con 2 semanas de anticipación',
      responsable_id: lideres[3].id, fecha: sumarDias(hoy(), 5), estado: 'en_proceso', created_by: admin.id, created_at: ahora, updated_at: ahora },
  ];
  db.comentarios = [];
  db.enlaces = [];
  db.notificaciones = [
    { id: uuid(), usuario_id: admin.id, tipo: 'proyecto_propuesto', texto: 'Proyecto propuesto por aprobar: D-106 Ampliación Demo Puerto',
      ruta: `#/proyectos/${proyectos[7].id}`, leida: false, created_at: ahora },
    { id: uuid(), usuario_id: admin.id, tipo: 'usuario_nuevo', texto: 'Nuevo usuario por aprobar: gn@demo.lpsgt', ruta: '#/config/usuarios', leida: false, created_at: ahora },
  ];
  db.columnas_personalizadas = [];
  db.vistas = [];
  db.solicitudes_cambio = [
    { id: uuid(), area_id: area, autor_id: lideres[0].id, titulo: 'Poder duplicar una semana completa', descripcion: 'Copiar todas mis actividades de una semana a otra.',
      pantalla: 'Plan semanal', prioridad: 'media', estado: 'en_analisis', respuesta: null, created_at: ahora, updated_at: ahora },
  ];
  db.auditoria = [];
  return db;
}
