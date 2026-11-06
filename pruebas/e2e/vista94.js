const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 920 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let popups = 0; ctx.on('page', () => popups++);
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  const pantallas = [['lookahead', 'button:has-text("PDF")'], ['plan', 'button:has-text("PDF")'], ['restricciones', 'button:has-text("PDF")'], ['cartera', 'button:has-text("PDF")'],
    ['tablero', 'button:has-text("PDF")'], ['equipo', 'button:has-text("PDF")'], ['reunion', 'button:has-text("Acta PDF")'], ['config/usuarios', '[data-a="pdf-usuarios"]'],
    ['config/listas?lista=__proyectos', 'button:has-text("PDF")'], ['ayuda', 'button:has-text("Guía rápida")']];
  for (const [r, sel] of pantallas) {
    await p.goto(B + '?demo&z=' + r.length + '#/' + r); await p.waitForTimeout(1800);
    await p.locator(sel).first().click(); await p.waitForTimeout(1500);
    const v = await p.evaluate(() => { const c = document.querySelector('.vista-pdf'); const d = c?.querySelector('iframe').contentDocument;
      return c ? { papel: c.querySelector('[data-o="papel"]').value, archivo: c.querySelector('[data-o="archivo"]').value, titulo: d?.querySelector('h1')?.textContent, tablas: d?.querySelectorAll('table').length } : null; });
    console.log(r.padEnd(32), v ? `OK · ${v.titulo} · tablas ${v.tablas} · ${v.archivo}` : 'SIN VISTA PREVIA');
    if (r === 'lookahead') {
      await p.selectOption('.vista-pdf [data-o="papel"]', 'A3'); await p.waitForTimeout(800);
      await p.screenshot({ path: require('path').join(__dirname, 'salida') + '/' + 'vista94.png' });
    }
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  }
  console.log('ventanas emergentes abiertas:', popups);
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
