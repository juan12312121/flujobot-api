import crypto from 'node:crypto';

/**
 * Cifra los secretos que cada empresa pega en el panel (llaves de Mercado Pago/Stripe, tokens de Telegram y Meta)
 * con AES-256-GCM. La llave sale de CIFRADO_LLAVE (o de JWT_SECRET si no hay otra): si cambia, hay que volver
 * a pegar esos secretos.
 *
 * Formato guardado: "v1:<iv base64url>:<tag base64url>:<cifrado base64url>".
 */
export class Cifrador {
  constructor(secreto) {
    this.llave = crypto.createHash('sha256').update(String(secreto)).digest();
  }

  cifrar(texto) {
    if (!texto) return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.llave, iv);
    const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), cifrado.toString('base64url')].join(':');
  }

  /** Devuelve '' si no hay nada o si no se puede descifrar (llave cambiada). */
  descifrar(guardado) {
    if (!guardado) return '';
    try {
      const [v, iv, tag, datos] = guardado.split(':');
      if (v !== 'v1') return '';
      const d = crypto.createDecipheriv('aes-256-gcm', this.llave, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(datos, 'base64url')), d.final()]).toString('utf8');
    } catch {
      return '';
    }
  }
}

/** Compara una firma HMAC-SHA256 en tiempo constante. */
export function firmaValida(secreto, contenido, firmaHex) {
  if (!secreto || !firmaHex) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(contenido).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(firmaHex));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
