import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotorDeFlujo } from '../src/application/services/MotorDeFlujo.js';
import { Flujo } from '../src/domain/flujo/Flujo.js';
import { normalizarCampos, validarDatos, PLANTILLAS_MODULO, valorLegible } from '../src/domain/modulos/modulos.js';

const MODULO = {
  id: 'm1',
  nombre: 'Órdenes de servicio',
  singular: 'Orden de servicio',
  prefijo: 'OS',
  campos: normalizarCampos(PLANTILLAS_MODULO.ordenes_servicio.campos).campos,
};

test('normalizarCampos: ids limpios y únicos, opciones obligatorias en "opcion"', () => {
  const { campos, errores } = normalizarCampos([
    { nombre: 'Número de placas', tipo: 'texto' },
    { nombre: 'Número de placas', tipo: 'texto' },
    { nombre: 'Estado', tipo: 'opcion', opciones: ['A', 'A', 'B'], avisar: true },
    { nombre: 'Notas', tipo: 'texto', avisar: true },
  ]);
  assert.deepEqual(errores, []);
  assert.deepEqual(campos.map((c) => c.id), ['numero_de_placas', 'numero_de_placas_2', 'estado', 'notas']);
  assert.deepEqual(campos[2].opciones, ['A', 'B']);
  assert.equal(campos[3].avisar, false, 'solo los de opción avisan');
  assert.match(normalizarCampos([{ nombre: 'X', tipo: 'opcion' }]).errores[0], /al menos una opción/);
});

test('validarDatos: convierte tipos y reporta errores legibles', () => {
  const { datos, errores } = validarDatos(MODULO.campos, {
    cliente: 'Ana',
    equipo_o_vehiculo: 'Tsuru 2010',
    presupuesto: '$1,250.50',
    estado: 'en reparación',
    telefono: '55 1234 5678',
  });
  assert.deepEqual(errores, []);
  assert.equal(datos.presupuesto, 1250.5);
  assert.equal(datos.estado, 'En reparación');
  assert.equal(datos.telefono, '5512345678');
  const malo = validarDatos(MODULO.campos, { estado: 'Volando' });
  assert.ok(malo.errores.some((e) => /Cliente: es obligatorio/.test(e.mensaje)));
  assert.ok(malo.errores.some((e) => /Estado: debe ser una de/.test(e.mensaje)));
  assert.equal(valorLegible({ tipo: 'dinero' }, 1250.5), '$1,250.50');
});

function motorConModulos() {
  const guardados = [];
  const motor = new MotorDeFlujo({
    productos: { listarActivos: async () => [], buscarPorIds: async () => [] },
    pedidos: { crear: async () => ({}) },
    clienteWebhook: { enviar: async () => ({}) },
    registros: {
      modulo: async (_e, id) => (id === 'm1' ? MODULO : null),
      guardar: async (d) => (guardados.push(d), { id: 'r1', folio: 'OS-000007' }),
      delContacto: async () => guardados.map((g, i) => ({ folio: `OS-00000${7 + i}`, datos: { ...g.datos, estado: 'En reparación' } })),
    },
  });
  return { motor, guardados };
}

test('bloques "Guardar en módulo" y "Consultar módulo": el taller registra la orden y el cliente pregunta cómo va', async () => {
  const flujo = new Flujo({
    nodos: [
      { id: 'i', tipo: 'inicio', datos: {} },
      { id: 'q', tipo: 'pregunta', datos: { texto: '¿Qué vehículo?', variable: 'vehiculo' } },
      { id: 'g', tipo: 'registro', datos: { moduloId: 'm1', campos: { cliente: '{{nombre}}', equipo_o_vehiculo: '{{vehiculo}}', estado: 'Recibido' } } },
      { id: 'c', tipo: 'consulta', datos: { moduloId: 'm1' } },
      { id: 'f', tipo: 'fin', datos: {} },
    ],
    conexiones: [
      { origen: 'i', puerto: 'siguiente', destino: 'q' },
      { origen: 'q', puerto: 'siguiente', destino: 'g' },
      { origen: 'g', puerto: 'siguiente', destino: 'c' },
      { origen: 'c', puerto: 'encontrado', destino: 'f' },
      { origen: 'c', puerto: 'nada', destino: 'f' },
    ],
  });
  assert.deepEqual(flujo.revisar().filter((p) => p.nivel === 'error'), []);
  const { motor, guardados } = motorConModulos();
  const contexto = { empresaId: 'e1', botId: 'b1', canal: 'whatsapp', moneda: 'MXN' };
  let sesion = { contacto: '5215512345678', nombre: 'Ana López', estado: 'nueva', variables: {}, carrito: [] };
  sesion = (await motor.procesar({ flujo, sesion, texto: 'hola', contexto })).sesion;
  const r = await motor.procesar({ flujo, sesion, texto: 'Tsuru 2010', contexto });
  const textos = r.respuestas.map((x) => x.texto).join('\n');
  assert.match(textos, /folio \*OS-000007\*/);
  assert.match(textos, /OS-000007\* — Cliente: Ana López · Equipo o vehículo: Tsuru 2010 · .*Estado: En reparación/);
  assert.equal(guardados[0].datos.telefono, '5215512345678', 'el teléfono se llena solo en WhatsApp');
  assert.equal(guardados[0].datos.estado, 'Recibido');

  const sinModulo = new Flujo({ nodos: [{ id: 'i', tipo: 'inicio', datos: {} }, { id: 'g', tipo: 'registro', datos: {} }], conexiones: [{ origen: 'i', puerto: 'siguiente', destino: 'g' }] });
  assert.ok(sinModulo.revisar().some((p) => /Elige el módulo/.test(p.mensaje)));
});
