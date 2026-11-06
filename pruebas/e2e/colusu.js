const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/config/usuarios'); await p.waitForTimeout(1200);
  const cab = await p.$$eval('table.simple tr:first-child th', t => t.map(x => x.textContent));
  const fila = await p.$$eval('table.simple tr:has-text("Bruno Salas") td', t => t.map(x => x.textContent.trim()).slice(0, 4));
  console.log(cab.slice(0, 5).join(' | ')); console.log(fila.join(' | '));
  await b.close();
})();
