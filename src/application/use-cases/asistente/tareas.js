import { UseCase } from '../../shared/UseCase.js';
import { ServicioExternoError } from '../../shared/errors.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';

const MAX_ACCIONES = 4;

const SISTEMA = `Eres el asistente de FlujoBot. Un negocio (pyme) quiere que, en cierto punto de la conversación
de su bot de WhatsApp, se haga una TAREA AUTOMÁTICA en n8n (avisar, guardar datos, conectar con otro sistema).
Traduces lo que pide a una lista de acciones de un menú fijo. No inventes otros tipos.

## Acciones disponibles
- correo: { "tipo": "correo", "para": "correo@destino", "asunto": "...", "mensaje": "..." }
- hoja: agrega una fila a Google Sheets. { "tipo": "hoja", "documento": "enlace de la hoja o ''", "hoja": "Hoja 1", "columnas": { "Nombre de columna": "valor" } }
- http: avisa a otro sistema por internet. { "tipo": "http", "metodo": "POST", "url": "https://... o ''", "cuerpo": { "campo": "valor" } }

## Datos que manda el bot (úsalos en textos y valores con {{ }})
{{contacto}} (teléfono o id del cliente), {{fecha}} (fecha y hora actual), {{carrito}} (productos del pedido en una línea)
y las variables de la conversación: VARIABLES

## Reglas
1. Usa solo las acciones necesarias (máximo ${MAX_ACCIONES}).
2. Si la persona no dio un dato (correo destino, enlace de la hoja, URL), deja el campo como '' y agrégalo a "faltantes".
3. Textos en español de México, claros, sin emojis. En correos, arma un mensaje útil con los datos (una línea por dato).
4. "respuesta" es lo que el bot le dirá al cliente cuando la tarea termine ('' si no debe decir nada).

## Respuesta: SOLO un JSON compacto
{ "nombre": "título corto de la tarea", "resumen": "qué hará, en 1-2 frases sencillas", "respuesta": "", "faltantes": ["..."], "acciones": [ ... ] }`;

/** Deja solo acciones conocidas y con la forma esperada. */
function limpiarAcciones(acciones) {
  const texto = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const mapa = (o) =>
    Object.fromEntries(
      Object.entries(o && typeof o === 'object' ? o : {})
        .slice(0, 20)
        .map(([k, v]) => [String(k).slice(0, 60), texto(String(v ?? ''), 500)]),
    );
  const limpias = [];
  for (const a of Array.isArray(acciones) ? acciones.slice(0, MAX_ACCIONES) : []) {
    if (a?.tipo === 'correo') limpias.push({ tipo: 'correo', para: texto(a.para, 200), asunto: texto(a.asunto, 200), mensaje: texto(a.mensaje) });
    else if (a?.tipo === 'hoja') limpias.push({ tipo: 'hoja', documento: texto(a.documento, 500), hoja: texto(a.hoja, 100) || 'Hoja 1', columnas: mapa(a.columnas) });
    else if (a?.tipo === 'http') limpias.push({ tipo: 'http', metodo: a.metodo === 'GET' ? 'GET' : 'POST', url: texto(a.url, 500), cuerpo: mapa(a.cuerpo) });
  }
  return limpias;
}

/** Variables que el flujo del bot ya conoce (las de las preguntas + las del sistema) para dárselas a la IA. */
function variablesDel(base) {
  const propias = (base?.nodos ?? []).filter((n) => n.tipo === 'pregunta' && n.datos?.variable).map((n) => `{{${n.datos.variable}}}`);
  return [...new Set([...propias, '{{folio}}', '{{total}}', '{{producto.nombre}}', '{{cita.fecha}}', '{{cita.hora}}', '{{opcion}}'])].join(', ');
}

/**
 * Asistente de tareas: "avísame por correo cuando entre un pedido" → acciones de n8n propuestas.
 * No publica nada: la persona revisa la propuesta y decide.
 */
export class GenerarTareaN8n extends UseCase {
  constructor({ ia }) {
    super();
    this.ia = ia;
  }

  async ejecutar({ descripcion, base }) {
    const r = await this.ia.completarJson({
      sistema: SISTEMA.replace('VARIABLES', variablesDel(base)),
      mensajes: [{ role: 'user', content: `La tarea que quiere el negocio: ${descripcion}` }],
      maxTokens: 2500,
      timeoutMs: 90_000,
    });
    let datos;
    try {
      const t = r.texto.replace(/<think>[\s\S]*?<\/think>/gi, '');
      datos = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    } catch {
      throw new ServicioExternoError('La IA devolvió una tarea que no se pudo leer. Intenta describirla de otra forma.');
    }
    const acciones = limpiarAcciones(datos.acciones);
    if (acciones.length === 0) throw new ServicioExternoError('La IA no encontró una acción que pueda hacer (correo, Google Sheets u otro sistema). Descríbelo con más detalle.');
    return {
      nombre: typeof datos.nombre === 'string' && datos.nombre.trim() ? datos.nombre.trim().slice(0, 80) : 'Tarea del bot',
      resumen: typeof datos.resumen === 'string' ? datos.resumen.trim() : '',
      respuesta: typeof datos.respuesta === 'string' ? datos.respuesta.trim().slice(0, 500) : '',
      faltantes: Array.isArray(datos.faltantes) ? datos.faltantes.filter((x) => typeof x === 'string').slice(0, 5) : [],
      acciones,
      modelo: r.modelo,
    };
  }
}

/**
 * Publica la tarea aceptada: arma el workflow de n8n (siempre desde la propuesta, nunca desde JSON del navegador)
 * y lo crea en n8n. Devuelve la URL que va en el bloque "Tarea en n8n".
 */
export class PublicarTareaN8n extends UseCase {
  constructor({ publicador, construirTarea }) {
    super();
    Object.assign(this, { publicador, construirTarea });
  }

  async ejecutar({ propuesta }) {
    const acciones = limpiarAcciones(propuesta.acciones);
    if (acciones.length === 0) throw new ReglaDeNegocioError('TAREA_VACIA', 'La tarea no tiene acciones');
    const { workflow, ruta, pendientes } = this.construirTarea({ ...propuesta, acciones });
    const r = await this.publicador.publicarTarea({ workflow, ruta });
    const avisos = [];
    if (r.modo === 'manual') avisos.push('n8n no está conectado a FlujoBot: descarga el workflow, impórtalo en tu n8n y actívalo. Después cambia la URL del bloque por la de tu n8n.');
    else if (!r.activo) avisos.push('El workflow quedó creado en n8n pero apagado: termina lo pendiente y actívalo desde n8n.');
    return { ...r, pendientes, avisos, workflow };
  }
}
