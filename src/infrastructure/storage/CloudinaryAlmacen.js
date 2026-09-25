import crypto from 'node:crypto';

const API = 'https://api.cloudinary.com/v1_1';
const FORMATOS = 'jpg,jpeg,png,webp,gif';

/**
 * Cloudinary sin SDK: el navegador sube DIRECTO a Cloudinary con una firma
 * que da este servidor (el secreto nunca sale del backend), y aquí se borran.
 * Firma = sha1(params ordenados "a=1&b=2" + api_secret).
 */
export class CloudinaryAlmacen {
  constructor({ cloudName, apiKey, apiSecret }) {
    this.cloudName = cloudName;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  estaConfigurado() {
    return Boolean(this.cloudName && this.apiKey && this.apiSecret);
  }

  firmarSubida(carpeta) {
    const params = { allowed_formats: FORMATOS, folder: carpeta, timestamp: Math.floor(Date.now() / 1000) };
    return {
      url: `${API}/${this.cloudName}/image/upload`,
      campos: { ...params, api_key: this.apiKey, signature: this.#firmar(params) },
    };
  }

  /** `invalidate` también la saca del CDN: un ticket borrado no debe seguir viéndose por su URL. */
  async borrar(publicId) {
    const params = { invalidate: 'true', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
    const cuerpo = new URLSearchParams({ ...params, api_key: this.apiKey, signature: this.#firmar(params) });
    const r = await fetch(`${API}/${this.cloudName}/image/destroy`, { method: 'POST', body: cuerpo });
    if (!r.ok) throw new Error(`Cloudinary no borró ${publicId}: ${r.status}`);
  }

  #firmar(params) {
    const texto = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return crypto.createHash('sha1').update(texto + this.apiSecret).digest('hex');
  }
}
