import { ServicioExternoError } from '../../application/shared/errors.js';

/** Correos "enviados" sin proveedor (desarrollo y pruebas): se pueden leer desde las pruebas. */
export const buzonLocal = [];

/**
 * Envío de correos con Resend (https://resend.com, nivel gratuito) por su API REST.
 * Sin RESEND_API_KEY no se manda nada: el correo se imprime en la consola y queda en `buzonLocal`,
 * así recuperar contraseña se puede probar en local.
 */
export class Correo {
  constructor({ apiKey, remitente }) {
    this.apiKey = apiKey;
    this.remitente = remitente || 'FlujoBot <onboarding@resend.dev>';
  }

  get configurado() {
    return Boolean(this.apiKey);
  }

  /** @param {{ para: string, asunto: string, texto: string, html?: string }} correo */
  async enviar({ para, asunto, texto, html }) {
    if (!this.configurado) {
      buzonLocal.push({ para, asunto, texto, fecha: new Date() });
      if (buzonLocal.length > 50) buzonLocal.shift();
      console.log(`\n[correo sin enviar: falta RESEND_API_KEY]\nPara: ${para}\nAsunto: ${asunto}\n${texto}\n`);
      return { enviado: false, local: true };
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.remitente, to: [para], subject: asunto, text: texto, html: html ?? htmlSimple(asunto, texto) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new ServicioExternoError(`No se pudo enviar el correo: ${d.message ?? r.status}`);
    }
    return { enviado: true };
  }
}

const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** HTML sencillo a partir del texto: los enlaces se vuelven botones. */
function htmlSimple(asunto, texto) {
  const cuerpo = escapar(texto)
    .split('\n')
    .map((linea) =>
      /^https?:\/\//.test(linea.trim())
        ? `<p><a href="${linea.trim()}" style="display:inline-block;padding:10px 18px;background:#12a150;color:#fff;border-radius:8px;text-decoration:none">Abrir enlace</a></p><p style="color:#667085;font-size:12px">${linea.trim()}</p>`
        : `<p>${linea || '&nbsp;'}</p>`,
    )
    .join('');
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#101828"><h2>${escapar(asunto)}</h2>${cuerpo}<p style="color:#98a2b3;font-size:12px">FlujoBot</p></div>`;
}
