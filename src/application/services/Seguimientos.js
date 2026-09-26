import { Flujo } from '../../domain/flujo/Flujo.js';
import { interpolar, dinero } from '../../domain/flujo/texto.js';
import { totalCarrito } from '../../domain/pedidos/carrito.js';
import { textoAviso } from '../../domain/avisos/textos.js';

const HORA = 3600_000;

/**
 * Lo que el bot hace solo con el paso del tiempo:
 * - bloque "Esperar": si el cliente no contestó a tiempo, el flujo sigue por "No respondió";
 * - carritos abandonados: a las N horas se le recuerda al cliente y se le vuelve a mostrar dónde se quedó.
 */
export class Seguimientos {
  constructor({ bots, empresas, conversaciones, motor, atender, mensajero, limites, reloj = () => new Date() }) {
    Object.assign(this, { bots, empresas, conversaciones, motor, atender, mensajero, limites, reloj });
  }

  /** Manejador de la tarea "reanudar_espera". */
  async reanudarEspera({ empresaId, conversacionId, token }) {
    const conv = await this.conversaciones.obtener(empresaId, conversacionId);
    if (!conv) return;
    const bot = await this.bots.obtener(empresaId, conv.botId);
    if (!bot?.publicado?.nodos?.length) return;
    const empresa = await this.empresas.obtener(empresaId);
    if (!empresa || empresa.activa === false) return;

    const flujo = new Flujo(bot.publicado);
    const r = await this.motor.reanudar({ flujo, sesion: conv, contexto: this.atender.contexto(bot, empresa, conv.canal), token });
    if (!r.vigente) return; // el cliente ya contestó o la conversación cambió
    await this.#entregar(bot, conv, r.sesion, r.respuestas);
    await this.atender.aplicarEfectos({ bot, canal: conv.canal, contacto: conv.contacto, nombre: conv.nombre, conversacion: conv, efectos: r.efectos ?? [] });
  }

  /** Barrido del Programador: carritos abandonados de todos los bots que lo tienen prendido. */
  async carritosAbandonados() {
    let enviados = 0;
    const ahora = this.reloj().getTime();
    for (const bot of await this.bots.conRecuperacion()) {
      if (!bot.publicado?.nodos?.length) continue;
      const empresa = await this.empresas.obtener(bot.empresaId);
      if (!empresa || empresa.activa === false || !(await this.limites.puede(empresa, 'conversaciones', 0))) continue;
      const horas = Math.min(Math.max(Number(bot.recuperacion.horas) || 2, 1), 48);
      // Messenger e Instagram solo dejan escribir dentro de 24 h desde el último mensaje del cliente
      const canales = ['whatsapp', 'telegram', ...(horas < 23 ? ['messenger', 'instagram'] : [])];
      const pendientes = await this.conversaciones.carritosAbandonados(bot.id, { desde: new Date(ahora - (horas + 48) * HORA), hasta: new Date(ahora - horas * HORA), canales });
      const flujo = new Flujo(bot.publicado);
      for (const conv of pendientes) {
        const contexto = this.atender.contexto(bot, empresa, conv.canal);
        const variables = {
          nombre: String(conv.nombre ?? '').split(/\s+/)[0] ?? '',
          total: dinero(totalCarrito(conv.carrito), empresa.moneda),
          pedido: (empresa.terminos?.pedido ?? 'pedido').toLowerCase(),
          empresa: empresa.nombre,
        };
        const plantilla = bot.recuperacion.texto?.trim() || textoAviso(empresa, 'carrito.abandonado');
        const r = await this.motor.recordar({ flujo, sesion: conv, contexto });
        const respuestas = [{ tipo: 'texto', texto: interpolar(plantilla, variables) }, ...r.respuestas];
        await this.#entregar(bot, conv, { ...r.sesion, carritoRecordado: this.reloj() }, respuestas);
        enviados++;
      }
    }
    return { enviados };
  }

  /** Guarda el estado nuevo con los mensajes y los manda por el canal de la conversación. */
  async #entregar(bot, conv, sesion, respuestas) {
    const ahora = this.reloj();
    const mensajes = respuestas.map((x) => ({ de: 'bot', texto: x.texto ?? '', url: x.url, fecha: ahora }));
    const clave = { empresaId: bot.empresaId, botId: bot.id, canal: conv.canal, contacto: conv.contacto };
    await this.conversaciones.guardar(clave, sesion, mensajes);
    const r = await this.mensajero.enviar({ bot, canal: conv.canal, contacto: conv.contacto, respuestas, registrar: false });
    if (!r.ok) console.warn(`No se entregó a ${conv.canal}:${conv.contacto}:`, r.error);
  }
}
