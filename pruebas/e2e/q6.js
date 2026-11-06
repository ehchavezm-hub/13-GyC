const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/plan'); await p.waitForTimeout(1500);
  const orden = await p.evaluate(() => [...document.querySelector('.lateral').children].filter(e => e.offsetHeight).map(e => e.className.split(' ').slice(0, 2).join(' ')));
  console.log('orden del menú (admin):', orden.join(' → '));
  await p.screenshot({ path: SH + 'q6.png', clip: { x: 0, y: 50, width: 300, height: 850 } });
  // navegar sigue funcionando y se marca la opción activa
  await p.click('.nav-modulos a[href="#/tablero"]'); await p.waitForTimeout(800);
  console.log('activo:', await p.locator('.nav a.activo').innerText());
  // usuario sin Administración (líder): PROYECTOS queda arriba
  await p.evaluate(() => localStorage.clear()); await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button');
  const lider = p.locator('.usuarios-demo button').nth(2); console.log('usuario:', (await lider.innerText()).split('\n')[0]); await lider.click(); await p.waitForTimeout(1200);
  const orden2 = await p.evaluate(() => [...document.querySelector('.lateral').children].filter(e => e.offsetHeight).map(e => e.className.split(' ').slice(0, 2).join(' ')));
  console.log('orden del menú (sin admin):', orden2.join(' → '));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
