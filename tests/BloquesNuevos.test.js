import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotorDeFlujo } from '../src/application/services/MotorDeFlujo.js';
import { Flujo } from '../src/domain/flujo/Flujo.js';
import { PLANTILLAS } from '../src/domain/flujo/plantillas.js';

const PRODUCTOS = [{ id: 'p1', nombre: 'Tacos al pastor', precio: 18, activo: true }];

function crearMotor({ pedidosPrevios = [], citasPrevias = [], link = 'https://pago.ejemplo/abc' } = {}) {
  const creados = [];
  let reloj = new Date('2030-03-10T15:00:00Z');
  const motor = new MotorDeFlujo({
    productos: { listarActivos: async () => PRODUCTOS, buscarPorIds: async (_e, ids) => PRODUCTOS.filter((p) => ids.includes(p.id)) },
    pedidos: {
      crear: async (d) => (creados.push(d), { id: 'ped1', folio: 'P-000009', total: d.total }),
      delContacto: async () => pedidosPrevios,
    },
    citas: { proximasDelContacto: async () => citasPrevias },
    clienteWebhook: { enviar: async () => ({}) },
    cobros: { link: async () => link },
    reloj: () => reloj,
  });
  return { motor, creados, avanzar: (min) => (reloj = new Date(reloj.getTime() + min * 60_000)) };
}

function charla(flujo, opciones = {}, canal = 'whatsapp') {
  const m = crearMotor(opciones);
  let sesion = { contacto: '5215512345678', nombre: 'Ana López', estado: 'nueva', variables: {}, carrito: [] };
  const contexto = { empresaId: 'e1', botId: 'b1', canal, nombreEmpresa: 'Taquería', empresa: { zonaHoraria: 'America/Mexico_City', terminos: {} } };
  let ultimo;
  return {
    ...m,
    get sesion() {
      return sesion;
    },
    get ultimo() {
      return ultimo;
    },
    async decir(texto) {
      ultimo = await m.motor.procesar({ flujo, sesion, texto, contexto });
      sesion = ultimo.sesion;
      return ultimo.respuestas.map((x) => x.texto).join('\n---\n');
    },
    async reanudar(token) {
      ultimo = await m.motor.reanudar({ flujo, sesion, contexto, token });
      sesion = ultimo.sesion;
      return ultimo;
    },
  };
}

const flujo = (nodos, conexiones) => new Flujo({ nodos: [{ id: 'i', tipo: 'inicio', datos: {} }, ...nodos], conexiones });
const flecha = (origen, puerto, destino) => ({ origen, puerto, destino });

test('los bloques nuevos pasan la revisión del flujo', () => {
  const f = flujo(
    [
      { id: 'e', tipo: 'estado', datos: {} },
      { id: 'w', tipo: 'esperar', datos: { minutos: 120 } },
      { id: 'q', tipo: 'encuesta', datos: {} },
      { id: 'p', tipo: 'permiso', datos: {} },
      { id: 'f', tipo: 'fin', datos: {} },
    ],
    [flecha('i', 'siguiente', 'e'), flecha('e', 'encontrado', 'w'), flecha('e', 'nada', 'w'), flecha('w', 'respondio', 'q'), flecha('w', 'sin_respuesta', 'q'), flecha('q', 'buena', 'p'), flecha('q', 'mala', 'p'), flecha('p', 'acepto', 'f'), flecha('p', 'no_acepto', 'f')],
  );
  assert.deepEqual(f.revisar(), []);
  const mal = flujo([{ id: 'w', tipo: 'esperar', datos: { minutos: 0 } }], [flecha('i', 'siguiente', 'w')]);
  assert.ok(mal.revisar().some((p) => p.nivel === 'error' && /tiempo de espera/.test(p.mensaje)));
});

test('"¿cómo va mi pedido?": el bloque Consultar muestra pedidos y citas del cliente', async () => {
  const f = flujo(
    [
      { id: 'e', tipo: 'estado', datos: {} },
      { id: 'si', tipo: 'fin', datos: { texto: '¿Algo más?' } },
      { id: 'no', tipo: 'fin', datos: {} },
    ],
    [flecha('i', 'siguiente', 'e'), flecha('e', 'encontrado', 'si'), flecha('e', 'nada', 'no')],
  );
  const c = charla(f, {
    pedidosPrevios: [{ folio: 'P-000003', estado: 'enviado', total: 250, pago: { estado: 'pagado' } }],
    citasPrevias: [{ folio: 'C-000002', inicio: new Date('2030-03-12T17:00:00Z'), estado: 'confirmada', servicio: 'Corte' }],
  });
  const r = await c.decir('mi pedido');
  assert.match(r, /P-000003\* — En camino — \$250\.00 \(pagado\)/);
  assert.match(r, /C-000002\* — .*a las 11:00 \(Corte\) — Confirmada/);
  assert.match(r, /¿Algo más\?/);
  assert.equal(c.sesion.variables.ultimoPedido.estado, 'En camino');

  const vacio = charla(f);
  assert.match(await vacio.decir('mi pedido'), /No encontré pedidos ni citas/);
  assert.equal(vacio.ultimo.recorrido.at(-2).puerto, 'nada');
});

test('Esperar: si contesta sigue por "Respondió"; si no, el Programador lo reanuda por "No respondió"', async () => {
  const f = flujo(
    [
      { id: 'w', tipo: 'esperar', datos: { minutos: 120, texto: '¿Te aparto tu lugar?' } },
      { id: 'ok', tipo: 'fin', datos: { texto: 'Perfecto: {{respuesta}}' } },
      { id: 'nada', tipo: 'fin', datos: { texto: '¿Sigues ahí? Aquí estamos.' } },
    ],
    [flecha('i', 'siguiente', 'w'), flecha('w', 'respondio', 'ok'), flecha('w', 'sin_respuesta', 'nada')],
  );
  const c = charla(f);
  assert.match(await c.decir('hola'), /Te aparto tu lugar/);
  const efecto = c.ultimo.efectos.find((e) => e.tipo === 'esperar');
  assert.equal(efecto.minutos, 120);
  assert.match(await c.decir('sí, porfa'), /Perfecto: sí, porfa/);
  const tarde = await c.reanudar(efecto.token);
  assert.equal(tarde.vigente, false, 'ya contestó: la espera vieja no hace nada');

  const d = charla(f);
  await d.decir('hola');
  const token = d.ultimo.efectos[0].token;
  assert.equal((await d.reanudar('otro-token')).vigente, false);
  const r = await d.reanudar(token);
  assert.equal(r.vigente, true);
  assert.match(r.respuestas[0].texto, /Sigues ahí/);
  assert.equal(d.sesion.estado, 'terminada');

  // La conversación no "vence" durante la espera: contestar a las 90 min sigue contando
  const e = charla(f);
  await e.decir('hola');
  e.avanzar(90);
  assert.match(await e.decir('ya volví'), /Perfecto: ya volví/);

  // En el simulador, /pasar simula que no contestó
  const s = charla(f, {}, 'simulador');
  await s.decir('hola');
  assert.match(await s.decir('/pasar'), /Sigues ahí/);
});

test('Encuesta: valida del 1 al 5, pide comentario y separa buenas de malas', async () => {
  const f = flujo(
    [
      { id: 'q', tipo: 'encuesta', datos: { pedirComentario: true, textoMala: 'Lo sentimos, te paso con alguien.' } },
      { id: 'b', tipo: 'fin', datos: { texto: 'buena' } },
      { id: 'm', tipo: 'fin', datos: { texto: 'mala' } },
    ],
    [flecha('i', 'siguiente', 'q'), flecha('q', 'buena', 'b'), flecha('q', 'mala', 'm')],
  );
  const c = charla(f);
  assert.match(await c.decir('hola'), /del \*1\* \(malo\) al \*5\*/);
  assert.match(await c.decir('10'), /del 1 al 5/);
  assert.match(await c.decir('2'), /comentario/);
  const r = await c.decir('Tardaron mucho');
  assert.match(r, /Lo sentimos/);
  assert.match(r, /mala/);
  assert.deepEqual(c.ultimo.efectos, [{ tipo: 'encuesta', calificacion: 2, comentario: 'Tardaron mucho' }]);

  const d = charla(f);
  await d.decir('hola');
  await d.decir('5');
  assert.match(await d.decir('no'), /buena/);
  assert.equal(d.ultimo.efectos[0].comentario, '');
});

test('Pedir permiso para promociones', async () => {
  const f = flujo(
    [
      { id: 'p', tipo: 'permiso', datos: {} },
      { id: 'a', tipo: 'fin', datos: {} },
      { id: 'n', tipo: 'fin', datos: { texto: 'Va, no te molestamos' } },
    ],
    [flecha('i', 'siguiente', 'p'), flecha('p', 'acepto', 'a'), flecha('p', 'no_acepto', 'n')],
  );
  const c = charla(f);
  assert.match(await c.decir('hola'), /1\.\* Sí, quiero recibirlas/);
  assert.match(await c.decir('quizá'), /Responde \*1\*/);
  assert.match(await c.decir('1'), /BAJA/);
  assert.deepEqual(c.ultimo.efectos, [{ tipo: 'permiso', acepta: true }]);
  const d = charla(f);
  await d.decir('hola');
  assert.match(await d.decir('no'), /no te molestamos/);
  assert.deepEqual(d.ultimo.efectos, [{ tipo: 'permiso', acepta: false }]);
});

test('Pedido con cobro: manda el link de pago y avisa la compra', async () => {
  const base = PLANTILLAS.tienda();
  for (const n of base.nodos) if (n.tipo === 'pedido') n.datos = { ...n.datos, texto: '', cobrar: true };
  const c = charla(new Flujo(base));
  for (const t of ['hola', '1', '1 2', '2', 'Ana López']) await c.decir(t);
  const fin = await c.decir('Av. Juárez 10');
  assert.match(fin, /Págalo aquí: https:\/\/pago\.ejemplo\/abc/);
  assert.equal(c.sesion.variables.linkPago, 'https://pago.ejemplo/abc');
  assert.ok(c.ultimo.efectos.some((e) => e.tipo === 'compra' && e.folio === 'P-000009'));

  const sinCobros = charla(new Flujo(base), { link: null });
  for (const t of ['hola', '1', '1 2', '2', 'Ana López']) await sinCobros.decir(t);
  const r = await sinCobros.decir('Av. Juárez 10');
  assert.match(r, /quedó registrado por \$36\.00\. Te contactaremos/);
  assert.ok(sinCobros.ultimo.recorrido.some((p) => /No se pudo generar el link/.test(p.texto)));
});

test('recordar: vuelve a mostrar la pregunta donde se quedó (carrito abandonado)', async () => {
  const c = charla(new Flujo(PLANTILLAS.tienda()));
  await c.decir('hola');
  await c.decir('1');
  await c.decir('1 2');
  const r = await c.motor.recordar({ flujo: new Flujo(PLANTILLAS.tienda()), sesion: c.sesion, contexto: { empresaId: 'e1', botId: 'b1', canal: 'whatsapp' } });
  assert.match(r.respuestas[0].texto, /algo más/i);
  assert.equal(r.recorrido.length, 0);
});
