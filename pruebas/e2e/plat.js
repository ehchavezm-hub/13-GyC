const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('requestfailed', r => errs.push('FALLO ' + r.url()));
  p.on('dialog', d => d.accept());
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1500);
  const panel = async t => { await p.click(`.admin-item:has-text("${t}")`); await p.waitForTimeout(700); };
  const guardar = async () => { await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(600); };
  const llenar = async (n, v) => { const el = p.locator(`.modal [name="${n}"]`).first(); const tag = await el.evaluate(e => e.tagName); if (tag === 'SELECT') await el.selectOption({ label: v }); else await el.fill(v); };
  console.log('menú:', (await p.locator('.admin-item').allInnerTexts()).map(s => s.trim()).join(' | '));
  // Nueva empresa
  await panel('Empresas');
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(300);
  console.log('campos del formulario:', await p.locator('.modal [name]').evaluateAll(es => es.map(e => e.name).join(',')));
  await llenar('nombre_empresa', 'Constructora Andina');
  await guardar();
  console.log('super admin nueva:', (await p.locator('.tabla-empresas tr:has-text("Constructora Andina") td').nth(2).innerText()).trim());
  console.log('empresas:', (await p.locator('.tabla-empresas tbody tr').count()), (await p.locator('.tabla-empresas tbody').innerText()).replace(/\s+/g, ' ').slice(0, 300));
  await p.screenshot({ path: SH + 'plat_empresas.png' });
  // Estructura: portafolio, programa, proyecto en la empresa nueva
  await panel('Estructura de todas las empresas');
  const filaEmp = p.locator('.est-empresa:has-text("Constructora Andina")');
  await filaEmp.locator('[data-nuevo="portafolios"]').click(); await p.waitForTimeout(300);
  await llenar('nombre', 'Obras Industriales'); await guardar();
  await p.locator('.est-portafolio:has-text("Obras Industriales") [data-nuevo="programas"]').click(); await p.waitForTimeout(300);
  await llenar('nombre', 'Plantas del Norte'); await guardar();
  await p.locator('.est-programa:has-text("Plantas del Norte") [data-nuevo="proyectos"]').click(); await p.waitForTimeout(300);
  await llenar('codigo', 'PN-01'); await llenar('nombre_corto', 'Planta Trujillo'); await guardar();
  await p.locator('.est-proyecto:has-text("Planta Trujillo") [data-lideres]').first().click(); await p.waitForTimeout(300);
  // La empresa nueva no tiene usuarios todavía: se agrega uno con «Usuarios» y luego se asigna
  const nCasillas = await p.locator('.modal input[type="checkbox"]').count();
  console.log('candidatos sin usuarios:', nCasillas);
  await p.click('.modal-pie button:has-text("Cancelar")'); await p.waitForTimeout(300);
  await p.locator('.est-empresa:has-text("Constructora Andina") [data-usuarios]').click(); await p.waitForTimeout(400);
  await p.click('.modal [data-a="nuevo"]'); await p.waitForTimeout(300);
  await p.locator('.modal').last().locator('[name="nombre"]').fill('Ana Gerente');
  await p.locator('.modal').last().locator('[name="email"]').fill('ana@andina.pe');
  await p.locator('.modal').last().locator('[name="clave"]').fill('Clave1234');
  await p.locator('.modal').last().locator('.modal-pie .btn-primario').click(); await p.waitForTimeout(700);
  console.log('usuarios de la empresa:', (await p.locator('.modal').first().locator('tbody').innerText()).replace(/\s+/g, ' '));
  await p.locator('.modal-pie button:has-text("Cerrar")').click(); await p.waitForTimeout(500);
  await p.locator('.est-proyecto:has-text("Planta Trujillo") [data-lideres]').first().click(); await p.waitForTimeout(300);
  await p.locator('.modal input[type="checkbox"]').first().check(); await guardar();
  console.log('estructura:', (await p.locator('.chips-cifras').innerText()).replace(/\s+/g, ' '));
  console.log('fila proyecto:', (await p.locator('.est-proyecto:has-text("Planta Trujillo")').innerText()).replace(/\s+/g, ' '));
  await p.screenshot({ path: SH + 'plat_estructura.png' });
  await p.click('[data-vista="arbol"]'); await p.waitForTimeout(500);
  console.log('cajas organigrama:', await p.locator('.org-caja').count());
  await p.screenshot({ path: SH + 'plat_organigrama.png' });
  await p.locator('.org-arbol').nth(1).screenshot({ path: SH + 'plat_org2.png' });
  for (const t of ['Resumen', 'Usuarios', 'Propietarios', 'Auditoría', 'Reportes']) {
    await p.locator('.admin-item', { hasText: t }).first().click(); await p.waitForTimeout(700);
    const txt = await p.locator('#admin-contenido').innerText();
    console.log(t, '→', txt.replace(/\s+/g, ' ').slice(0, 90));
  }
  for (const t of ['Estructura de la empresa', 'Proyectos / Procesos']) {
    await panel(t);
    const txt = await p.locator('#admin-contenido').innerText();
    console.log('[empresa]', t, '→', txt.replace(/\s+/g, ' ').slice(0, 80));
  }
  // Abrir otra empresa
  await panel('Empresas');
  await p.locator('.tabla-empresas tr:has-text("Constructora Andina") [data-abrir]').click(); await p.waitForTimeout(400);
  await p.locator('.modal-pie .btn-primario, .modal .btn-primario').last().click(); await p.waitForTimeout(2500);
  console.log('tras abrir:', await p.locator('.admin-miga-sel select[data-sel="empresa"]').evaluate(s => s.selectedOptions[0]?.textContent));
  console.log('menú empresa:', await p.locator('.admin-nav-grupo').allInnerTexts());
  await p.screenshot({ path: SH + 'plat_abierta.png' });
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
