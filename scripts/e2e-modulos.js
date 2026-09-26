/**
 * Módulos personalizados de punta a punta (MongoDB en memoria): plantilla, campos propios, registros
 * del panel y del bot (chat web), búsqueda, aviso al cambiar el estado y aislamiento entre empresas.
 *
 *   npm run e2e
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
Object.assign(process.env, {
  MONGO_URI: mongo.getUri('flujobot-e2e-modulos'),
  JWT_SECRET: 'secreto-de-prueba-e2e-1234567890',
  PORT: '3397',
  N8N_URL: '',
  EVOLUTION_URL: '',
  OPENROUTER_API_KEY: '',
  PROGRAMADOR: 'no',
});
const { env } = await import('../src/infrastructure/config/env.js');
const { arrancar } = await import('../src/main/arrancar.js');
const servidor = await arrancar(env);

let pasos = 0;
async function api(metodo, ruta, { token, cuerpo, esperado = 200 } = {}) {
  const r = await fetch(`http://localhost:3397${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = r.status === 204 ? null : await r.json();
  assert.equal(r.status, esperado, `${metodo} ${ruta} → ${r.status} ${JSON.stringify(json)}`);
  pasos++;
  return json?.data;
}

try {
  const taller = await api('POST', '/auth/registro', { cuerpo: { empresa: 'Taller El Rayo', nombre: 'Beto', email: 'beto@test.mx', password: 'secreta123', giro: 'servicios' }, esperado: 201 });
  const otra = await api('POST', '/auth/registro', { cuerpo: { empresa: 'Otra', nombre: 'Otra', email: 'otra@test.mx', password: 'secreta123' }, esperado: 201 });
  const T = taller.token;

  // Plantillas y módulo desde plantilla
  const plantillas = await api('GET', '/modulos/plantillas', { token: T });
  assert.ok(plantillas.some((p) => p.id === 'ordenes_servicio'));
  const ordenes = await api('POST', '/modulos', { token: T, cuerpo: { plantilla: 'ordenes_servicio' }, esperado: 201 });
  assert.equal(ordenes.clave, 'ordenes-de-servicio');
  assert.equal(ordenes.prefijo, 'OS');
  const estado = ordenes.campos.find((c) => c.id === 'estado');
  assert.equal(estado.avisar, true);

  // Módulo propio desde cero (el taller que además vende)
  const ventas = await api('POST', '/modulos', {
    token: T,
    cuerpo: { nombre: 'Ventas de mostrador', singular: 'Venta', icono: 'carrito', prefijo: 'VM', campos: [{ nombre: 'Refacción', tipo: 'texto', requerido: true }, { nombre: 'Total', tipo: 'dinero' }] },
    esperado: 201,
  });
  await api('POST', '/modulos', { token: T, cuerpo: { nombre: 'Malo', campos: [{ nombre: 'Estado', tipo: 'opcion' }] }, esperado: 422 });
  assert.equal((await api('GET', '/modulos', { token: T })).length, 2);
  assert.equal((await api('GET', '/modulos', { token: otra.token })).length, 0);

  // Registros desde el panel
  const r1 = await api('POST', `/modulos/${ordenes.id}/registros`, {
    token: T,
    cuerpo: { datos: { cliente: 'Carla Ruiz', telefono: '5511112222', equipo_o_vehiculo: 'Tsuru 2010', placas_o_numero_de_serie: 'ABC-123', presupuesto: '$2,300', estado: 'Recibido' } },
    esperado: 201,
  });
  assert.equal(r1.folio, 'OS-000001');
  await api('POST', `/modulos/${ordenes.id}/registros`, { token: T, cuerpo: { datos: { cliente: 'Sin vehículo' } }, esperado: 422 });
  await api('POST', `/modulos/${ventas.id}/registros`, { token: T, cuerpo: { datos: { refaccion: 'Balatas', total: 850 } }, esperado: 201 });
  assert.equal((await api('GET', `/modulos/${ordenes.id}/registros?texto=abc-123`, { token: T })).length, 1, 'busca por placas');
  assert.equal((await api('GET', `/modulos/${ordenes.id}/registros?campo=estado&valor=Recibido`, { token: T })).length, 1);
  await api('GET', `/modulos/${ordenes.id}/registros`, { token: otra.token, esperado: 404 });

  // Cambiar el estado: sin WhatsApp configurado el aviso no sale, pero el cambio sí se guarda
  const editado = await api('PATCH', `/modulos/${ordenes.id}/registros/${r1.id}`, { token: T, cuerpo: { datos: { estado: 'En reparación' } } });
  assert.equal(editado.datos.estado, 'En reparación');
  assert.equal(editado.datos.cliente, 'Carla Ruiz', 'editar un campo no borra los demás');
  assert.equal(editado.aviso.enviado, false);

  // El bot registra y consulta por el chat web
  const flujo = {
    nodos: [
      { id: 'i', tipo: 'inicio', datos: {} },
      { id: 'nom', tipo: 'pregunta', datos: { texto: '¿Tu nombre?', variable: 'cliente' } },
      { id: 'veh', tipo: 'pregunta', datos: { texto: '¿Qué vehículo?', variable: 'vehiculo' } },
      { id: 'g', tipo: 'registro', datos: { moduloId: ordenes.id, campos: { cliente: '{{cliente}}', equipo_o_vehiculo: '{{vehiculo}}', estado: 'Recibido' } } },
      { id: 'c', tipo: 'consulta', datos: { moduloId: ordenes.id } },
      { id: 'f', tipo: 'fin', datos: {} },
    ],
    conexiones: [
      ['i', 'siguiente', 'nom'], ['nom', 'siguiente', 'veh'], ['veh', 'siguiente', 'g'], ['g', 'siguiente', 'c'], ['c', 'encontrado', 'f'], ['c', 'nada', 'f'],
    ].map(([origen, puerto, destino]) => ({ origen, puerto, destino })),
  };
  const bot = await api('POST', '/bots', { token: T, cuerpo: { nombre: 'Recepción', flujo }, esperado: 201 });
  await api('POST', `/bots/${bot.id}/publicar`, { token: T });
  const web = await api('PUT', `/bots/${bot.id}/web`, { token: T, cuerpo: { activo: true } });
  const chat = (texto) => api('POST', `/publico/chat/${web.clave}/mensajes`, { cuerpo: { visitante: 'visitante-taller-1', texto } });
  await chat('hola');
  await chat('Luis');
  const r = await chat('Vocho 1990');
  const textos = r.respuestas.map((x) => x.texto).join('\n');
  assert.match(textos, /folio \*OS-000002\*/);
  assert.match(textos, /OS-000002\* — Cliente: Luis · Equipo o vehículo: Vocho 1990/);

  const lista = await api('GET', `/modulos/${ordenes.id}/registros`, { token: T });
  const delBot = lista.find((x) => x.folio === 'OS-000002');
  assert.equal(delBot.canal, 'web');
  assert.equal((await api('GET', '/modulos', { token: T })).find((m) => m.id === ordenes.id).registros, 2);

  // Aviso al cliente del chat web cuando el taller cambia el estado
  const desde = new Date().toISOString();
  const aviso = await api('PATCH', `/modulos/${ordenes.id}/registros/${delBot.id}`, { token: T, cuerpo: { datos: { estado: 'Listo para entregar' } } });
  assert.equal(aviso.aviso.enviado, true);
  const nuevos = await api('GET', `/publico/chat/${web.clave}/mensajes?visitante=visitante-taller-1&desde=${encodeURIComponent(desde)}`);
  assert.match(nuevos.mensajes.at(-1).texto, /Hola Luis, tu orden de servicio \*OS-000002\* ahora está: \*Listo para entregar\*/);

  // Editar campos del módulo y borrar
  await api('PATCH', `/modulos/${ventas.id}`, { token: T, cuerpo: { nombre: 'Ventas', campos: [...ventas.campos, { nombre: 'Pagado', tipo: 'sino' }] } });
  const edU = await api('POST', '/usuarios', { token: T, cuerpo: { nombre: 'Editor', email: 'ed@taller.mx', password: 'secreta123' }, esperado: 201 });
  const ed = await api('POST', '/auth/login', { cuerpo: { email: 'ed@taller.mx', password: 'secreta123' } });
  assert.ok(edU.id);
  await api('DELETE', `/modulos/${ventas.id}`, { token: ed.token, esperado: 403 });
  await api('POST', `/modulos/${ventas.id}/registros`, { token: ed.token, cuerpo: { datos: { refaccion: 'Aceite' } }, esperado: 201 });
  await api('DELETE', `/modulos/${ventas.id}`, { token: T, esperado: 204 });
  assert.equal((await api('GET', '/modulos', { token: T })).length, 1);

  console.log(`\n✔ e2e módulos OK (${pasos} peticiones)`);
} catch (e) {
  console.error('\n✘ e2e módulos FALLÓ:', e.message);
  process.exitCode = 1;
} finally {
  servidor.close();
  await (await import('mongoose')).default.disconnect();
  await mongo.stop();
  process.exit();
}
