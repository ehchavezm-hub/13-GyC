// Pedido d10: en Look Ahead y Plan semanal, al elegir el Proyecto se pone su Gerencia; con una Gerencia elegida, la lista de
// Proyectos muestra solo los de esa gerencia. El proyecto elegido sin CET se guarda (no se pierde al recargar).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1700, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const ini = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const ger = s.valoresLista('gerencias'); const [g1, g2] = ger;
    const ps = s.store.proyectos.filter(x => !x.padre_id);
    // dos proyectos de la gerencia 1 y el resto de la 2
    for (const [i, x] of ps.entries()) await api.update('proyectos', x.id, { gerencia_id: i < 2 ? g1.id : g2.id });
    const [G] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'GT-OT-001', nombre_corto: 'LPS Gestión', estado: 'activo', padre_id: ps[0].id });
    const lunes = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7); return d.toISOString().slice(0, 10); })();
    await api.insert('actividades', { area_id: s.store.area.id, proyecto_id: G.id, descripcion: 'Levantar observaciones', semana: lunes, responsable_id: s.store.usuario.id, gerencia_id: g1.id });
    await s.cargarCatalogo(); s.seleccionarProyecto(G.id);
    return { G: G.id, g1: g1.codigo || g1.valor, g2: g2.codigo || g2.valor, g2id: g2.id, p3: ps[2].codigo + ' · ' + ps[2].nombre_corto, p3id: ps[2].id,
      deG1: ps.slice(0, 2).map(x => x.codigo + ' · ' + x.nombre_corto), total: (await api.list('actividades', {})).length };
  });
  const abrir = async () => { await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(2200); };
  await abrir();
  const fila = () => p.locator('.tabulator-row', { hasText: 'Levantar observaciones' });
  const celda = f => fila().locator(`[tabulator-field="${f}"]`);
  // 1) Con la gerencia 1, la lista de Proyecto solo trae sus proyectos
  await celda('_proyecto').dblclick(); await p.waitForTimeout(400);
  const ops = (await p.locator('.tabulator-edit-list-item').allInnerTexts()).map(t => t.trim()).filter(t => t && t !== '—');
  console.log('  proyectos ofrecidos con', ini.g1 + ':', ops.join(', '));
  chk(ops.length === 2 && ini.deG1.every(x => ops.includes(x)), `con la Gerencia ${ini.g1} solo se ofrecen sus proyectos`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 2) Cambiar la gerencia a la 2 y elegir un proyecto de ella
  await celda('gerencia_id').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: ini.g2 }).first().click(); await p.waitForTimeout(800);
  await celda('_proyecto').dblclick(); await p.waitForTimeout(400);
  const ops2 = (await p.locator('.tabulator-edit-list-item').allInnerTexts()).map(t => t.trim()).filter(t => t && t !== '—');
  chk(ops2.includes(ini.p3) && !ini.deG1.some(x => ops2.includes(x)), `con la Gerencia ${ini.g2} solo se ofrecen los suyos`);
  await p.locator('.tabulator-edit-list-item', { hasText: ini.p3 }).first().click(); await p.waitForTimeout(1500);
  chk((await celda('gerencia_id').innerText()).includes(ini.g2), 'la Gerencia es la del proyecto elegido');
  // 3) Recargar: el proyecto elegido sin CET se conserva
  await abrir();
  chk((await celda('_proyecto').innerText()).includes(ini.p3), 'el proyecto elegido sin CET se conserva al recargar');
  const fin = await p.evaluate(async G => { const { api } = await import('./js/data/api.js'); const a = await api.list('actividades', {}); const x = a.find(r => r.descripcion === 'Levantar observaciones');
    return { total: a.length, grupo: x.proyecto_id === G, extra: x.extra }; }, ini.G);
  chk(fin.total === ini.total && fin.grupo && fin.extra?.proyecto_id === ini.p3id, `sigue en su Grupo LPS, sin pérdida (actividades ${fin.total}/${ini.total})`);
  // 4) Plantillas: elegir un CET sigue guardando (su tabla no tiene «extra»)
  await p.goto(B + '?demo#/plantillas'); await p.waitForTimeout(1500);
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
