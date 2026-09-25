import { construirWorkflow } from './construirWorkflow.js';
import { ServicioExternoError } from '../../application/shared/errors.js';

/**
 * Publica el workflow de cada bot en n8n por su API REST (X-N8N-API-KEY).
 * Sin n8n configurado trabaja en modo "manual": devuelve el JSON para importarlo a mano.
 */
export class N8nPublicador {
  constructor({ n8nUrl, apiKey, apiUrl, evolutionUrl, credencialEvolutionId }) {
    this.n8nUrl = n8nUrl?.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.evolutionUrl = evolutionUrl;
    this.credencialEvolutionId = credencialEvolutionId;
  }

  get configurado() {
    return Boolean(this.n8nUrl && this.apiKey);
  }

  workflow(bot) {
    return construirWorkflow({ bot, apiUrl: this.apiUrl, evolutionUrl: this.evolutionUrl, credencialEvolutionId: this.credencialEvolutionId });
  }

  webhookUrl(bot) {
    return this.n8nUrl ? `${this.n8nUrl}/webhook/flujobot/${bot.id}` : null;
  }

  /** Crea o actualiza el workflow del bot y lo deja activo. */
  async publicar(bot) {
    const workflow = this.workflow(bot);
    if (!this.configurado) return { modo: 'manual', workflowId: null, webhookUrl: null, workflow };

    let workflowId = bot.n8nWorkflowId;
    if (workflowId) {
      const r = await this.#llamar('PUT', `/workflows/${workflowId}`, workflow).catch((e) => {
        if (e.status === 404) return null; // lo borraron en n8n: se vuelve a crear
        throw e;
      });
      if (!r) workflowId = null;
    }
    if (!workflowId) workflowId = (await this.#llamar('POST', '/workflows', workflow)).id;
    await this.#llamar('POST', `/workflows/${workflowId}/activate`);
    return { modo: 'n8n', workflowId, webhookUrl: this.webhookUrl(bot), workflow };
  }

  /**
   * Crea el workflow de una "Tarea en n8n" e intenta activarlo. Si n8n no deja activarlo
   * (le faltan credenciales), queda creado pero apagado y se avisa qué terminar.
   * Sin n8n configurado devuelve el JSON para importarlo a mano.
   */
  async publicarTarea({ workflow, ruta }) {
    const url = `${this.n8nUrl ?? 'https://TU-N8N'}/webhook/${ruta}`;
    if (!this.configurado) return { modo: 'manual', workflowId: null, url, activo: false };
    const { id } = await this.#llamar('POST', '/workflows', workflow);
    try {
      await this.#llamar('POST', `/workflows/${id}/activate`);
      return { modo: 'n8n', workflowId: id, url, activo: true };
    } catch {
      return { modo: 'n8n', workflowId: id, url, activo: false };
    }
  }

  async despublicar(workflowId) {
    if (!this.configurado || !workflowId) return;
    await this.#llamar('DELETE', `/workflows/${workflowId}`).catch(() => {});
  }

  async #llamar(metodo, ruta, cuerpo) {
    const r = await fetch(`${this.n8nUrl}/api/v1${ruta}`, {
      method: metodo,
      headers: { 'X-N8N-API-KEY': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new ServicioExternoError(`n8n respondió ${r.status}: ${datos?.message ?? ''}`.trim());
      e.status = r.status;
      throw e;
    }
    return datos;
  }
}
