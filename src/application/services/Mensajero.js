/** Número para WhatsApp: solo dígitos; un número mexicano de 10 dígitos se completa con la lada 52. */
export function numeroWhatsApp(texto) {
  const d = String(texto ?? '').replace(/\D/g, '');
  return d.length === 10 ? `52${d}` : d;
}

/**
 * Manda mensajes por iniciativa del sistema (no como respuesta inmediata del motor):
 * avisos de estado, recordatorios, campañas, carritos abandonados, el asesor desde el panel
 * y las respuestas de Telegram/Messenger/Instagram (que no pasan por n8n).
 *
 * - whatsapp → Evolution API (instancia del bot)
 * - telegram → Bot API con el token del bot
 * - messenger / instagram → Graph API con el token de la página
 * - web → no hay a dónde "empujar": se guarda en el historial y el globito lo recoge al consultar
 *
 * Todo lo enviado queda en el historial de la conversación (se crea si el contacto nunca había escrito).
 */
export class Mensajero {
  constructor({ conversaciones, bots, evolution, telegram, meta, cifrador }) {
    Object.assign(this, { conversaciones, bots, evolution, telegram, meta, cifrador });
  }

  /**
   * @param {{ bot: object, canal: string, contacto: string, nombre?: string,
   *           respuestas: { tipo?: string, texto?: string, url?: string }[],
   *           de?: 'bot' | 'asesor' | 'sistema', autor?: string, cambios?: object, registrar?: boolean }} envio
   * @returns {Promise<{ ok: boolean, error?: string, conversacion?: object }>}
   */
  async enviar({ bot, canal, contacto, nombre = '', respuestas, de = 'bot', autor = '', cambios = {}, registrar = true }) {
    const lista = respuestas.filter((r) => (r.texto ?? '').trim() || r.url);
    let error;
    try {
      await this.#entregar(bot, canal, contacto, lista);
    } catch (e) {
      error = e.message;
    }
    let conversacion;
    if (registrar && lista.length) {
      const ahora = new Date();
      const mensajes = lista.map((r) => ({ de, autor, texto: r.texto ?? '', url: r.url, fecha: ahora }));
      if (error) mensajes.push({ de: 'sistema', texto: `No se pudo entregar: ${error}`, fecha: ahora });
      conversacion = await this.conversaciones.agregarMensajes({ empresaId: bot.empresaId, botId: bot.id, canal, contacto, nombre }, mensajes, cambios);
    }
    return { ok: !error, error, conversacion };
  }

  /** ¿Se le puede escribir por este canal sin que el cliente escriba primero? */
  puedeIniciar(canal) {
    if (canal === 'whatsapp') return this.evolution.configurado;
    return ['telegram', 'web'].includes(canal);
  }

  async #entregar(bot, canal, contacto, respuestas) {
    if (canal === 'web' || canal === 'simulador' || respuestas.length === 0) return;
    if (canal === 'whatsapp') {
      const numero = numeroWhatsApp(contacto);
      for (const r of respuestas) {
        if (r.url) await this.evolution.enviarImagen(bot.instancia, numero, r.url, r.texto ?? '');
        else await this.evolution.enviarTexto(bot.instancia, numero, r.texto);
      }
      return;
    }
    const conSecretos = await this.bots.conSecretos(bot.id);
    if (canal === 'telegram') {
      const token = this.cifrador.descifrar(conSecretos?.telegram?.tokenCifrado);
      if (!token) throw new Error('El bot no tiene Telegram conectado');
      for (const r of respuestas) {
        if (r.url) await this.telegram.enviarImagen(token, contacto, r.url, r.texto ?? '');
        else await this.telegram.enviarTexto(token, contacto, r.texto);
      }
      return;
    }
    if (canal === 'messenger' || canal === 'instagram') {
      const token = this.cifrador.descifrar(conSecretos?.meta?.tokenCifrado);
      if (!token) throw new Error('El bot no tiene Messenger/Instagram conectado');
      for (const r of respuestas) {
        if (r.url) await this.meta.enviarImagen(token, contacto, r.url, r.texto ?? '');
        else await this.meta.enviarTexto(token, contacto, r.texto);
      }
      return;
    }
    throw new Error(`Canal desconocido: ${canal}`);
  }
}
