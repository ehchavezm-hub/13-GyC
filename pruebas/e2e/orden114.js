const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto('http://localhost:8099/?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto('http://localhost:8099/?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto('http://localhost:8099/?demo&a=2#/config/parametros'); await p.waitForTimeout(1500);
  const etiquetas = await p.$$eval('.tarjeta .campo > label', l => l.map(x => x.textContent.trim()).slice(0, 5));
  console.log(etiquetas.slice(0, 3).join(' | ') === 'Días laborables | Trabajo en sábado y domingo | Horas disponibles por día (por defecto)' ? 'OK orden' : 'FALLA orden', '·', etiquetas.join(' | '));
  await p.locator('.tarjeta').first().screenshot({ path: 'shots98/orden114.png' });
  console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
