import { dinero } from '../../domain/flujo/texto.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** Una respuesta de chat no puede tardar como generar un flujo: si la IA no contesta a tiempo, el bot sigue sin ella. */
const ESPERA_MS = 30_000;
const INTENTOS = 2;

function leerJson(texto) {
  try {
    const limpio = texto.replace(/<think>[\s\S]*?<\/think>/gi, '');
    return JSON.parse(limpio.slice(limpio.indexOf('{'), limpio.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

/**
 * Contesta preguntas libres del cliente ("¿aceptan tarjeta?") usando SOLO la información que el negocio
 * escribió en "Mi empresa", su catálogo y su horario. Si no lo sabe (o la IA falla/tarda), devuelve null
 * y el flujo sigue por la salida "No supo" — nunca inventa.
 */
export class RespondedorIA {
  /** @param {{ ia: import('../../infrastructure/ia/OpenRouterCliente.js').OpenRouterCliente, productos: object }} deps */
  constructor({ ia, productos }) {
    this.ia = ia;
    this.productos = productos;
  }

  get disponible() {
    return Boolean(this.ia?.configurado);
  }

  /**
   * @param {{ pregunta: string, empresaId: string, empresa: { nombre?: string, conocimiento?: string, horario?: object, moneda?: string } }} entrada
   * @returns {Promise<string | null>}
   */
  async responder({ pregunta, empresaId, empresa }) {
    if (!this.disponible || !pregunta?.trim()) return null;
    const catalogo = await this.productos.listarActivos(empresaId).catch(() => []);
    const info = [
      empresa.conocimiento?.trim() ? `Información del negocio:\n${empresa.conocimiento.trim()}` : '',
      catalogo.length
        ? `Catálogo:\n${catalogo
            .map((p) => `- ${p.nombre}${p.precio > 0 ? `: ${p.precioDesde ? 'desde ' : ''}${dinero(p.precio, empresa.moneda)}` : ''}${p.duracionMin ? ` (${p.duracionMin} min)` : ''}${p.descripcion ? `. ${p.descripcion}` : ''}`)
            .join('\n')}`
        : '',
      empresa.horario ? `Horario: ${empresa.horario.dias.map((d) => DIAS[d]).join(', ')} de ${empresa.horario.apertura} a ${empresa.horario.cierre}.` : '',
    ].filter(Boolean);
    if (info.length === 0) return null;

    const sistema = `Eres el asistente de WhatsApp de "${empresa.nombre ?? 'el negocio'}". Respondes preguntas de clientes.
Usa SOLO la información que te dan. Si no alcanza para responder con seguridad, NO inventes: marca que no sabes.
Responde en español de México, cordial y breve (máximo 3 frases), sin emojis. Puedes usar *negritas* de WhatsApp.
Responde SOLO un JSON: {"sabe": true, "respuesta": "..."} o {"sabe": false}`;
    const limite = Date.now() + ESPERA_MS;
    // Los modelos gratuitos a veces devuelven "{}" o texto roto: eso no es un "no sé", se reintenta una vez
    for (let intento = 1; intento <= INTENTOS && Date.now() < limite - 2_000; intento++) {
      try {
        const r = await this.ia.completarJson({
          sistema,
          mensajes: [{ role: 'user', content: `${info.join('\n\n')}\n\nPregunta del cliente: ${pregunta.trim().slice(0, 500)}` }],
          maxTokens: 800,
          timeoutMs: limite - Date.now(),
        });
        const datos = leerJson(r.texto);
        if (typeof datos?.sabe !== 'boolean') continue;
        return datos.sabe && typeof datos.respuesta === 'string' && datos.respuesta.trim() ? datos.respuesta.trim().slice(0, 900) : null;
      } catch (e) {
        console.warn('Responder con IA no respondió:', e.message);
        return null;
      }
    }
    return null;
  }
}
