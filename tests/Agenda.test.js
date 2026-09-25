import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotorDeFlujo } from '../src/application/services/MotorDeFlujo.js';
import { Flujo } from '../src/domain/flujo/Flujo.js';
import { PLANTILLAS } from '../src/domain/flujo/plantillas.js';
import { diasDisponibles, espaciosDelDia, localAUtc, aLocal } from '../src/domain/agenda/disponibilidad.js';

const ZONA = 'America/Mexico_City';
// Lunes 28 sep 2026, 10:05 en CDMX (UTC-6)
const AHORA = new Date('2026-09-28T16:05:00Z');
const HORARIO = { dias: [1, 2, 3, 4, 5, 6], apertura: '09:00', cierre: '13:00', intervaloMin: 60, capacidad: 1 };

test('zona horaria: 10:00 en CDMX son las 16:00 UTC y de regreso', () => {
  assert.equal(localAUtc('2026-09-28', '10:00', ZONA).toISOString(), '2026-09-28T16:00:00.000Z');
  assert.deepEqual(aLocal(new Date('2026-09-28T16:00:00Z'), ZONA), { fecha: '2026-09-28', hora: '10:00' });
});

test('espacios: respeta margen de 30 min, citas ocupadas, capacidad y domingo cerrado', () => {
  const ocupadas = [{ inicio: localAUtc('2026-09-29', '10:00', ZONA), fin: localAUtc('2026-09-29', '11:00', ZONA) }];
  // Hoy a las 10:05: 09 y 10 ya pasaron, 11 y 12 libres
  assert.deepEqual(espaciosDelDia({ horario: HORARIO, zona: ZONA, fecha: '2026-09-28', ahora: AHORA, ocupadas: [] }).map((e) => e.hora), ['11:00', '12:00']);
  // Mañana: la de las 10:00 está ocupada
  assert.deepEqual(espaciosDelDia({ horario: HORARIO, zona: ZONA, fecha: '2026-09-29', ahora: AHORA, ocupadas }).map((e) => e.hora), ['09:00', '11:00', '12:00']);
  // Con capacidad 2 sí cabe
  assert.equal(espaciosDelDia({ horario: { ...HORARIO, capacidad: 2 }, zona: ZONA, fecha: '2026-09-29', ahora: AHORA, ocupadas }).length, 4);
  // Domingo 4 de octubre cerrado
  assert.equal(espaciosDelDia({ horario: HORARIO, zona: ZONA, fecha: '2026-10-04', ahora: AHORA, ocupadas: [] }).length, 0);
  const dias = diasDisponibles({ horario: HORARIO, zona: ZONA, ahora: AHORA, ocupadas: [], maxDias: 7 });
  assert.equal(dias[0].nombre, 'lunes, 28 de septiembre');
  assert.ok(!dias.some((d) => d.fecha === '2026-10-04'));
});

test('plantillas de todos los giros sin errores', () => {
  for (const [nombre, crear] of Object.entries(PLANTILLAS)) {
    const errores = new Flujo(crear()).revisar().filter((p) => p.nivel === 'error');
    assert.deepEqual(errores, [], `plantilla ${nombre}`);
  }
});

test('salón de belleza: elegir servicio → nombre → día → hora → cita creada', async () => {
  const servicios = [
    { id: 's1', nombre: 'Corte de cabello', precio: 150, precioDesde: true, tipo: 'servicio', duracionMin: 60, activo: true },
    { id: 's2', nombre: 'Manicure', precio: 200, tipo: 'servicio', duracionMin: 60, activo: true },
  ];
  const citas = [];
  const motor = new MotorDeFlujo({
    productos: { listarActivos: async () => servicios, buscarPorIds: async (_e, ids) => servicios.filter((s) => ids.includes(s.id)) },
    pedidos: { crear: async () => ({ folio: 'P-1', total: 0 }) },
    citas: {
      ocupadas: async () => citas.map((c) => ({ inicio: c.inicio, fin: c.fin })),
      crear: async (d) => (citas.push(d), { folio: `C-00000${citas.length}` }),
    },
    clienteWebhook: { enviar: async () => ({}) },
    reloj: () => AHORA,
  });
  const flujo = new Flujo(PLANTILLAS.citas());
  const contexto = { empresaId: 'e', botId: 'b', nombreEmpresa: 'Estética Lupita', empresa: { horario: HORARIO, zonaHoraria: ZONA, terminos: { cita: 'Cita' } } };
  let sesion = { contacto: '521', nombre: 'Rosa', estado: 'nueva', variables: {}, carrito: [] };
  const decir = async (texto) => {
    const r = await motor.procesar({ flujo, sesion, texto, contexto });
    sesion = r.sesion;
    return r.respuestas.map((x) => x.texto).join('\n---\n');
  };

  assert.match(await decir('hola'), /Estética Lupita/);
  assert.match(await decir('1'), /Corte de cabello \(60 min\) — desde \$150\.00/);
  assert.match(await decir('1'), /Elegiste \*Corte de cabello\*.*A nombre de quién/s);
  const dias = await decir('Rosa Pérez');
  assert.match(dias, /Qué día te acomoda, Rosa Pérez/);
  assert.match(dias, /\*1\.\* lunes, 28 de septiembre/);
  const horas = await decir('1');
  assert.match(horas, /\*1\.\* 11:00\n\*2\.\* 12:00/);
  assert.match(await decir('7'), /número de uno de los horarios/);
  const ok = await decir('1');
  assert.match(ok, /quedó para el \*lunes, 28 de septiembre\* a las \*11:00\*.*C-000001/s);
  assert.equal(citas[0].servicio, 'Corte de cabello');
  assert.equal(citas[0].nombreContacto, 'Rosa Pérez');
  assert.equal(citas[0].inicio.toISOString(), '2026-09-28T17:00:00.000Z');
  assert.equal(sesion.estado, 'terminada');

  // Otra clienta ya no ve las 11:00 de hoy
  sesion = { contacto: '522', nombre: 'Ana', estado: 'nueva', variables: {}, carrito: [] };
  await decir('hola');
  await decir('1');
  await decir('1');
  await decir('Ana');
  assert.match(await decir('1'), /\*1\.\* 12:00$/m);
});

test('prospectos: solicitud sin productos con correo validado', async () => {
  const registros = [];
  const motor = new MotorDeFlujo({
    productos: { listarActivos: async () => [], buscarPorIds: async () => [] },
    pedidos: { crear: async (d) => (registros.push(d), { folio: 'P-000001', total: d.total }) },
    citas: { ocupadas: async () => [], crear: async () => ({}) },
    clienteWebhook: { enviar: async () => ({}) },
  });
  const flujo = new Flujo(PLANTILLAS.prospectos());
  let sesion = { contacto: '523', nombre: 'Luis', estado: 'nueva', variables: {}, carrito: [] };
  const decir = async (texto) => {
    const r = await motor.procesar({ flujo, sesion, texto, contexto: { empresaId: 'e', botId: 'b', nombreEmpresa: 'Colegio' } });
    sesion = r.sesion;
    return r.respuestas.map((x) => x.texto).join('\n');
  };
  await decir('hola');
  await decir('2');
  await decir('Luis');
  assert.match(await decir('no-es-correo'), /no parece válido/);
  await decir('luis@correo.mx');
  assert.match(await decir('Llamar por la tarde'), /Registramos tu solicitud \*P-000001\*/);
  assert.equal(registros[0].total, 0);
  assert.equal(registros[0].datos.correo, 'luis@correo.mx');
});
