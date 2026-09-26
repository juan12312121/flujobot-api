import { ServicioExternoError } from '../../application/shared/errors.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Messenger e Instagram (Graph API). FlujoBot tiene UNA app de Meta (META_APP_SECRET / META_VERIFY_TOKEN);
 * cada negocio conecta su página con un token de página que se guarda cifrado en su bot.
 *
 * Ojo: Meta solo deja contestar dentro de las 24 h después del último mensaje del cliente
 * (por eso las campañas no salen por estos canales).
 */
export class MetaCliente {
  async #llamar(token, ruta, cuerpo, metodo = 'POST') {
    const r = await fetch(`${GRAPH}${ruta}${ruta.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok || datos.error) throw new ServicioExternoError(`Meta: ${datos.error?.message ?? r.status}`);
    return datos;
  }

  /** Valida el token de página y devuelve la página y su Instagram ligado (si tiene). */
  async pagina(token) {
    const p = await this.#llamar(token, '/me?fields=id,name,instagram_business_account', null, 'GET');
    return { paginaId: p.id, nombre: p.name, instagramId: p.instagram_business_account?.id ?? '' };
  }

  /** Suscribe la página a los mensajes de la app (Messenger; Instagram usa la misma suscripción). */
  async suscribir(token, paginaId) {
    await this.#llamar(token, `/${paginaId}/subscribed_apps?subscribed_fields=messages`, {});
  }

  async enviarTexto(token, destinatario, texto) {
    await this.#llamar(token, '/me/messages', { recipient: { id: destinatario }, messaging_type: 'RESPONSE', message: { text: texto.slice(0, 2000) } });
  }

  async enviarImagen(token, destinatario, url, texto = '') {
    await this.#llamar(token, '/me/messages', {
      recipient: { id: destinatario },
      messaging_type: 'RESPONSE',
      message: { attachment: { type: 'image', payload: { url, is_reusable: true } } },
    });
    if (texto) await this.enviarTexto(token, destinatario, texto);
  }

  async descargar(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new ServicioExternoError(`Meta no entregó el audio (${r.status})`);
    return { datos: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') ?? 'audio/mp4', nombre: 'voz.mp4' };
  }
}

/**
 * Evento del webhook de Meta → lista de mensajes { cuenta, canal, contacto, texto | audio }.
 * `cuenta` es la página (Messenger) o la cuenta de Instagram que recibió el mensaje.
 */
export function normalizarMeta(cuerpo) {
  const canal = cuerpo?.object === 'instagram' ? 'instagram' : cuerpo?.object === 'page' ? 'messenger' : null;
  if (!canal) return [];
  const salida = [];
  for (const entrada of cuerpo.entry ?? []) {
    for (const ev of entrada.messaging ?? []) {
      const m = ev.message;
      if (!m || m.is_echo || !ev.sender?.id) continue;
      const base = { cuenta: String(entrada.id), canal, contacto: String(ev.sender.id) };
      if (typeof m.text === 'string') salida.push({ ...base, texto: m.text });
      else {
        const audio = (m.attachments ?? []).find((a) => a.type === 'audio' && a.payload?.url);
        if (audio) salida.push({ ...base, audio: { url: audio.payload.url } });
      }
    }
  }
  return salida;
}
