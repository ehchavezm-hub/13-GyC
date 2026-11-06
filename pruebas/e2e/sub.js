const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Estructura de todas")'); await p.waitForTimeout(800);
  const padre = p.locator('.est-proyecto:has-text("Hospital Demo Norte")');
  for (const [cod, nom] of [['D-101.1', 'Torre A'], ['D-101.2', 'Torre B']]) {
    await padre.locator('[data-padre]').click(); await p.waitForTimeout(300);
    console.log('campos sub:', await p.locator('.modal [name]').evaluateAll(es => es.map(e => e.name).join(',')));
    await p.locator('.modal [name="codigo"]').fill(cod); await p.locator('.modal [name="nombre_corto"]').fill(nom);
    await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(700);
  }
  console.log('filas sub:', (await p.locator('.est-subproyecto').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 70)));
  await p.click('[data-vista="arbol"]'); await p.waitForTimeout(400);
  console.log('cajas sub organigrama:', await p.locator('.org-subproyecto').count());
  await p.screenshot({ path: SH + 'sub_organigrama.png' });
  // menú lateral
  await p.goto(B + '?demo&a=2#/plan'); await p.waitForTimeout(1500);
  console.log('menú:', (await p.locator('.proy-lista').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
  const lat = await p.locator('.menu-proy').boundingBox();
  await p.screenshot({ path: SH + 'sub_menu.png', clip: { x: lat.x, y: lat.y, width: lat.width, height: 420 } });
  // opciones de proyecto en la grilla: el padre no se ofrece
  const ops = await p.evaluate(async () => (await import('./js/core/store.js')).opcionesProyectos().map(o => o.label));
  console.log('opciones con Hospital:', ops.filter(l => /Hospital|Torre/.test(l)));
  // asignar una actividad al Grupo LPS y filtrar por el padre
  const r = await p.evaluate(async () => {
    const { api } = await import('./js/data/api.js'); const s = await import('./js/core/store.js');
    const torre = s.store.proyectos.find(x => x.nombre_corto === 'Torre A');
    const padre = s.store.proyectos.find(x => x.nombre_corto === 'Hospital Demo Norte');
    const otro = s.store.proyectos.find(x => x.nombre_corto === 'Puente Demo Río Azul');
    s.seleccionarProyecto(padre.id);
    return { subEntra: s.enProyectoSel(torre.id), padreEntra: s.enProyectoSel(padre.id), otroEntra: s.enProyectoSel(otro.id), contenedor: s.esContenedor(padre),
      lideresHeredados: s.lideresHeredados(torre.id).length };
  });
  console.log('filtro por padre incluye Grupo LPS:', r);
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
