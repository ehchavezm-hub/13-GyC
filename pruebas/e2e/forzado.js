const { chromium } = require('playwright');
const fs = require('fs');
const SRV = process.argv[2];
const BASE = 'http://127.0.0.1:8098/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)');
  await p.waitForTimeout(2500); await p.reload(); await p.waitForTimeout(2000);
  await p.screenshot({ path: 'shots3/forz0.png' }); console.log('url', p.url());
  console.log('antes:', await p.textContent('[data-a="actualizar"]', { timeout: 5000 }).catch(() => 'NO ENCONTRADO'));
  // Publicar "nueva versión" en el servidor
  const f = SRV + '/js/ui/layout.js';
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('>Actualizar</button>', '>Actualizar V2</button>'));
  fs.appendFileSync(SRV + '/config.js', "window.LPSGT_VERSION = 'bbbbbbb · 24/10/2026 07:00';\n");
  await p.click('[data-a="actualizar-menu"]'); await p.waitForTimeout(200);
  await p.click('[data-op="forzado"]'); await p.waitForTimeout(150);
  await p.screenshot({ path: 'shots3/forz_aviso.png' });
  await p.waitForTimeout(4000);
  console.log('aviso:', await p.$$eval('.toast', t => t.map(x => x.textContent).join(' | ')));
  await p.screenshot({ path: 'shots3/forz_toast.png' });
  console.log('después del forzado:', await p.textContent('[data-a="actualizar"]', { timeout: 5000 }).catch(() => 'NO ENCONTRADO'));
  // Otra versión: recarga normal (el service worker debe confirmar con el servidor)
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('>Actualizar V2</button>', '>Actualizar V3</button>'));
  await p.click('[data-a="actualizar"]'); await p.waitForTimeout(3000);
  console.log('después de recarga normal:', await p.textContent('[data-a="actualizar"]', { timeout: 5000 }).catch(() => 'NO ENCONTRADO'));
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
