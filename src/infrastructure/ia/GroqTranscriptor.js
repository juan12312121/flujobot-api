import { ServicioExternoError } from '../../application/shared/errors.js';

/**
 * Notas de voz → texto con Whisper en Groq (tiene nivel gratuito: https://console.groq.com/keys).
 * Sin GROQ_API_KEY el bot le pide al cliente que escriba.
 */
export class GroqTranscriptor {
  constructor({ apiKey, modelo = 'whisper-large-v3-turbo' }) {
    this.apiKey = apiKey;
    this.modelo = modelo;
  }

  get configurado() {
    return Boolean(this.apiKey);
  }

  /** @param {{ datos: Buffer, tipo: string, nombre: string }} audio */
  async transcribir({ datos, tipo, nombre }) {
    const form = new FormData();
    form.append('file', new Blob([datos], { type: tipo }), nombre);
    form.append('model', this.modelo);
    form.append('language', 'es');
    form.append('response_format', 'json');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ServicioExternoError(`Transcripción: ${d.error?.message ?? r.status}`);
    return String(d.text ?? '').trim();
  }
}
