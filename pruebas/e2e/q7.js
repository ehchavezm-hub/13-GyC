const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const entrar = async n => { await p.goto(B + '?demo'); await p.evaluate(() => { const db = localStorage.getItem('lpsgt-demo-db'); const keep = Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('lpsgt-demo')).map(k => [k, localStorage.getItem(k)])); localStorage.clear(); for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v); localStorage.removeItem('lpsgt-demo-usuario'); });
    await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); const u = p.locator('.usuarios-demo button').nth(n); const nom = (await u.innerText()).split('\n')[0]; await u.click(); await p.waitForTimeout(1200); return nom; };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  console.log('propietario:', await entrar(0));
  // otra empresa con una mejora propia
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Empresas")'); await p.waitForTimeout(500);
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(300); await p.locator('.modal [name="nombre_empresa"]').fill('Constructora Andina'); await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(800);
  await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); const areas = await api.list('areas', {});
    const otra = areas.find(a => a.nombre === 'Constructora Andina'); await api.insert('solicitudes_cambio', { area_id: otra.id, titulo: 'Mejora de Andina', descripcion: 'x', prioridad: 'alta' }); });
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(1200);
  const items = await p.evaluate(() => [...document.querySelectorAll('.nav-modulos a, .nav-modulos .nav-grupo')].map(a => a.innerText.trim()));
  console.log('final del menú:', items.slice(-3).join(' › '));
  await p.click('.nav-modulos a[href="#/mejoras"]'); await p.waitForTimeout(1200);
  const filas = async () => (await p.locator('#contenido table tr').allInnerTexts()).slice(1).map(t => t.replace(/\s+/g, ' ').slice(0, 90));
  console.log('propietario ve:', await filas());
  console.log('botones Gestionar (propietario):', await p.locator('[data-g]').count());
  await p.locator('[data-g]').first().click(); await p.waitForTimeout(300);
  await p.locator('.modal [name="estado"]').selectOption('aprobada'); await p.locator('.modal [name="respuesta"]').fill('La haremos'); await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(800);
  console.log('tras gestionar:', (await filas())[0]);
  // líder (otra persona, sin permisos de gestión)
  const lider = await entrar(2); console.log('usuario:', lider);
  await p.goto(B + '?demo#/mejoras'); await p.waitForTimeout(1200);
  console.log('líder ve:', (await filas()).length, 'solicitudes; Gestionar:', await p.locator('[data-g]').count(), '· nueva:', await p.locator('[data-a="nueva"]').count());
  await p.screenshot({ path: SH + 'q7.png' });
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
