const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto('http://localhost:8099/?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto('http://localhost:8099/?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto('http://localhost:8099/?demo&a=2#/config/parametros'); await p.waitForTimeout(1500);
  const el = p.locator('[data-name="la_dias"]').locator('xpath=..');
  await el.scrollIntoViewIfNeeded(); const bx = await el.boundingBox();
  await p.screenshot({ path: 'shots98/conf111.png', clip: { x: bx.x - 10, y: bx.y - 10, width: Math.min(900, bx.width + 20), height: 190 } });
  await b.close();
})();
