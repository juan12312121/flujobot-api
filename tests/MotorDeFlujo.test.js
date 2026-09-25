import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotorDeFlujo } from '../src/application/services/MotorDeFlujo.js';
import { Flujo } from '../src/domain/flujo/Flujo.js';
import { PLANTILLAS } from '../src/domain/flujo/plantillas.js';

const PRODUCTOS = [
  { id: 'p1', nombre: 'Tacos al pastor', precio: 18, activo: true, descripcion: 'Con piña' },
  { id: 'p2', nombre: 'Agua de horchata', precio: 25, activo: true },
];

function crearMotor() {
  const pedidos = [];
  const motor = new MotorDeFlujo({
    productos: {
      listarActivos: async () => PRODUCTOS,
      buscarPorIds: async (_e, ids) => PRODUCTOS.filter((p) => ids.includes(p.id)),
    },
    pedidos: { crear: async (d) => (pedidos.push(d), { folio: 'P-000001', total: d.total }) },
    clienteWebhook: { enviar: async () => ({ respuesta: 'Cita agendada', variables: { cita: 'lunes' } }) },
  });
  return { motor, pedidos };
}

function conversacion(flujo) {
  const { motor, pedidos } = crearMotor();
  let sesion = { contacto: '5215512345678', nombre: 'Ana', estado: 'nueva', variables: {}, carrito: [] };
  const contexto = { empresaId: 'e1', botId: 'b1', nombreEmpresa: 'Taquería Don Pepe' };
  return {
    pedidos,
    get sesion() {
      return sesion;
    },
    async decir(texto) {
      const r = await motor.procesar({ flujo, sesion, texto, contexto });
      sesion = r.sesion;
      return r.respuestas.map((x) => x.texto).join('\n---\n');
    },
  };
}

test('la plantilla de tienda no tiene errores', () => {
  const problemas = new Flujo(PLANTILLAS.tienda()).revisar();
  assert.deepEqual(problemas.filter((p) => p.nivel === 'error'), []);
});

test('pedido completo por WhatsApp: menú → catálogo → carrito → datos → pedido', async () => {
  const c = conversacion(new Flujo(PLANTILLAS.tienda()));

  const saludo = await c.decir('hola');
  assert.match(saludo, /Hola Ana/);
  assert.match(saludo, /Taquería Don Pepe/);
  assert.match(saludo, /1\.\* Ver catálogo/);

  assert.match(await c.decir('9'), /No entendí/);
  const catalogo = await c.decir('catalogo');
  assert.match(catalogo, /Tacos al pastor — \$18\.00/);

  assert.match(await c.decir('1 3'), /Agregué \*3 x Tacos al pastor\*.*\$54\.00/s);
  await c.decir('1'); // agregar otro producto → vuelve al catálogo
  assert.match(await c.decir('2'), /Agua de horchata/);
  const resumen = await c.decir('Terminar mi pedido');
  assert.match(resumen, /Total: \$79\.00/);
  assert.match(resumen, /A nombre de quién/);

  await c.decir('Ana López');
  const fin = await c.decir('Av. Juárez 10');
  assert.match(fin, /P-000001/);
  assert.equal(c.pedidos.length, 1);
  assert.equal(c.pedidos[0].total, 79);
  assert.equal(c.pedidos[0].datos.direccion, 'Av. Juárez 10');
  assert.equal(c.sesion.estado, 'terminada');
  assert.deepEqual(c.sesion.carrito, []);

  assert.match(await c.decir('otra vez'), /En qué te ayudo/); // cualquier mensaje reinicia
});

test('pasar a un asesor deja al bot callado', async () => {
  const c = conversacion(new Flujo(PLANTILLAS.tienda()));
  await c.decir('hola');
  assert.match(await c.decir('3'), /asesor/);
  assert.equal(c.sesion.estado, 'humano');
  assert.equal(await c.decir('¿hola?'), '');
});

test('palabras clave de inicio, pregunta con validación, condición y webhook de n8n', async () => {
  const flujo = new Flujo({
    nodos: [
      { id: 'i', tipo: 'inicio', datos: { palabrasClave: ['cita'] } },
      { id: 'edad', tipo: 'pregunta', datos: { texto: '¿Edad?', variable: 'edad', validacion: 'numero' } },
      { id: 'cond', tipo: 'condicion', datos: { variable: 'edad', operador: 'mayor', valor: '17' } },
      { id: 'n8n', tipo: 'webhook', datos: { url: 'https://n8n.test/webhook/cita' } },
      { id: 'ok', tipo: 'mensaje', datos: { texto: 'Te esperamos el {{cita}}' } },
      { id: 'menor', tipo: 'fin', datos: { texto: 'Solo mayores de edad' } },
    ],
    conexiones: [
      { origen: 'i', puerto: 'siguiente', destino: 'edad' },
      { origen: 'edad', puerto: 'siguiente', destino: 'cond' },
      { origen: 'cond', puerto: 'si', destino: 'n8n' },
      { origen: 'cond', puerto: 'no', destino: 'menor' },
      { origen: 'n8n', puerto: 'ok', destino: 'ok' },
    ],
  });
  const c = conversacion(flujo);
  assert.equal(await c.decir('hola'), ''); // no dice "cita": el bot no contesta
  assert.equal(await c.decir('quiero una cita'), '¿Edad?');
  assert.match(await c.decir('veinte'), /no parece válido/);
  assert.equal(await c.decir('30'), 'Cita agendada\n---\nTe esperamos el lunes');

  const d = conversacion(flujo);
  await d.decir('cita');
  assert.equal(await d.decir('15'), 'Solo mayores de edad');
});

test('revisar() detecta flujos rotos', () => {
  const problemas = new Flujo({
    nodos: [
      { id: 'a', tipo: 'mensaje', datos: { texto: '' } },
      { id: 'b', tipo: 'menu', datos: { texto: 'x', opciones: [] } },
    ],
    conexiones: [{ origen: 'a', puerto: 'siguiente', destino: 'zzz' }],
  }).revisar();
  const errores = problemas.filter((p) => p.nivel === 'error').map((p) => p.mensaje);
  assert.ok(errores.includes('El flujo necesita un bloque de Inicio'));
  assert.ok(errores.includes('El mensaje está vacío'));
  assert.ok(errores.includes('El menú necesita al menos una opción'));
  assert.ok(errores.some((m) => m.includes('ya no existe')));
});

test('recorrido explicado y sugerencias para el simulador', async () => {
  const { sugerenciasPara } = await import('../src/application/services/sugerencias.js');
  const { motor } = crearMotor();
  const flujo = new Flujo(PLANTILLAS.tienda());
  const contexto = { empresaId: 'e1', botId: 'b1', nombreEmpresa: 'Taquería' };
  let sesion = { contacto: '521', nombre: 'Ana', estado: 'nueva', variables: {}, carrito: [] };

  let r = await motor.procesar({ flujo, sesion, texto: 'hola', contexto });
  assert.deepEqual(r.recorrido.map((p) => [p.nodoId, p.puerto, Boolean(p.espera)]), [['inicio', 'siguiente', false], ['menu', null, true]]);
  assert.match(r.recorrido[0].texto, /escribió "hola"/);
  assert.equal(r.respuestas[0].paso, 1, 'el menú lo produjo el paso del bloque Menú');
  assert.deepEqual(sugerenciasPara(flujo, r.sesion).map((x) => x.etiqueta), ['1. Ver catálogo y pedir', '2. Horarios y ubicación', '3. Hablar con un asesor']);
  sesion = r.sesion;

  r = await motor.procesar({ flujo, sesion, texto: 'pizza', contexto });
  assert.equal(r.recorrido[0].error, true);
  assert.match(r.recorrido[0].texto, /no es ninguna opción/);
  sesion = r.sesion;

  r = await motor.procesar({ flujo, sesion, texto: '1', contexto });
  assert.deepEqual(r.recorrido.map((p) => [p.nodoId, p.puerto]), [['menu', 'opcion:catalogo'], ['catalogo', null]]);
  assert.match(r.recorrido[0].texto, /eligió "Ver catálogo y pedir"/);
  assert.equal(sugerenciasPara(flujo, r.sesion)[0].etiqueta, '1. Tacos al pastor');
});

test('condición compara montos con formato de dinero ({{total}} = "$350.00")', async () => {
  const { cumpleCondicion } = await import('../src/domain/flujo/condiciones.js');
  const mayor300 = { variable: 'total', operador: 'mayor', valor: '300' };
  assert.equal(cumpleCondicion(mayor300, { total: '$350.00' }), true);
  assert.equal(cumpleCondicion(mayor300, { total: '$1,250.50' }), true);
  assert.equal(cumpleCondicion(mayor300, { total: '$79.00' }), false);
  assert.equal(cumpleCondicion(mayor300, { total: 'sin total' }), false);
  assert.equal(cumpleCondicion({ variable: 'x', operador: 'menor', valor: '5' }, { x: '' }), false);
});

test('Responder con IA: contesta con la información del negocio o se va por "No supo"; el menú usa la IA de respaldo', async () => {
  const preguntas = [];
  const respondedor = {
    responder: async ({ pregunta, empresa }) => {
      preguntas.push({ pregunta, conocimiento: empresa.conocimiento });
      return /tarjeta/i.test(pregunta) ? 'Sí, aceptamos tarjeta de débito y crédito.' : null;
    },
  };
  const motor = new MotorDeFlujo({
    productos: { listarActivos: async () => [], buscarPorIds: async () => [] },
    pedidos: { crear: async () => ({}) },
    citas: { ocupadas: async () => [], crear: async () => ({}) },
    clienteWebhook: { enviar: async () => ({}) },
    respondedor,
  });
  const flujo = new Flujo({
    nodos: [
      { id: 'i', tipo: 'inicio', datos: {} },
      { id: 'menu', tipo: 'menu', datos: { texto: '¿Qué necesitas?', responderConIA: true, opciones: [{ id: 'dudas', etiqueta: 'Tengo una duda' }] } },
      { id: 'ia', tipo: 'ia', datos: { texto: 'Pregúntame lo que quieras' } },
      { id: 'otra', tipo: 'fin', datos: { texto: 'Gracias' } },
      { id: 'asesor', tipo: 'humano', datos: { texto: 'Te paso con alguien' } },
    ],
    conexiones: [
      { origen: 'i', puerto: 'siguiente', destino: 'menu' },
      { origen: 'menu', puerto: 'opcion:dudas', destino: 'ia' },
      { origen: 'ia', puerto: 'respondio', destino: 'otra' },
      { origen: 'ia', puerto: 'no_sabe', destino: 'asesor' },
    ],
  });
  const contexto = { empresaId: 'e', botId: 'b', nombreEmpresa: 'Café Luna', empresa: { conocimiento: 'Aceptamos tarjeta.' } };
  let sesion = { contacto: '1', nombre: 'Ana', estado: 'nueva', variables: {}, carrito: [] };
  const decir = async (texto) => {
    const r = await motor.procesar({ flujo, sesion, texto, contexto });
    sesion = r.sesion;
    return { texto: r.respuestas.map((x) => x.texto).join('\n'), recorrido: r.recorrido };
  };

  await decir('hola');
  // En el menú, una pregunta libre la contesta la IA y el menú se vuelve a mostrar
  let r = await decir('¿aceptan tarjeta?');
  assert.match(r.texto, /aceptamos tarjeta de débito/);
  assert.match(r.texto, /¿Qué necesitas\?/);
  assert.match(r.recorrido[0].texto, /la IA lo contestó/);
  assert.equal(preguntas[0].conocimiento, 'Aceptamos tarjeta.');

  await decir('1');
  r = await decir('¿Aceptan tarjeta de crédito?');
  assert.match(r.texto, /aceptamos tarjeta/);
  assert.equal(r.recorrido[0].puerto, 'respondio');
  assert.equal(sesion.estado, 'terminada');

  await decir('hola');
  await decir('1');
  r = await decir('¿venden pasteles de boda?');
  assert.equal(r.recorrido[0].puerto, 'no_sabe');
  assert.match(r.texto, /Te paso con alguien/);
  assert.equal(sesion.variables.pregunta, '¿venden pasteles de boda?');
});
