import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenerarFlujoConIA } from '../src/application/use-cases/asistente/GenerarFlujoConIA.js';

const empresas = { obtener: async () => ({ nombre: 'Taller Pérez', giro: 'servicios', terminos: {}, horario: { dias: [1, 2, 3], apertura: '09:00', cierre: '18:00' } }) };
const productos = { buscar: async () => [] };

/** IA de mentiras: devuelve las respuestas en orden y guarda lo que le pidieron. */
function iaFalsa(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    completarJson: async (entrada) => {
      llamadas.push(structuredClone(entrada));
      const r = respuestas.shift();
      return typeof r === 'string' ? { texto: r, cortado: false, modelo: 'falso' } : { ...r, modelo: 'falso' };
    },
  };
}

// Primer intento: sin Inicio (error). Segundo: correcto, con ids "sucios" que hay que limpiar.
const SIN_INICIO = JSON.stringify({ resumen: 'x', nodos: [{ id: 'm', tipo: 'mensaje', datos: { texto: 'hola' } }], conexiones: [] });
const CORRECTO = '```json\n' + JSON.stringify({
  resumen: 'Saluda y deja elegir entre horarios o hablar con alguien.',
  supuestos: ['Supuse que abres entre semana.'],
  nodos: [
    { id: 'inicio', tipo: 'inicio', datos: { palabrasClave: [] } },
    { id: 'Menú Principal', tipo: 'menu', datos: { texto: '¿Qué necesitas?', opciones: [{ id: 'Ver Horarios', etiqueta: 'Horarios' }, { id: 'asesor', etiqueta: 'Asesor' }] } },
    { id: 'horarios', tipo: 'mensaje', datos: { texto: 'Abrimos de 9 a 6.' } },
    { id: 'asesor', tipo: 'humano', datos: { texto: 'Te paso con alguien.' } },
    { id: 'fin', tipo: 'fin', datos: { texto: 'Gracias.' } },
    { id: 'raro', tipo: 'tipo-inventado', datos: {} },
  ],
  conexiones: [
    { origen: 'inicio', puerto: 'siguiente', destino: 'Menú Principal' },
    { origen: 'Menú Principal', puerto: 'opcion:Ver Horarios', destino: 'horarios' },
    { origen: 'Menú Principal', puerto: 'opcion:asesor', destino: 'asesor' },
    { origen: 'horarios', puerto: 'siguiente', destino: 'fin' },
    { origen: 'horarios', puerto: 'siguiente', destino: 'no-existe' },
  ],
}) + '\n```';

test('asistente: corrige errores en un segundo intento, limpia ids y acomoda el lienzo', async () => {
  const ia = iaFalsa([SIN_INICIO, CORRECTO]);
  const r = await new GenerarFlujoConIA({ ia, empresas, productos }).ejecutar({ actor: { empresaId: 'e' }, descripcion: 'Soy un taller, quiero dar horarios y pasar con un asesor' });

  assert.equal(ia.llamadas.length, 2, 'reintentó una vez');
  assert.match(ia.llamadas[1].mensajes.at(-1).content, /El flujo necesita un bloque de Inicio/);
  assert.match(ia.llamadas[0].mensajes[0].content, /Taller Pérez/);

  assert.deepEqual(r.problemas.filter((p) => p.nivel === 'error'), []);
  assert.deepEqual(r.nodos.map((n) => n.id), ['inicio', 'menu_principal', 'horarios', 'asesor', 'fin'], 'ids limpios y sin el tipo inventado');
  const menu = r.nodos.find((n) => n.id === 'menu_principal');
  assert.deepEqual(menu.datos.opciones.map((o) => o.id), ['ver_horarios', 'asesor']);
  assert.ok(r.conexiones.some((c) => c.origen === 'menu_principal' && c.puerto === 'opcion:ver_horarios' && c.destino === 'horarios'), 'la salida del menú se tradujo');
  assert.ok(!r.conexiones.some((c) => c.destino === 'no-existe'));

  // Acomodo en columnas: Inicio (0) → Menú (1) → Horarios/Asesor (2) → Fin (3)
  const x = Object.fromEntries(r.nodos.map((n) => [n.id, n.posicion.x]));
  assert.ok(x.inicio < x.menu_principal && x.menu_principal < x.horarios && x.horarios < x.fin);
  assert.equal(x.horarios, x.asesor);
  assert.equal(r.supuestos[0], 'Supuse que abres entre semana.');
});

test('asistente: si la respuesta se corta por larga, pide una versión compacta', async () => {
  const ia = iaFalsa([{ texto: '{"nodos":[{"id":"ini', cortado: true }, CORRECTO]);
  const r = await new GenerarFlujoConIA({ ia, empresas, productos }).ejecutar({ actor: { empresaId: 'e' }, descripcion: 'un bot muy completo para mi taller' });
  assert.match(ia.llamadas[1].mensajes.at(-1).content, /más compacto/);
  assert.equal(r.nodos.length, 5);
});

test('tareas de n8n: la IA solo elige acciones conocidas y el workflow sale completo', async () => {
  const { GenerarTareaN8n, PublicarTareaN8n } = await import('../src/application/use-cases/asistente/tareas.js');
  const { construirTarea } = await import('../src/infrastructure/n8n/construirTarea.js');
  const ia = iaFalsa([
    JSON.stringify({
      nombre: 'Avisar pedido',
      resumen: 'Manda un correo a ventas con cada pedido.',
      respuesta: 'Listo, ya avisamos al equipo.',
      faltantes: [],
      acciones: [
        { tipo: 'correo', para: 'ventas@taller.mx', asunto: 'Pedido {{folio}}', mensaje: 'Cliente: {{cliente}}' },
        { tipo: 'borrar_base_de_datos' },
      ],
    }),
  ]);
  const propuesta = await new GenerarTareaN8n({ ia }).ejecutar({
    descripcion: 'avísame por correo cuando entre un pedido',
    base: { nodos: [{ id: 'p', tipo: 'pregunta', datos: { variable: 'cliente' } }], conexiones: [] },
  });
  assert.match(ia.llamadas[0].sistema, /\{\{cliente\}\}/, 'le dice a la IA qué variables tiene el flujo');
  assert.deepEqual(propuesta.acciones.map((a) => a.tipo), ['correo'], 'descarta acciones inventadas');

  const publicadas = [];
  const publicador = { publicarTarea: async (x) => (publicadas.push(x), { modo: 'manual', workflowId: null, url: `https://TU-N8N/webhook/${x.ruta}`, activo: false }) };
  const r = await new PublicarTareaN8n({ publicador, construirTarea }).ejecutar({ propuesta });
  const nodos = publicadas[0].workflow.nodes.map((n) => n.type);
  assert.deepEqual(nodos, ['n8n-nodes-base.webhook', 'n8n-nodes-base.emailSend', 'n8n-nodes-base.respondToWebhook']);
  assert.match(r.url, /\/webhook\/flujobot-tarea-/);
  assert.match(r.pendientes[0], /credencial SMTP/);
  assert.match(r.avisos[0], /descarga el workflow/);
  const correo = publicadas[0].workflow.nodes[1].parameters;
  assert.equal(correo.subject, "=Pedido {{ ($('Datos del bot').item.json.body.variables?.folio ?? '') }}");
});
