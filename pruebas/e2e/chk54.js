const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo#/config/usuarios'); await p.waitForTimeout(1200);
  console.log('Usuarios:', (await p.$$eval('table thead th', t => t.map(x => x.textContent.trim()))).join(' | '));
  await p.goto(B + '?demo#/config/listas'); await p.waitForTimeout(1200);
  console.log('Grupos:', await p.$$eval('optgroup', g => g.map(x => x.label + ': ' + [...x.children].slice(0,3).map(o => o.textContent).join(', '))));
  await b.close();
})();
