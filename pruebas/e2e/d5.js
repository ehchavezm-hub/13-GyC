// Pedido d5: los Grupos LPS salen del catálogo de Proyectos y tienen el suyo, sin mover ni perder sus datos.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // Un proyecto con un Grupo LPS que ya tiene actividades (como Gestión en GT_OT)
  const ini = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const P = s.store.proyectos.find(x => !x.padre_id);
    const [G] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'GT-OT-001', nombre_corto: 'Gestion', nombre_completo: 'Gestión de tareas del equipo', estado: 'activo', padre_id: P.id });
    const lunes = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
    for (let i = 1; i <= 5; i++) await api.insert('actividades', { area_id: s.store.area.id, proyecto_id: G.id, descripcion: 'Tarea del grupo ' + i, semana: lunes, responsable_id: s.store.usuario.id });
    const acts = await api.list('actividades', {});
    await s.cargarCatalogo();
    return { G: G.id, P: P.codigo + ' · ' + P.nombre_corto, total: acts.length, delGrupo: (await api.list('actividades', { eq: { proyecto_id: G.id } })).length };
  });
  console.log('inicio:', JSON.stringify(ini));
  const filas = async () => (await p.locator('[data-grilla] .tabulator-row').allInnerTexts()).map(t => t.replace(/\s+/g, ' '));
  await p.goto(B + '?demo#/config/listas?lista=__proyectos'); await p.waitForTimeout(1800);
  const fp = await filas();
  chk(!fp.some(t => t.includes('GT-OT-001')), 'Proyectos / Procesos ya no lista al Grupo LPS');
  chk(fp.length > 3, `Proyectos / Procesos sigue con sus proyectos (${fp.length} filas)`);
  await p.goto(B + '?demo#/config/listas?lista=__grupos'); await p.waitForTimeout(1800);
  chk((await p.locator('select[data-l]').inputValue()) === '__grupos', 'el selector de listas muestra «Grupos LPS»');
  const fg = await filas();
  console.log('  grupos:', fg);
  chk(fg.some(t => t.includes('GT-OT-001') && t.includes(ini.P)), 'Grupos LPS lo lista con el proyecto al que pertenece');
  const cab = await p.locator('[data-grilla="activo"] .tabulator-col-title').allInnerTexts();
  console.log('  columnas:', cab.filter(Boolean).join(' | '));
  chk(cab.includes('Pertenece al proyecto') && !cab.includes('Gerencia') && !cab.includes('Fase'), 'columnas propias de un grupo');
  // Nuevo grupo desde el botón
  await p.click('[data-a="nuevo"]'); await p.waitForTimeout(400);
  chk((await p.locator('.modal').last().innerText()).includes('Nuevo Grupo LPS'), 'el botón abre «Nuevo Grupo LPS»');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // Sus actividades siguen con él
  const fin = await p.evaluate(async G => { const { api } = await import('./js/data/api.js'); return { total: (await api.list('actividades', {})).length, delGrupo: (await api.list('actividades', { eq: { proyecto_id: G } })).length }; }, ini.G);
  chk(fin.total === ini.total && fin.delGrupo === ini.delGrupo, `sin pérdida de datos (actividades ${fin.total}/${ini.total}, del grupo ${fin.delGrupo}/${ini.delGrupo})`);
  // y se ven al elegir el grupo en el menú
  await p.evaluate(async G => (await import('./js/core/store.js')).seleccionarProyecto(G), ini.G);
  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(1800);
  const n = await p.evaluate(async G => { const s = await import('./js/core/store.js'); return s.store.proyectoSel === G; }, ini.G);
  chk(n, 'el Grupo LPS se sigue eligiendo en el menú');
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
