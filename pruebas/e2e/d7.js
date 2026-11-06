// Pedido d7: Actividad → CET → Proyecto. La columna «Proyecto» del Look Ahead muestra el proyecto del CET y ofrece la
// lista de Proyectos; el Grupo LPS de la actividad no cambia. No se guarda nada nuevo en la base.
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
    const [P, Q] = s.store.proyectos.filter(x => !x.padre_id);
    const [G] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'GT-OT-001', nombre_corto: 'LPS Gestión', estado: 'activo', padre_id: P.id });
    const serv = s.valoresLista('servicios');
    // dos CET del proyecto P (como los CET1076 de GT_OT) y uno de Q
    await api.update('lista_valores', serv[0].id, { codigo: 'CET-P1', extra: { ...(serv[0].extra || {}), proyecto_id: P.id } });
    await api.update('lista_valores', serv[1].id, { codigo: 'CET-P2', extra: { ...(serv[1].extra || {}), proyecto_id: P.id } });
    await api.update('lista_valores', serv[2].id, { codigo: 'CET-Q1', extra: { ...(serv[2].extra || {}), proyecto_id: Q.id } });
    const lunes = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7); return d.toISOString().slice(0, 10); })();
    await api.insert('actividades', { area_id: s.store.area.id, proyecto_id: G.id, servicio_id: serv[0].id, descripcion: 'Informe BIM', semana: lunes, responsable_id: s.store.usuario.id });
    await s.cargarCatalogo(); s.seleccionarProyecto(G.id);
    return { G: G.id, P: P.codigo + ' · ' + P.nombre_corto, Q: Q.codigo + ' · ' + Q.nombre_corto, Pid: P.id, total: (await api.list('actividades', {})).length };
  });
  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(2200);
  const titulos = (await p.evaluate(() => [...document.querySelectorAll('[data-grilla] .tabulator-col')].filter(c => c.offsetParent !== null)
    .map(c => c.querySelector('.tabulator-col-title')?.innerText.trim() || ''))).filter(Boolean);   // solo las columnas visibles
  console.log('columnas:', titulos.slice(0, 9).join(' | '));
  chk(!titulos.includes('Grupo LPS') && titulos.includes('Proyecto') && !titulos.includes('Proyecto / Proceso'), 'd8: sin columna «Grupo LPS»; está «Proyecto»');
  console.log('  filas:', (await p.locator('.tabulator-row').allInnerTexts()).slice(0, 4).map(t => t.replace(/\s+/g, ' ').slice(0, 120)), await p.locator('.pagina-cab, .barra').first().innerText().catch(() => ''));
  const fila = p.locator('.tabulator-row', { hasText: 'Informe BIM' });
  const celda = f => fila.locator(`[tabulator-field="${f}"]`);
  chk((await celda('_proyecto').innerText()).includes(ini.P), `la actividad con CET del proyecto muestra «${ini.P}»`);
  // lista de la columna Proyecto = lista de Proyectos (incluye el proyecto con grupos, sin grupos)
  await celda('_proyecto').dblclick(); await p.waitForTimeout(400);
  const ops = (await p.locator('.tabulator-edit-list-item').allInnerTexts()).map(t => t.trim());
  chk(ops.some(o => o.includes(ini.P)) && !ops.some(o => o.includes('LPS Gestión')), `la lista ofrece los proyectos (${ops.length - 1}), incluido el que tiene grupos, y no los grupos`);
  // elegir otro proyecto: el CET (de otro proyecto) se limpia y se ofrecen solo los del elegido
  await p.locator('.tabulator-edit-list-item', { hasText: ini.Q }).first().click(); await p.waitForTimeout(800);
  chk((await celda('_cet').innerText()).includes('CET-P1'), 'r1: al cambiar de proyecto el CET se conserva (desvinculados)');
  chk((await celda('_proyecto').innerText()).includes(ini.Q), 'r1: y el Proyecto queda el elegido');
  await celda('_cet').dblclick(); await p.waitForTimeout(400);
  const cets = (await p.locator('.tabulator-edit-list-item').allInnerTexts()).map(t => t.trim()).filter(t => t && t !== '—');
  console.log('  CET ofrecidos:', cets.join(', '));
  chk(cets.some(c => c.startsWith('CET-P1')) && cets.some(c => c.startsWith('CET-Q1')), 'r1: el CET ofrece todos los CET');
  await p.locator('.tabulator-edit-list-item', { hasText: 'CET-P2' }).first().click(); await p.waitForTimeout(1200);
  chk((await celda('_proyecto').innerText()).includes(ini.Q), 'r1: elegir un CET de otro proyecto no cambia el Proyecto');
  const fin = await p.evaluate(async G => { const { api } = await import('./js/data/api.js'); const a = (await api.list('actividades', {})); const x = a.find(r => r.descripcion === 'Informe BIM');
    return { total: a.length, grupo: x.proyecto_id === G, extra: Object.keys(x).filter(k => k.startsWith('_')) }; }, ini.G);
  chk(fin.total === ini.total && fin.grupo, `sin pérdida ni cambio de grupo (actividades ${fin.total}/${ini.total})`);
  chk(!fin.extra.length, 'no se guarda ningún campo nuevo en la base');
  // Fila nueva: se guarda en el Grupo LPS elegido en el menú
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(400);
  const nueva = p.locator('.tabulator-row.fila-nueva').first();
  await nueva.locator('[tabulator-field="descripcion"]').dblclick(); await p.keyboard.type('Tarea nueva d8'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const g = await p.evaluate(async G => { const { api } = await import('./js/data/api.js'); const x = (await api.list('actividades', {})).find(r => r.descripcion === 'Tarea nueva d8'); return x ? x.proyecto_id === G : null; }, ini.G);
  chk(g === true, 'una actividad nueva queda en el Grupo LPS elegido en el menú');
  // Plantillas conserva su columna «Grupo LPS»
  await p.goto(B + '?demo#/plantillas'); await p.waitForTimeout(1500);
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
