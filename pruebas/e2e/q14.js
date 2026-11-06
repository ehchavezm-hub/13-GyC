const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js'); const c = await import('./js/services/columnas.js');
    const area = s.store.area.id;
    const [P] = await api.insert('proyectos', { area_id: area, codigo: '001', nombre_corto: 'GT_OT', estado: 'activo' });
    const [G] = await api.insert('proyectos', { area_id: area, codigo: 'GT-OT-001', nombre_corto: 'Gestion', estado: 'activo', padre_id: P.id });
    const [C] = await api.insert('proyectos', { area_id: area, codigo: 'HT-OT-001', nombre_corto: 'ConstruIA', estado: 'activo', padre_id: P.id });
    const servs = s.valoresLista('servicios');
    // dos servicios pasan a GT_OT (como los 55 de la base real)
    for (const v of servs.slice(0, 2)) await api.update('lista_valores', v.id, { extra: { ...v.extra, proyecto_id: P.id } });
    await s.cargarCatalogo();
    const nombres = ids => ids.filter(Boolean).map(id => s.store.valores.get(id)?.valor);
    const opsG = s.opcionesServicio({ proyectoId: G.id }).map(o => o.value).filter(Boolean);
    const deP = s.valoresLista('servicios').filter(v => v.extra?.proyecto_id === P.id).map(v => v.id);
    // en una fila: elegir el Grupo LPS conserva un servicio de GT_OT; elegir un servicio de GT_OT sin proyecto no pone GT_OT
    const d1 = c.derivarProyectoServicio({ servicio_id: deP[0] }, { proyecto_id: G.id });
    const d2 = c.derivarProyectoServicio({ proyecto_id: null }, { servicio_id: deP[0] });
    const conf = s.opcionesProyectos({ contenedores: true }).some(o => /GT_OT/.test(o.label)), lps = s.opcionesProyectos().some(o => /· GT_OT/.test(o.label) && !/›/.test(o.label));
    return { serviciosDeGT_OT_enGestion: deP.every(id => opsG.includes(id)), opcionesGestion: opsG.length, totalServicios: servs.length,
      conservaServicio: !('servicio_id' in d1), noPoneContenedor: !('proyecto_id' in d2), gtOtEnConfig: conf, gtOtNoEnLPS: !lps };
  });
  console.log(r);
  await p.goto(B + '?demo#/config/listas'); await p.waitForTimeout(1200);
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
