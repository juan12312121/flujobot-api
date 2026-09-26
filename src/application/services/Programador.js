/**
 * Reloj del sistema: cada minuto (y cada vez que alguien llama a POST /interno/tick) toma las tareas
 * vencidas de la cola y corre los "barridos" (campañas por enviar, carritos abandonados).
 *
 * En Render gratis el servidor se duerme sin tráfico: un monitor (Uptime Kuma, n8n) que pegue a /salud
 * o a /interno/tick cada pocos minutos lo mantiene despierto y las tareas salen a tiempo.
 */
export class Programador {
  constructor({ trabajos, reloj = () => new Date(), maxPorTick = 40 }) {
    this.trabajos = trabajos;
    this.reloj = reloj;
    this.maxPorTick = maxPorTick;
    this.manejadores = new Map();
    this.barridos = [];
    this.ocupado = false;
  }

  /** @param {string} tipo  @param {(datos: object, trabajo: object) => Promise<void>} fn */
  manejar(tipo, fn) {
    this.manejadores.set(tipo, fn);
    return this;
  }

  /** @param {string} nombre  @param {() => Promise<object | void>} fn */
  barrido(nombre, fn) {
    this.barridos.push({ nombre, fn });
    return this;
  }

  programar(trabajo) {
    return this.trabajos.programar(trabajo);
  }

  cancelar(prefijo) {
    return this.trabajos.cancelar(prefijo);
  }

  /** Una vuelta. Si ya hay una corriendo en este proceso, no se encima. */
  async tick() {
    if (this.ocupado) return { omitido: true };
    this.ocupado = true;
    const resumen = { trabajos: 0, errores: 0, barridos: {} };
    try {
      for (let i = 0; i < this.maxPorTick; i++) {
        const t = await this.trabajos.tomar(this.reloj());
        if (!t) break;
        resumen.trabajos++;
        const fn = this.manejadores.get(t.tipo);
        try {
          if (!fn) throw new Error(`Sin manejador para "${t.tipo}"`);
          await fn(t.datos ?? {}, t);
          await this.trabajos.terminar(t.id);
        } catch (e) {
          resumen.errores++;
          console.warn(`Tarea ${t.tipo} falló:`, e.message);
          await this.trabajos.terminar(t.id, { error: e.message });
        }
      }
      for (const b of this.barridos) {
        try {
          resumen.barridos[b.nombre] = (await b.fn()) ?? 'ok';
        } catch (e) {
          resumen.barridos[b.nombre] = `error: ${e.message}`;
          console.warn(`Barrido ${b.nombre} falló:`, e.message);
        }
      }
    } finally {
      this.ocupado = false;
    }
    return resumen;
  }

  iniciar(cadaMs = 60_000) {
    this.detener();
    this.intervalo = setInterval(() => this.tick().catch((e) => console.warn('Programador:', e.message)), cadaMs);
    this.intervalo.unref?.();
  }

  detener() {
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
  }
}
