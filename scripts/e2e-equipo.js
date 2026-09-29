/**
 * Cuentas y equipo de punta a punta (MongoDB en memoria): verificar correo, recuperar contraseña,
 * roles (cajero, recepción, repartidor) y pedidos asignados a un repartidor.
 *
 *   npm run e2e
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
Object.assign(process.env, {
  MONGO_URI: mongo.getUri('flujobot-e2e-equipo'),
  JWT_SECRET: 'secreto-de-prueba-e2e-1234567890',
  PORT: '3396',
  N8N_URL: '',
  EVOLUTION_URL: '',
  OPENROUTER_API_KEY: '',
  RESEND_API_KEY: '',
  PROGRAMADOR: 'no',
});
const { env } = await import('../src/infrastructure/config/env.js');
const { arrancar } = await import('../src/main/arrancar.js');
const { buzonLocal } = await import('../src/infrastructure/correo/Correo.js');
const servidor = await arrancar(env);

let pasos = 0;
async function api(metodo, ruta, { token, cuerpo, esperado = 200 } = {}) {
  const r = await fetch(`http://localhost:3396${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = r.status === 204 ? null : await r.json();
  assert.equal(r.status, esperado, `${metodo} ${ruta} → ${r.status} ${JSON.stringify(json)}`);
  pasos++;
  return json?.data;
}
const enlace = (para, ruta) => {
  const correo = [...buzonLocal].reverse().find((c) => c.para === para && c.texto.includes(ruta));
  assert.ok(correo, `no llegó correo con ${ruta} a ${para}`);
  return new URL(correo.texto.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
};

try {
  // ───── Verificar correo
  const dueno = await api('POST', '/auth/registro', { cuerpo: { empresa: 'Pizzería Nápoles', nombre: 'Rosa', email: 'rosa@test.mx', password: 'secreta123', giro: 'restaurante' }, esperado: 201 });
  const T = dueno.token;
  assert.equal(dueno.usuario.emailVerificado, false);
  await new Promise((r) => setTimeout(r, 200)); // el correo de verificación sale en segundo plano
  const tokenVerificar = enlace('rosa@test.mx', '/verificar');
  await api('POST', '/auth/verificar', { cuerpo: { token: tokenVerificar } });
  await api('POST', '/auth/verificar', { cuerpo: { token: tokenVerificar }, esperado: 422 }); // un solo uso
  assert.equal((await api('GET', '/auth/perfil', { token: T })).usuario.emailVerificado, true);

  // ───── Recuperar contraseña
  const r1 = await api('POST', '/auth/recuperar', { cuerpo: { email: 'rosa@test.mx' } });
  const r2 = await api('POST', '/auth/recuperar', { cuerpo: { email: 'nadie@test.mx' } });
  assert.equal(r1.mensaje, r2.mensaje, 'no revela qué correos tienen cuenta');
  const tokenRecuperar = enlace('rosa@test.mx', '/restablecer');
  await api('POST', '/auth/restablecer', { cuerpo: { token: 'x'.repeat(40), password: 'nueva12345' }, esperado: 422 });
  await api('POST', '/auth/restablecer', { cuerpo: { token: tokenRecuperar, password: 'corta' }, esperado: 400 });
  await api('POST', '/auth/restablecer', { cuerpo: { token: tokenRecuperar, password: 'nueva12345' } });
  await api('POST', '/auth/login', { cuerpo: { email: 'rosa@test.mx', password: 'secreta123' }, esperado: 401 });
  await api('POST', '/auth/login', { cuerpo: { email: 'rosa@test.mx', password: 'nueva12345' } });
  await api('POST', '/auth/restablecer', { cuerpo: { token: tokenRecuperar, password: 'otra123456' }, esperado: 422 });

  // ───── Equipo con roles
  const alta = (nombre, email, rol) => api('POST', '/usuarios', { token: T, cuerpo: { nombre, email, password: 'secreta123', rol }, esperado: 201 });
  const repartidor = await alta('Memo', 'memo@test.mx', 'repartidor');
  await alta('Caja', 'caja@test.mx', 'cajero');
  await alta('Rece', 'rece@test.mx', 'recepcion');
  const entrar = async (email) => (await api('POST', '/auth/login', { cuerpo: { email, password: 'secreta123' } })).token;
  const [TR, TC, TRe] = [await entrar('memo@test.mx'), await entrar('caja@test.mx'), await entrar('rece@test.mx')];

  // Pedidos de prueba por el chat web
  await api('POST', '/productos', { token: T, cuerpo: { nombre: 'Pizza', precio: 150 }, esperado: 201 });
  const bot = await api('POST', '/bots', { token: T, cuerpo: { nombre: 'Pedidos', plantilla: 'tienda' }, esperado: 201 });
  await api('POST', `/bots/${bot.id}/publicar`, { token: T });
  const web = await api('PUT', `/bots/${bot.id}/web`, { token: T, cuerpo: { activo: true } });
  for (const vis of ['cliente-web-aaaa-1', 'cliente-web-bbbb-2']) {
    for (const texto of ['hola', '1', '1', '2', 'Luis', 'Calle 1']) await api('POST', `/publico/chat/${web.clave}/mensajes`, { cuerpo: { visitante: vis, texto } });
  }
  const [p2, p1] = await api('GET', '/pedidos', { token: T });

  // Qué ve cada rol
  await api('GET', '/bots', { token: TC, esperado: 403 });
  await api('GET', '/productos', { token: TC });
  await api('GET', '/citas', { token: TC, esperado: 403 });
  await api('GET', '/citas', { token: TRe });
  await api('GET', '/productos', { token: TRe, esperado: 403 });
  await api('GET', '/conversaciones', { token: TR, esperado: 403 });
  await api('PATCH', '/empresa', { token: TC, cuerpo: { nombre: 'X' }, esperado: 403 });
  await api('POST', '/asistente/flujos', { token: TRe, cuerpo: { descripcion: 'un bot para pedidos de pizza' }, esperado: 403 });

  // Repartidor: solo sus pedidos y solo "en camino" / "entregado"
  assert.equal((await api('GET', '/pedidos', { token: TR })).length, 0);
  await api('PUT', `/pedidos/${p1.id}/repartidor`, { token: TC, cuerpo: { usuarioId: repartidor.id } });
  await api('PUT', `/pedidos/${p1.id}/repartidor`, { token: TC, cuerpo: { usuarioId: dueno.usuario.id }, esperado: 422 }); // no es repartidor
  await api('PUT', `/pedidos/${p1.id}/repartidor`, { token: TR, cuerpo: { usuarioId: null }, esperado: 403 });
  const mios = await api('GET', '/pedidos', { token: TR });
  assert.deepEqual(mios.map((p) => p.folio), [p1.folio]);
  assert.equal(mios[0].repartidorNombre, 'Memo');
  await api('PATCH', `/pedidos/${p1.id}/estado`, { token: TR, cuerpo: { estado: 'cancelado' }, esperado: 403 });
  await api('PATCH', `/pedidos/${p2.id}/estado`, { token: TR, cuerpo: { estado: 'enviado' }, esperado: 403 });
  await api('PATCH', `/pedidos/${p1.id}/estado`, { token: TR, cuerpo: { estado: 'entregado' } });
  await api('POST', `/pedidos/${p1.id}/pagado`, { token: TR });
  assert.equal((await api('GET', '/pedidos?repartidorId=' + repartidor.id, { token: T }))[0].pago.estado, 'pagado');

  // Cambiar rol y bitácora
  await api('PATCH', `/usuarios/${repartidor.id}`, { token: T, cuerpo: { rol: 'cajero', telefono: '5512345678' } });
  await api('PATCH', `/usuarios/${dueno.usuario.id}`, { token: T, cuerpo: { rol: 'editor' }, esperado: 422 });
  await api('PATCH', `/usuarios/${repartidor.id}`, { token: TC, cuerpo: { rol: 'admin' }, esperado: 403 });
  const actividad = await api('GET', '/gestion/actividad', { token: T });
  for (const a of ['usuario.crear', 'usuario.editar', 'pedido.repartidor', 'pedido.estado']) assert.ok(actividad.some((x) => x.accion === a), `falta ${a}`);

  console.log(`\n✔ e2e equipo OK (${pasos} peticiones)`);
} catch (e) {
  console.error('\n✘ e2e equipo FALLÓ:', e.message);
  process.exitCode = 1;
} finally {
  servidor.close();
  await (await import('mongoose')).default.disconnect();
  await mongo.stop();
  process.exit();
}
