// Cada proyecto puede tener varios Grupos LPS y cada grupo sus propias actividades:
// con un grupo elegido se ven solo las suyas; arriba (GT · todos) se ven todas separadas por grupo; sin grupo no se registra.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1700, height: 1000 }, serviceWorkers: 'block' })).newPage();   // sin recarga automática por versión nueva
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const ini = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const P = s.store.proyectos.find(x => !x.padre_id);
    const [G1] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-GES', nombre_corto: 'LPS Gestión', estado: 'activo', padre_id: P.id });
    const [G2] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-CIA', nombre_corto: 'LPS ConstruIA', estado: 'activo', padre_id: P.id });
    const lunes = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7); return d.toISOString().slice(0, 10); })();
    const u = s.store.usuario.id, a = s.store.area.id;
    await api.insert('actividades', [
      { area_id: a, proyecto_id: G1.id, descripcion: 'Tarea de Gestión', semana: lunes, responsable_id: u, extra: {} },
      { area_id: a, proyecto_id: G2.id, descripcion: 'Tarea de ConstruIA', semana: lunes, responsable_id: u, extra: {} },
      { area_id: a, proyecto_id: null, descripcion: 'Tarea sin grupo', semana: lunes, responsable_id: u, extra: {} }]);
    await s.cargarCatalogo(); s.seleccionarProyecto(G1.id);
    return { G1: G1.id, total: (await api.list('actividades', {})).length };
  });
  const textos = async () => (await p.locator('[data-grilla] .tabulator-row').allInnerTexts()).join(' | ');
  const titulos = () => p.evaluate(() => [...document.querySelectorAll('[data-grilla] .tabulator-col')].filter(c => c.offsetParent !== null)
    .map(c => c.querySelector('.tabulator-col-title')?.innerText.trim() || ''));
  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(2200);
  // 1) Grupo elegido: solo sus actividades, sin columna Grupo LPS, con aviso de las que están sin grupo
  let t = await textos();
  chk(t.includes('Tarea de Gestión') && !t.includes('Tarea de ConstruIA') && !t.includes('Tarea sin grupo'), 'LPS Gestión: solo sus actividades');
  console.log('  columnas visibles:', (await titulos()).join(' | '));
  chk(!(await titulos()).includes('Grupo LPS'), 'LPS Gestión: sin columna «Grupo LPS»');
  const chip = await p.locator('[data-proy]').innerText(); console.log('  aviso:', chip.replace(/\s+/g, ' '));
  chk(/\d+ sin Grupo LPS/.test(chip), 'aviso «N sin Grupo LPS»');
  // + Fila en el grupo: se guarda en el grupo
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(400);
  await p.locator('.tabulator-row.fila-nueva [tabulator-field="descripcion"]').first().dblclick(); await p.keyboard.type('Nueva en Gestión'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const g = await p.evaluate(async () => (await (await import('./js/data/api.js')).api.list('actividades', {})).find(x => x.descripcion === 'Nueva en Gestión')?.proyecto_id);
  chk(g === ini.G1, 'una fila nueva se guarda en LPS Gestión');
  // 2) Otro grupo: solo las suyas
  await p.evaluate(async () => { const s = await import('./js/core/store.js'); s.seleccionarProyecto(s.store.proyectos.find(x => x.codigo === 'G-CIA').id); }); await p.waitForTimeout(1200);
  t = await textos();
  chk(t.includes('Tarea de ConstruIA') && !t.includes('Tarea de Gestión') && !t.includes('Nueva en Gestión'), 'LPS ConstruIA: solo sus actividades');
  // 3) GT · todos: todas, separadas por grupo, con la columna; sin grupo elegido no se registra
  await p.evaluate(async () => (await import('./js/core/store.js')).seleccionarProyecto('')); await p.waitForTimeout(1200);
  await p.fill('[data-grilla] .grilla-buscar', 'Tarea'); await p.waitForTimeout(800);   // solo las de la prueba (la demo trae muchas)
  t = await textos();
  chk(['Tarea de Gestión', 'Tarea de ConstruIA', 'Tarea sin grupo'].every(x => t.includes(x)), 'GT · todos: se ven todas');
  chk((await titulos()).includes('Grupo LPS'), 'GT · todos: aparece la columna «Grupo LPS»');
  const cab = (await p.locator('[data-grilla] .tabulator-group').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim());
  console.log('  grupos:', cab.join(' | '));
  chk(cab.some(x => x.includes('LPS Gestión')) && cab.some(x => x.includes('LPS ConstruIA')) && cab.some(x => x.includes('Sin Grupo LPS')), 'GT · todos: separadas por grupo (y «Sin Grupo LPS»)');
  // La lista de la columna «Grupo LPS» ofrece solo los Grupos LPS (nunca los proyectos)
  await p.locator('.tabulator-row', { hasText: 'Tarea sin grupo' }).locator('[tabulator-field="proyecto_id"]').dblclick(); await p.waitForTimeout(400);
  const ops = (await p.locator('.tabulator-edit-list-item').allInnerTexts()).map(x => x.trim()).filter(Boolean);
  console.log('  opciones Grupo LPS:', ops.join(' | '));
  chk(ops.length === 2 && ops.some(o => o.startsWith('LPS Gestión')) && ops.some(o => o.startsWith('LPS ConstruIA')), 'columna Grupo LPS: solo los 2 grupos');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('[data-grilla] .grilla-buscar', ''); await p.waitForTimeout(500);
  const antes = await p.locator('[data-grilla] .tabulator-row').count();
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(600);
  const aviso = (await p.locator('.toast').allInnerTexts()).join(' ');
  chk((await p.locator('[data-grilla] .tabulator-row').count()) === antes && /elija primero un Grupo LPS/i.test(aviso), 'sin grupo elegido: «+ Fila» pide elegir un Grupo LPS');
  // 4) Plan semanal: mismas reglas
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(1800);
  chk((await titulos()).includes('Grupo LPS'), 'Plan (GT · todos): columna «Grupo LPS»');
  const fin = await p.evaluate(async () => (await (await import('./js/data/api.js')).api.list('actividades', {})).length);
  chk(fin === ini.total + 1, `sin pérdidas (actividades ${fin} = ${ini.total} + 1 nueva)`);
  console.log(errs.length || fallas.length ? ['ERRORES', ...errs, ...fallas] : 'SIN ERRORES');
  await b.close();
})();
