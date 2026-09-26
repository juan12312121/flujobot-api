import { ServicioExternoError, NoConfiguradoError } from '../../application/shared/errors.js';

/**
 * Evolution API (v2): una instancia por bot. Aquí se administra la conexión (crear, QR, estado, webhook).
 * Las RESPUESTAS a un mensaje las manda n8n; lo que el bot manda por su cuenta (avisos, recordatorios,
 * campañas, asesor desde el panel) sale directo desde aquí.
 */
export class EvolutionCliente {
  constructor({ url, apiKey }) {
    this.url = url?.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  get configurado() {
    return Boolean(this.url && this.apiKey);
  }

  async #llamar(metodo, ruta, cuerpo) {
    if (!this.configurado) throw new NoConfiguradoError('Evolution API no está configurada (EVOLUTION_URL / EVOLUTION_API_KEY)');
    const r = await fetch(`${this.url}${ruta}`, {
      method: metodo,
      headers: { apikey: this.apiKey, 'content-type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new ServicioExternoError(`Evolution respondió ${r.status}: ${JSON.stringify(datos?.response?.message ?? datos).slice(0, 200)}`);
      e.status = r.status;
      throw e;
    }
    return datos;
  }

  async existe(instancia) {
    const lista = await this.#llamar('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`).catch((e) => {
      if (e.status === 404) return [];
      throw e;
    });
    return Array.isArray(lista) && lista.length > 0;
  }

  /** Crea la instancia si no existe y devuelve el QR para vincular el teléfono. */
  async conectar(instancia) {
    if (!(await this.existe(instancia))) {
      await this.#llamar('POST', '/instance/create', { instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true });
    }
    const r = await this.#llamar('GET', `/instance/connect/${encodeURIComponent(instancia)}`);
    return { qr: r.base64 ?? null, codigo: r.pairingCode ?? null };
  }

  /** 'open' = vinculado; 'connecting' = esperando QR; 'close' = desconectado. */
  async estado(instancia) {
    try {
      const r = await this.#llamar('GET', `/instance/connectionState/${encodeURIComponent(instancia)}`);
      return r.instance?.state ?? r.state ?? 'close';
    } catch (e) {
      if (e.status === 404) return 'close';
      throw e;
    }
  }

  async configurarWebhook(instancia, url) {
    await this.#llamar('POST', `/webhook/set/${encodeURIComponent(instancia)}`, {
      webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT'] },
    });
  }

  async enviarTexto(instancia, numero, texto) {
    await this.#llamar('POST', `/message/sendText/${encodeURIComponent(instancia)}`, { number: numero, text: texto });
  }

  async enviarImagen(instancia, numero, url, texto = '') {
    await this.#llamar('POST', `/message/sendMedia/${encodeURIComponent(instancia)}`, { number: numero, mediatype: 'image', media: url, caption: texto });
  }

  /** Nota de voz: Evolution la descifra y la entrega en base64. */
  async descargarMedia(instancia, mensaje) {
    const r = await this.#llamar('POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, { message: { key: mensaje.key }, convertToMp4: false });
    if (!r.base64) throw new ServicioExternoError('Evolution no entregó el audio');
    const tipo = (r.mimetype ?? 'audio/ogg').split(';')[0];
    return { datos: Buffer.from(r.base64, 'base64'), tipo, nombre: tipo.includes('mp4') ? 'voz.mp4' : 'voz.ogg' };
  }

  async desconectar(instancia) {
    await this.#llamar('DELETE', `/instance/logout/${encodeURIComponent(instancia)}`).catch(() => {});
  }

  async borrar(instancia) {
    await this.#llamar('DELETE', `/instance/delete/${encodeURIComponent(instancia)}`).catch(() => {});
  }
}
