import crypto from 'node:crypto';

const DISPARADOR = 'Datos del bot';
/** Donde viven los datos que manda el bloque "Tarea en n8n": { botId, contacto, nombre, variables, carrito }. */
const DATOS = `$('${DISPARADOR}').item.json.body`;

/** "{{cliente}}" → expresión de n8n que lee ese dato de lo que mandó el bot. */
function expresionDe(variable) {
  const v = variable.trim();
  if (v === 'contacto' || v === 'telefono') return `${DATOS}.contacto`;
  if (v === 'nombre_whatsapp') return `${DATOS}.nombre`;
  if (v === 'carrito') return `(${DATOS}.carrito ?? []).map(i => i.cantidad + ' x ' + i.nombre).join(', ')`;
  if (v === 'fecha') return `$now.setZone('America/Mexico_City').toFormat('yyyy-MM-dd HH:mm')`;
  const ruta = v
    .split('.')
    .filter((p) => /^[\w]+$/.test(p))
    .map((p) => `?.${p}`)
    .join('');
  return `(${DATOS}.variables${ruta} ?? '')`;
}

/** Texto con {{variables}} → valor de parámetro de n8n ("=Hola {{ expresión }}"). */
function textoN8n(plantilla = '') {
  const t = String(plantilla);
  if (!t.includes('{{')) return t;
  return '=' + t.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, v) => `{{ ${expresionDe(v)} }}`);
}

/** Texto con {{variables}} → expresión JavaScript (para armar JSON dentro de n8n). */
function expresionJs(plantilla = '') {
  const partes = String(plantilla).split(/\{\{\s*([\w.]+)\s*\}\}/g);
  const js = partes.map((p, i) => (i % 2 ? `String(${expresionDe(p)})` : JSON.stringify(p))).filter((p) => p !== '""');
  return js.length ? js.join(' + ') : '""';
}

const uuid = () => crypto.randomUUID();

/** Cada acción del asistente → nodo de n8n (sin credenciales: esas las elige la persona en n8n). */
const CONSTRUCTORES = {
  correo: (a) => ({
    nombre: 'Enviar correo',
    nodo: {
      type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1,
      parameters: { fromEmail: '', toEmail: a.para ?? '', subject: textoN8n(a.asunto), emailFormat: 'text', text: textoN8n(a.mensaje), options: {} },
    },
    pendiente: 'En el nodo "Enviar correo": elige tu cuenta de correo (credencial SMTP) y escribe el remitente.',
  }),
  hoja: (a) => {
    const columnas = Object.keys(a.columnas ?? {});
    return {
      nombre: 'Agregar fila en Google Sheets',
      nodo: {
        type: 'n8n-nodes-base.googleSheets',
        typeVersion: 4.5,
        parameters: {
          operation: 'append',
          documentId: { __rl: true, mode: 'url', value: a.documento ?? '' },
          sheetName: { __rl: true, mode: 'name', value: a.hoja || 'Hoja 1' },
          columns: {
            mappingMode: 'defineBelow',
            value: Object.fromEntries(columnas.map((c) => [c, textoN8n(a.columnas[c])])),
            matchingColumns: [],
            schema: columnas.map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })),
          },
          options: {},
        },
      },
      pendiente: `En el nodo "Agregar fila en Google Sheets": conecta tu cuenta de Google${a.documento ? '' : ' y pega el enlace de la hoja'}. La hoja debe tener las columnas ${columnas.join(', ')}.`,
    };
  },
  http: (a) => ({
    nombre: 'Avisar a otro sistema',
    nodo: {
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      parameters: {
        method: a.metodo === 'GET' ? 'GET' : 'POST',
        url: a.url ?? '',
        sendBody: a.metodo !== 'GET',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ ${Object.entries(a.cuerpo ?? {})
          .map(([k, v]) => `${JSON.stringify(k)}: ${expresionJs(v)}`)
          .join(', ')} }) }}`,
        options: {},
      },
    },
    pendiente: a.url ? null : 'En el nodo "Avisar a otro sistema": escribe la dirección (URL) del sistema.',
  }),
};

/**
 * Arma el workflow de n8n de una "Tarea en n8n" a partir de lo que propuso el asistente:
 *
 *   [Datos del bot] → acción 1 → acción 2 … → [Responder al bot]
 *
 * El bot le manda { contacto, nombre, variables, carrito }; al final n8n responde
 * { respuesta } y el bot lo dice al cliente. Devuelve también lo que la persona debe terminar en n8n.
 *
 * @param {{ nombre: string, respuesta?: string, acciones: object[] }} propuesta
 */
export function construirTarea(propuesta) {
  const ruta = `flujobot-tarea-${crypto.randomBytes(5).toString('hex')}`;
  const nodos = [
    {
      id: uuid(),
      name: DISPARADOR,
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: uuid(),
      parameters: { httpMethod: 'POST', path: ruta, responseMode: 'responseNode', options: {} },
    },
  ];
  const pendientes = [];
  const nombres = new Map();
  for (const accion of propuesta.acciones) {
    const hecho = CONSTRUCTORES[accion.tipo]?.(accion);
    if (!hecho) continue;
    // Nombres únicos en n8n: "Enviar correo", "Enviar correo 2"...
    const veces = (nombres.get(hecho.nombre) ?? 0) + 1;
    nombres.set(hecho.nombre, veces);
    const name = veces > 1 ? `${hecho.nombre} ${veces}` : hecho.nombre;
    nodos.push({ id: uuid(), name, position: [nodos.length * 260, 0], ...hecho.nodo });
    if (hecho.pendiente) pendientes.push(hecho.pendiente.replace(`"${hecho.nombre}"`, `"${name}"`));
  }
  nodos.push({
    id: uuid(),
    name: 'Responder al bot',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [nodos.length * 260, 0],
    parameters: { respondWith: 'json', responseBody: `={{ JSON.stringify({ respuesta: ${expresionJs(propuesta.respuesta ?? '')} }) }}`, options: {} },
  });

  const connections = {};
  for (let i = 0; i < nodos.length - 1; i++) connections[nodos[i].name] = { main: [[{ node: nodos[i + 1].name, type: 'main', index: 0 }]] };
  return {
    ruta,
    pendientes,
    workflow: { name: `FlujoBot tarea — ${propuesta.nombre}`.slice(0, 120), nodes: nodos, connections, settings: { executionOrder: 'v1' } },
  };
}
