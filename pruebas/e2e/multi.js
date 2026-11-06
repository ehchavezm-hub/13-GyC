const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const toasts = async () => (await p.locator('.toast').allInnerTexts()).map(t => t.trim()).slice(-1)[0] || '';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  const guardar = async () => { await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(800); };
  const llenar = async (n, v) => { const el = p.locator(`.modal [name="${n}"]`).last(); const tag = await el.evaluate(e => e.tagName); if (tag === 'SELECT') await el.selectOption({ label: v }); else await el.fill(v); };
  await p.click('.admin-item:has-text("Empresas")'); await p.waitForTimeout(500);
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(300); await llenar('nombre_empresa', 'Constructora Andina'); await guardar();
  const fila = n => p.locator(`.tabla-empresas tr:has-text("${n}")`);
  // 1) usuario nuevo en la empresa demo
  await fila('Gerencia Técnica').locator('[data-usuarios]').click(); await p.waitForTimeout(400);
  await p.click('.modal [data-a="nuevo"]'); await p.waitForTimeout(300);
  await llenar('nombre', 'Multi Empresa'); await llenar('email', 'multi@demo.pe'); await llenar('rol', 'Líder de especialidad'); await llenar('clave', 'Clave-1234'); await guardar();
  console.log('1)', await toasts());
  await p.locator('.modal-pie button:has-text("Cerrar")').click(); await p.waitForTimeout(400);
  // 2) mismo correo en la otra empresa, como super administrador
  await fila('Constructora Andina').locator('[data-usuarios]').click(); await p.waitForTimeout(400);
  await p.click('.modal [data-a="nuevo"]'); await p.waitForTimeout(300);
  await llenar('nombre', 'Multi Empresa'); await llenar('email', 'multi@demo.pe'); await llenar('rol', 'Super administrador'); await llenar('clave', 'Clave-1234'); await guardar();
  console.log('2)', await toasts());
  console.log('   usuarios de Andina:', (await p.locator('.modal').last().locator('tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 120)));
  await p.locator('.modal-pie button:has-text("Cerrar")').click(); await p.waitForTimeout(500);
  // 3) asignarlo como super administrador principal de Andina
  await fila('Constructora Andina').locator('[data-principal]').click(); await p.waitForTimeout(300);
  console.log('3) candidatos:', await p.locator('.modal [name="usuario_id"] option').allInnerTexts());
  await p.locator('.modal [name="usuario_id"]').selectOption({ index: 1 }, { timeout: 3000 }).catch(e => console.log('SEL FAIL')); await guardar();
  console.log('   super admin Andina:', (await fila('Constructora Andina').locator('td').nth(3).innerText()).replace(/\s+/g, ' '));
  console.log('   super admin GT (sin cambios):', (await fila('Gerencia Técnica').locator('td').nth(3).innerText()).replace(/\s+/g, ' ').slice(0, 60));
  // 4) entra «multi» y cambia de empresa
  await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
  await p.goto(B + '?demo&x=2#/'); await p.waitForSelector('.usuarios-demo button');
  await p.locator('.usuarios-demo button', { hasText: 'Multi Empresa' }).click(); await p.waitForTimeout(1200);
  if (await p.locator('text=Defina su nueva contraseña').count()) { const ins = p.locator('input[type=password]'); await ins.nth(0).fill('Nueva-Clave-99'); await ins.nth(1).fill('Nueva-Clave-99'); await p.click('button:has-text("Guardar")'); await p.waitForTimeout(1500); }
  const empresaYrol = () => p.evaluate(async () => { const s = await import('./js/core/store.js'); return `${s.store.area?.nombre} · ${s.store.usuario?.rol}`; });
  console.log('4) entra en:', await empresaYrol(), errs, await p.evaluate(() => document.body.innerText.slice(0, 300)), await p.evaluate(() => localStorage.getItem('lpsgt-demo-usuario')));
  await p.click('[data-a="usuario"]'); await p.waitForTimeout(300);
  console.log('   menú:', (await p.locator('.menu-usuario button').allInnerTexts()).join(' | '));
  await p.click('.menu-usuario [data-a="empresa"]'); await p.waitForTimeout(500);
  console.log('   opciones:', await p.locator('.modal [name="area_id"] option').allInnerTexts());
  await p.locator('.modal [name="area_id"]').selectOption({ label: 'Constructora Andina · Super administrador' });
  await Promise.all([p.waitForNavigation().catch(() => {}), p.click('.modal-pie .btn-primario')]); await p.waitForTimeout(2000);
  console.log('   ahora en:', await empresaYrol(), '· ve Administración:', await p.locator('.nav-admin a').count());
  // 5) el propietario ve a «multi» en GT aunque hoy trabaje en Andina
  await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
  await p.goto(B + '?demo&x=3#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1200);
  await p.goto(B + '?demo#/config/usuarios'); await p.waitForTimeout(1500);
  console.log('5) GT › Usuarios:', (await p.locator('tr:has-text("Multi Empresa")').innerText().catch(() => 'NO APARECE')).replace(/\s+/g, ' ').slice(0, 140));
  console.log('   en el equipo para asignar actividades:', await p.evaluate(async () => (await import('./js/core/store.js')).store.perfiles.some(x => x.nombre === 'Multi Empresa')));
  // 6) Plataforma › Usuarios: una fila por empresa; quitar de GT
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Usuarios")'); await p.waitForTimeout(600);
  console.log('6) filas de multi:', (await p.locator('tr:has-text("multi@demo.pe")').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 110)));
  await p.locator('tr:has-text("hoy trabaja en Constructora Andina") [data-quitar-de]').first().click(); await p.waitForTimeout(300); console.log('   modal:', (await p.locator('.modal').last().innerText()).replace(/\s+/g,' ').slice(0,200));
  await p.locator('.modal-pie .btn-peligro, .modal-pie .btn-primario').last().click(); await p.waitForTimeout(1000);
  console.log('   toast:', await toasts(), await p.locator('.modal').count());
  console.log('   tras quitar de GT:', (await p.locator('tr:has-text("multi@demo.pe")').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 110)));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
