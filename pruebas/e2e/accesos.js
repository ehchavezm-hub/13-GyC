const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  for (const [titulo, esperado] of [['Gerencia', 'gerencias'], ['CET / Servicio', 'servicios'], ['Proyecto / Proceso', '#/proyectos']]) {
    await p.goto(BASE + '?demo#/plan'); await p.waitForTimeout(1300);
    await p.click(`.tabulator-col[tabulator-field] .tabulator-col-title:text-is("${titulo}")`, { button: 'right' });
    await p.waitForTimeout(300);
    const item = await p.$('.tabulator-menu .tabulator-menu-item');
    if (titulo === 'Gerencia') await p.screenshot({ path: 'shots3/menu_titulo.png', clip: { x: 300, y: 200, width: 700, height: 250 } });
    chk(!!item, 'menú en título ' + titulo + ': ' + (item ? await item.textContent() : ''));
    if (!item) continue;
    await item.click(); await p.waitForTimeout(1300);
    const url = p.url();
    if (esperado.startsWith('#')) chk(url.includes(esperado), 'lleva a ' + esperado);
    else chk((await p.$eval('[data-l]', s => s.value)) === esperado, 'abre la lista ' + esperado + ' (' + url.split('#')[1] + ')');
  }
  // un líder no ve el acceso (no gestiona listas) en Gerencia, pero sí en Proyecto (propone)
  await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
  await p.goto(BASE + '?demo&x=4#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:has-text("Bruno Salas")'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/plan'); await p.waitForTimeout(1300);
  await p.click(`.tabulator-col .tabulator-col-title:text-is("Gerencia")`, { button: 'right' }); await p.waitForTimeout(300);
  chk(!(await p.$('.tabulator-menu')), 'líder sin acceso a editar gerencias');
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
