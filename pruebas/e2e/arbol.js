const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // Estructura de ejemplo directamente con la API demo
  await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const { store, cargarCatalogo } = await import('./js/core/store.js');
    const a = store.area.id;
    const [f1] = await api.insert('portafolios', { area_id: a, codigo: 'P01', nombre: 'Personal', estado: 'activo' });
    const [f2] = await api.insert('portafolios', { area_id: a, codigo: 'P02', nombre: 'P. Industriales', estado: 'activo' });
    const [g1] = await api.insert('programas', { area_id: a, portafolio_id: f1.id, codigo: 'PG01', nombre: 'Capacitación', estado: 'activo' });
    const [g2] = await api.insert('programas', { area_id: a, portafolio_id: f1.id, codigo: 'PG02', nombre: 'Salud', estado: 'activo' });
    const ps = store.proyectos.filter(x => x.estado === 'activo');
    await api.update('proyectos', ps[0].id, { portafolio_id: f1.id, programa_id: g1.id });
    await api.update('proyectos', ps[1].id, { portafolio_id: f1.id, programa_id: g1.id });
    await api.update('proyectos', ps[2].id, { portafolio_id: f1.id, programa_id: g2.id });
    await cargarCatalogo();
  });
  await p.waitForTimeout(800);
  const lat = await p.locator('.menu-proy').boundingBox(); console.log('pestañas:', await p.locator('.menu-proy .pestanas').count(), 'estrellas:', await p.locator('.menu-proy .estrella').count());
  await p.screenshot({ path: SH + 'arbol_menu.png', clip: { x: lat.x, y: lat.y, width: lat.width, height: Math.min(lat.height, 560) } });
  console.log((await p.locator('.proy-lista').innerText()).replace(/\n+/g, ' | '));
  // contraer Personal y elegir un proyecto
  await p.click('.arbol-port:has-text("Personal")'); await p.waitForTimeout(300);
  console.log('contraído:', (await p.locator('.proy-lista').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
  await p.click('.arbol-port:has-text("Personal")'); await p.waitForTimeout(300);
  await p.locator('.proy-item').first().click(); await p.waitForTimeout(300);
  console.log('seleccionado:', await p.locator('.proy-item.activo .nom').innerText());
  await p.click('.arbol-emp .nom'); await p.waitForTimeout(300);
  console.log('todos activo:', await p.locator('.arbol-emp.activo').count());
  await p.fill('.menu-proy input', 'puente'); await p.waitForTimeout(300);
  console.log('búsqueda:', (await p.locator('.proy-lista').innerText()).replace(/\n+/g, ' | '));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
