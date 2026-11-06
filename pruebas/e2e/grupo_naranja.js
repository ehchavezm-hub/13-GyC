// Pedido 171: la fila del Grupo LPS elegido en el menú va en naranja (solo esa fila; el proyecto y los niveles no).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const fallas = []; const chk = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  const ids = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const P = s.store.proyectos.find(x => !x.padre_id);
    const [G1] = await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-GES', nombre_corto: 'LPS Gestión', estado: 'activo', padre_id: P.id });
    await api.insert('proyectos', { area_id: s.store.area.id, codigo: 'G-CIA', nombre_corto: 'LPS ConstruIA', estado: 'activo', padre_id: P.id });
    await s.cargarCatalogo(); return { P: P.id, G1: G1.id };
  });
  await p.goto(B + '?demo#/lookahead'); await p.waitForTimeout(1500);
  const fondo = id => p.evaluate(id => { const e = document.querySelector(`.proy-item[data-id="${id}"]`); return e ? getComputedStyle(e).backgroundColor : null; }, id);
  const NAR = 'rgb(232, 118, 43)';
  // Grupo elegido → su fila en naranja
  await p.evaluate(async id => { const s = await import('./js/core/store.js'); s.seleccionarProyecto(id); }, ids.G1); await p.waitForTimeout(800);
  // abrir el proyecto en el árbol si está cerrado
  if (!(await p.locator(`.proy-item[data-id="${ids.G1}"]`).count())) { await p.locator(`.proy-item[data-id="${ids.P}"] .arbol-flecha`).click(); await p.waitForTimeout(400); }
  const f1 = await fondo(ids.G1); console.log('  fondo grupo:', f1);
  chk(f1 === NAR, 'Grupo LPS elegido: fila en naranja');
  chk(await p.locator('.proy-item.grupo-activo').count() === 1, 'solo una fila en naranja');
  chk((await p.locator('.proy-item.grupo-activo').innerText()).includes('LPS Gestión'), 'la fila naranja es la del grupo');
  // Pedido 172: la sección elegida del menú (Look Ahead) también en naranja, solo esa
  const sec = await p.evaluate(() => [...document.querySelectorAll('.nav a.activo')].map(a => [a.innerText.trim(), getComputedStyle(a).backgroundColor]));
  console.log('  sección:', JSON.stringify(sec));
  chk(sec.length === 1 && sec[0][0].includes('Look Ahead') && sec[0][1] === NAR, 'sección elegida en naranja');
  // Proyecto elegido (no grupo) → sin naranja
  await p.evaluate(async id => { const s = await import('./js/core/store.js'); s.seleccionarProyecto(id); }, ids.P); await p.waitForTimeout(800);
  const f2 = await fondo(ids.P); console.log('  fondo proyecto:', f2);
  chk(f2 !== NAR && await p.locator('.proy-item.grupo-activo').count() === 0, 'proyecto elegido: sin naranja');
  chk(!errs.length, 'sin errores de página ' + errs.join(' / '));
  await b.close(); console.log(fallas.length ? `FALLAS: ${fallas.length}` : 'SIN ERRORES'); process.exit(fallas.length ? 1 : 0);
})();
