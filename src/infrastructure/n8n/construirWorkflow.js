import crypto from 'node:crypto';

/**
 * Arma el workflow de n8n de UN bot. Es siempre el mismo esqueleto de 4 nodos:
 *
 *   [WhatsApp entrante] → [Motor FlujoBot] → [Separar respuestas] → [Enviar por WhatsApp]
 *     webhook de Evolution   POST a esta API     una por mensaje         Evolution sendText/sendMedia
 *
 * La lógica que el usuario dibujó (menús, catálogo, preguntas...) la ejecuta el motor de la API,
 * que guarda el estado de cada conversación en Mongo. Así cambiar el flujo en el editor y
 * volver a publicar no obliga a reconstruir el workflow: n8n solo transporta mensajes y
 * las tareas propias de cada empresa se conectan con el bloque "Tarea en n8n".
 *
 * @param {{ bot: { id: string, nombre: string, instancia: string, tokenMotor: string },
 *           apiUrl: string, evolutionUrl?: string, credencialEvolutionId?: string }} opciones
 */
export function construirWorkflow({ bot, apiUrl, evolutionUrl, credencialEvolutionId }) {
  const ruta = `flujobot/${bot.id}`;
  const evo = (evolutionUrl ?? 'https://TU-EVOLUTION').replace(/\/$/, '');
  const instancia = encodeURIComponent(bot.instancia);
  // webhookId estable por bot: n8n registra el webhook de producción con él
  const webhookId = crypto.createHash('sha1').update(`flujobot:${bot.id}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5');

  const credencialEvolution = {
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
  };

  return {
    name: `FlujoBot — ${bot.nombre}`,
    nodes: [
      {
        id: uuid(bot.id, 'webhook'),
        name: 'WhatsApp entrante',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId,
        parameters: { httpMethod: 'POST', path: ruta, responseMode: 'onReceived', options: {} },
      },
      {
        id: uuid(bot.id, 'motor'),
        name: 'Motor FlujoBot',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          method: 'POST',
          url: `${apiUrl.replace(/\/$/, '')}/motor/bots/${bot.id}/mensajes`,
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'X-Bot-Token', value: bot.tokenMotor }] },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.body) }}',
          // Hasta 60 s: el bloque "Responder con IA" (modelos gratuitos) puede tardar
          options: { timeout: 60000 },
        },
      },
      {
        id: uuid(bot.id, 'separar'),
        name: 'Separar respuestas',
        type: 'n8n-nodes-base.splitOut',
        typeVersion: 1,
        position: [520, 0],
        parameters: { fieldToSplitOut: 'data.respuestas', options: {} },
      },
      {
        id: uuid(bot.id, 'enviar'),
        name: 'Enviar por WhatsApp',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [780, 0],
        parameters: {
          method: 'POST',
          url: `={{ $json.tipo === 'imagen' ? '${evo}/message/sendMedia/${instancia}' : '${evo}/message/sendText/${instancia}' }}`,
          ...credencialEvolution,
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            "={{ JSON.stringify($json.tipo === 'imagen' ? { number: $json.numero, mediatype: 'image', media: $json.url, caption: $json.texto } : { number: $json.numero, text: $json.texto }) }}",
          // Uno por uno y con pausa: WhatsApp entrega en orden y se ve natural
          options: { batching: { batch: { batchSize: 1, batchInterval: 900 } } },
        },
        credentials: credencialEvolutionId ? { httpHeaderAuth: { id: credencialEvolutionId, name: 'Evolution API' } } : undefined,
      },
    ],
    connections: {
      'WhatsApp entrante': { main: [[{ node: 'Motor FlujoBot', type: 'main', index: 0 }]] },
      'Motor FlujoBot': { main: [[{ node: 'Separar respuestas', type: 'main', index: 0 }]] },
      'Separar respuestas': { main: [[{ node: 'Enviar por WhatsApp', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

function uuid(botId, nombre) {
  const h = crypto.createHash('sha1').update(`${botId}:${nombre}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
