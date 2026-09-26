/** Lo que contesta el bot cuando le mandan un audio y no se puede transcribir. */
export const SIN_AUDIO = 'Por ahora no puedo escuchar notas de voz. ¿Me lo escribes, por favor?';

/**
 * Notas de voz → texto, para que el flujo las entienda igual que un mensaje escrito.
 * `descargar` sabe traer el audio de cada canal; si no hay transcriptor o falla, devuelve null.
 */
export class Voz {
  constructor({ transcriptor }) {
    this.transcriptor = transcriptor;
  }

  get disponible() {
    return Boolean(this.transcriptor?.configurado);
  }

  /** @param {() => Promise<{ datos: Buffer, tipo: string, nombre: string }>} descargar */
  async aTexto(descargar) {
    if (!this.disponible) return null;
    try {
      const audio = await descargar();
      if (audio.datos.length > 20 * 1024 * 1024) return null; // Whisper acepta hasta ~25 MB
      const texto = await this.transcriptor.transcribir(audio);
      return texto || null;
    } catch (e) {
      console.warn('No se pudo transcribir la nota de voz:', e.message);
      return null;
    }
  }
}
