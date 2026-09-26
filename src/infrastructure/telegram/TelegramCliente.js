import { ServicioExternoError } from '../../application/shared/errors.js';

const API = 'https://api.telegram.org';

/**
 * Telegram Bot API. Cada bot de FlujoBot usa el token que su dueño sacó de @BotFather:
 * Telegram manda los mensajes a /publico/telegram/:botId y aquí se contesta directo (sin n8n).
 */
export class TelegramCliente {
  async #llamar(token, metodo, cuerpo) {
    const r = await fetch(`${API}/bot${token}/${metodo}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
    const datos = await r.json().catch(() => ({}));
    if (!datos.ok) {
      const e = new ServicioExternoError(`Telegram: ${datos.description ?? r.status}`);
      e.status = r.status;
      throw e;
    }
    return datos.result;
  }

  /** Valida el token y devuelve el @usuario del bot. */
  async quienSoy(token) {
    const yo = await this.#llamar(token, 'getMe');
    return { usuario: yo.username, nombre: yo.first_name };
  }

  async configurarWebhook(token, url, secreto) {
    await this.#llamar(token, 'setWebhook', { url, secret_token: secreto, allowed_updates: ['message'], drop_pending_updates: true });
  }

  async quitarWebhook(token) {
    await this.#llamar(token, 'deleteWebhook', {}).catch(() => {});
  }

  /** Telegram usa *negritas* y _cursivas_ como WhatsApp (modo Markdown); si el texto no lo respeta, se manda plano. */
  async enviarTexto(token, chatId, texto) {
    try {
      await this.#llamar(token, 'sendMessage', { chat_id: chatId, text: texto, parse_mode: 'Markdown' });
    } catch (e) {
      if (e.status !== 400) throw e;
      await this.#llamar(token, 'sendMessage', { chat_id: chatId, text: texto });
    }
  }

  async enviarImagen(token, chatId, url, texto = '') {
    await this.#llamar(token, 'sendPhoto', { chat_id: chatId, photo: url, caption: texto.slice(0, 1024) });
  }

  /** Nota de voz → bytes del audio (para transcribirla). */
  async descargarArchivo(token, fileId) {
    const archivo = await this.#llamar(token, 'getFile', { file_id: fileId });
    const r = await fetch(`${API}/file/bot${token}/${archivo.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new ServicioExternoError(`Telegram no entregó el audio (${r.status})`);
    return { datos: Buffer.from(await r.arrayBuffer()), tipo: 'audio/ogg', nombre: 'voz.ogg' };
  }
}

/** Update de Telegram → { contacto, nombre, texto } | { contacto, nombre, audio } | { ignorar }. */
export function normalizarTelegram(update) {
  const m = update?.message;
  if (!m?.chat?.id) return { ignorar: 'sin mensaje' };
  if (m.chat.type !== 'private') return { ignorar: 'grupo' };
  const contacto = String(m.chat.id);
  const nombre = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ');
  if (typeof m.text === 'string') return { contacto, nombre, texto: m.text === '/start' ? 'hola' : m.text };
  if (m.voice?.file_id || m.audio?.file_id) return { contacto, nombre, audio: { fileId: m.voice?.file_id ?? m.audio.file_id } };
  if (typeof m.caption === 'string') return { contacto, nombre, texto: m.caption };
  return { ignorar: 'tipo de mensaje no soportado' };
}
