import { NoConfiguradoError, ServicioExternoError } from '../../application/shared/errors.js';

/** Errores por los que conviene intentar con el siguiente modelo (saturado, caído, sin permiso para ese modelo...). */
const REINTENTABLES = new Set([400, 402, 404, 408, 429, 500, 502, 503, 504]);

/**
 * Modelos de lenguaje vía OpenRouter (API compatible con OpenAI).
 * Recibe una LISTA de modelos (pensada para los gratuitos `:free`, que se saturan seguido):
 * prueba en orden y se queda con el primero que responda.
 * Solo expone "dame un JSON a partir de estas instrucciones"; el prompt lo arma la aplicación.
 */
export class OpenRouterCliente {
  /** @param {{ apiKey?: string, modelos: string[], urlSitio: string, maxTokens?: number }} opciones */
  constructor({ apiKey, modelos, urlSitio, maxTokens = 8000 }) {
    this.apiKey = apiKey;
    this.modelos = modelos;
    this.urlSitio = urlSitio;
    this.maxTokens = maxTokens;
  }

  get configurado() {
    return Boolean(this.apiKey && this.modelos.length);
  }

  /**
   * @param {{ sistema: string, mensajes: { role: 'user' | 'assistant', content: string }[], maxTokens?: number, timeoutMs?: number }} entrada
   *   timeoutMs: tiempo TOTAL para contestar, contando los modelos de respaldo.
   * @returns {Promise<{ texto: string, cortado: boolean, modelo: string, tokens?: object }>}
   */
  async completarJson({ sistema, mensajes, maxTokens = this.maxTokens, timeoutMs = 150_000 }) {
    if (!this.configurado) throw new NoConfiguradoError('El asistente de IA no está configurado (OPENROUTER_API_KEY)');
    const fallos = [];
    const limite = Date.now() + timeoutMs;
    for (const modelo of this.modelos) {
      const restante = limite - Date.now();
      if (restante < 2_000) {
        fallos.push('se acabó el tiempo');
        break;
      }
      try {
        return await this.#pedir(modelo, sistema, mensajes, maxTokens, restante);
      } catch (e) {
        fallos.push(`${modelo}: ${e.message}`);
        if (!e.reintentable) break;
      }
    }
    const saturados = fallos.some((f) => /429|rate|limit/i.test(f));
    throw new ServicioExternoError(
      saturados
        ? 'Los modelos gratuitos de IA están saturados o se alcanzó el límite diario gratuito. Intenta en unos minutos.'
        : `El asistente de IA no pudo responder. ${fallos.at(-1) ?? ''}`.trim(),
    );
  }

  async #pedir(modelo, sistema, mensajes, maxTokens, timeoutMs) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': this.urlSitio,
        'X-Title': 'FlujoBot',
      },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'system', content: sistema }, ...mensajes],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((e) => {
      throw Object.assign(new Error(`sin conexión (${e.name})`), { reintentable: true });
    });
    const datos = await r.json().catch(() => ({}));
    // OpenRouter a veces responde 200 con el error dentro (el proveedor del modelo falló)
    const error = datos?.error ?? datos?.choices?.[0]?.error;
    if (!r.ok || error) {
      const estado = r.ok ? Number(error?.code) || 502 : r.status;
      throw Object.assign(new Error(`${estado} ${error?.message ?? ''}`.trim()), { reintentable: REINTENTABLES.has(estado) });
    }
    const texto = datos.choices?.[0]?.message?.content;
    if (!texto?.trim()) throw Object.assign(new Error('respuesta vacía'), { reintentable: true });
    // finish_reason "length": la respuesta se cortó al llegar al tope de tokens (JSON incompleto)
    const cortado = datos.choices?.[0]?.finish_reason === 'length';
    return { texto, cortado, modelo: datos.model ?? modelo, tokens: datos.usage };
  }
}
