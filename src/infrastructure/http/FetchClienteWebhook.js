/**
 * Llama los webhooks de n8n del bloque "Tarea en n8n" (agendar citas, consultar estatus...).
 * n8n puede contestar { respuesta: "texto para el cliente", variables: { ... } }.
 */
export class FetchClienteWebhook {
  constructor({ timeoutMs = 10_000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async enviar(url, cuerpo) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`El webhook respondió ${r.status}`);
    const texto = await r.text();
    try {
      return texto ? JSON.parse(texto) : {};
    } catch {
      return { respuesta: texto };
    }
  }
}
