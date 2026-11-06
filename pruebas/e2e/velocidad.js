// Mide cada módulo con 200 ms de demora por llamada (como Supabase desde Perú)
const { chromium } = require('playwright');
const LAT = Number(process.env.LAT || 200);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1500);
  await p.evaluate(l => localStorage.setItem('lpsgt-latencia', l), String(LAT));
  // quieto = sin llamadas nuevas durante 2 latencias
  const quieto = async () => { let n = -1, t0 = Date.now(); for (;;) { const k = await p.evaluate(() => (window.__llamadas || []).length); if (k === n && Date.now() - t0 > 2 * LAT + 100) return; if (k !== n) { n = k; t0 = Date.now(); } await p.waitForTimeout(50); } };
  const medir = async (nombre, accion) => {
    await p.evaluate(() => { window.__llamadas = []; window.__t0 = performance.now(); });
    const t = Date.now(); await accion(); await quieto();
    const ll = await p.evaluate(() => window.__llamadas);
    const ms = Date.now() - t - (2 * LAT + 100);
    const cuenta = {}; for (const x of ll) cuenta[x] = (cuenta[x] || 0) + 1;
    console.log(`${nombre.padEnd(22)} ${String(Math.max(ms, 0)).padStart(6)} ms  ${String(ll.length).padStart(3)} llamadas  ${Object.entries(cuenta).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(', ')}`);
  };
  await medir('ARRANQUE', async () => { await p.goto(B + '?demo#/plan'); });
  for (const r of ['/lookahead', '/restricciones', '/cartera', '/tablero', '/reunion', '/equipo', '/proyectos', '/plantillas', '/reportes', '/config/listas', '/config/usuarios', '/mejoras', '/ayuda', '/admin', '/plan']) {
    await medir(r, async () => { await p.evaluate(h => { location.hash = h; }, '#' + r); });
  }
  await medir('cambiar proyecto', async () => { await p.evaluate(async () => { const s = await import('./js/core/store.js'); s.seleccionarProyecto(s.store.proyectos[0].id); }); });
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
