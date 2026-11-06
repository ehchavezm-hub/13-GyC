const { chromium } = require('playwright');
const fs = require('fs');
const SW = '/home/user/11-lps_gt/app/sw.js';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  let pedidos = 0; p.on('request', r => { if (r.url().startsWith(B) && r.url().includes('/js/')) pedidos++; });
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(2500);
  console.log('SW controla:', await p.evaluate(() => !!navigator.serviceWorker.controller));
  // segunda carga: el código sale de la caché del service worker
  const red = []; ctx.on('requestfinished', async r => { const resp = await r.response(); if (r.url().includes('/js/')) red.push(resp.fromServiceWorker()); });
  await p.reload(); await p.waitForTimeout(2000);
  console.log('módulos JS servidos por el service worker:', red.filter(Boolean).length, 'de', red.length);
  // nueva versión publicada
  const orig = fs.readFileSync(SW, 'utf8');
  fs.writeFileSync(SW, orig.replace(/const VERSION = '[^']*'/, "const VERSION = 'lpsgt-prueba-nueva'"));
  try {
    const recargas = []; p.on('framenavigated', f => { if (f === p.mainFrame()) recargas.push(Date.now()); });
    await p.reload(); await p.waitForTimeout(6000);
    console.log('recargas (1 = la mía, 2 = + actualización automática):', recargas.length);
    console.log('caché activa:', await p.evaluate(async () => (await caches.keys()).join(',')));
  } finally { fs.writeFileSync(SW, orig); }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
