import { interpolar } from '../../domain/flujo/texto.js';
import { PIE_CAMPANA, limpiarTexto } from '../../domain/avisos/textos.js';

/** Canales donde se le puede escribir a alguien sin que acabe de escribir (Meta lo prohíbe fuera de 24 h). */
export const CANALES_CAMPANA = ['whatsapp', 'telegram'];

export const SEGMENTOS = {
  todos: 'Todos los que aceptaron promociones',
  compraron: 'Compraron en los últimos N días',
  sin_terminar: 'Dejaron un pedido a medias en los últimos N días',
  con_cita: 'Tuvieron o tienen cita en los últimos N días',
  inactivos: 'No escriben desde hace N días',
};

const LOTE = 25;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Campañas: mensajes masivos SOLO a contactos que aceptaron promociones (bloque "Pedir permiso" o ALTA).
 * Se envían por lotes en cada vuelta del Programador, con pausa entre mensajes para no parecer spam
 * (WhatsApp bloquea números que mandan cientos de mensajes seguidos).
 */
export class Campanas {
  constructor({ campanas, contactos, conversaciones, citas, bots, empresas, mensajero, limites, reloj = () => new Date(), pausaMs = [1200, 2800] }) {
    Object.assign(this, { campanas, contactos, conversaciones, citas, bots, empresas, mensajero, limites, reloj, pausaMs });
  }

  /** Destinatarios de un segmento (uno por canal + contacto). */
  async destinatarios(empresaId, { tipo = 'todos', dias = 30 } = {}) {
    const desde = new Date(this.reloj().getTime() - dias * 86400000);
    let filtro = {};
    if (tipo === 'compraron') filtro = { ultimaCompra: { $gte: desde } };
    if (tipo === 'inactivos') filtro = { ultimoMensaje: { $lt: desde } };
    const lista = await this.contactos.conPermiso(empresaId, CANALES_CAMPANA, filtro);

    let permitidos = null;
    if (tipo === 'sin_terminar') {
      const conCarrito = await this.conversaciones.conCarritoDesde(empresaId, desde);
      permitidos = new Set(conCarrito.map((c) => `${c.canal}|${c.contacto}`));
    }
    if (tipo === 'con_cita') {
      const citas = await this.citas.listar(empresaId, { canal: { $ne: 'simulador' }, inicio: { $gte: desde } }, { limite: 5000 });
      permitidos = new Set(citas.map((c) => `${c.canal === 'panel' ? 'whatsapp' : c.canal}|${c.contacto}`));
    }
    const vistos = new Set();
    return lista
      .filter((c) => !permitidos || permitidos.has(`${c.canal}|${c.contacto}`))
      .filter((c) => (tipo === 'sin_terminar' ? !(c.ultimaCompra && c.ultimaCompra >= desde) : true))
      .filter((c) => !vistos.has(`${c.canal}|${c.contacto}`) && vistos.add(`${c.canal}|${c.contacto}`))
      .map((c) => ({ canal: c.canal, contacto: c.contacto, nombre: c.nombre ?? '' }));
  }

  /** Barrido del Programador: arranca las programadas que ya tocan y manda un lote de las que van a medias. */
  async atender() {
    const ahora = this.reloj();
    const resumen = { enviadas: 0, terminadas: 0 };
    for (const c of await this.campanas.porAtender(ahora)) {
      if (!(await this.campanas.apartar(c.id, ahora))) continue;
      try {
        if (c.estado === 'programada') await this.#arrancar(c);
        else {
          const r = await this.#lote(c);
          resumen.enviadas += r.enviados;
          if (r.terminada) resumen.terminadas++;
        }
      } catch (e) {
        console.warn(`Campaña ${c.nombre}:`, e.message);
        await this.campanas.guardarAvance(c.id, {});
      }
    }
    return resumen;
  }

  async #arrancar(c) {
    const lista = await this.destinatarios(c.empresaId, c.segmento);
    const restante = await this.limites.restante(c.empresaId, 'campanas');
    const final = lista.slice(0, restante);
    await this.campanas.guardarAvance(c.id, {
      estado: final.length ? 'enviando' : 'enviada',
      destinatarios: final,
      indice: 0,
      'totales.destinatarios': final.length,
      ...(final.length ? {} : { terminadaEn: this.reloj() }),
    });
  }

  async #lote(c) {
    const completa = await this.campanas.conDestinatarios(c.id);
    const bot = await this.bots.obtener(c.empresaId, c.botId);
    const empresa = await this.empresas.obtener(c.empresaId);
    const lista = completa.destinatarios ?? [];
    if (!bot || !empresa || empresa.activa === false) {
      await this.campanas.guardarAvance(c.id, { estado: 'cancelada', terminadaEn: this.reloj() });
      return { enviados: 0, terminada: true };
    }
    let { indice } = completa;
    let enviados = 0;
    let fallidos = 0;
    const fin = Math.min(indice + LOTE, lista.length);
    for (; indice < fin; indice++) {
      const d = lista[indice];
      const texto = limpiarTexto(interpolar(c.texto, { nombre: primerNombre(d.nombre), empresa: empresa.nombre })) + PIE_CAMPANA;
      const r = await this.mensajero.enviar({ bot, canal: d.canal, contacto: d.contacto, nombre: d.nombre, respuestas: [{ texto, url: c.imagenUrl || undefined }], de: 'sistema', autor: `Campaña: ${c.nombre}` });
      if (r.ok) enviados++;
      else fallidos++;
      if (indice + 1 < fin) await espera(this.#pausa());
    }
    if (enviados) await this.limites.sumar(c.empresaId, 'campanas', enviados);
    const terminada = indice >= lista.length;
    await this.campanas.guardarAvance(c.id, {
      indice,
      'totales.enviados': (completa.totales?.enviados ?? 0) + enviados,
      'totales.fallidos': (completa.totales?.fallidos ?? 0) + fallidos,
      ...(terminada ? { estado: 'enviada', terminadaEn: this.reloj() } : {}),
    });
    return { enviados, terminada };
  }

  #pausa() {
    const [a, b] = this.pausaMs;
    return a + Math.random() * (b - a);
  }
}

const primerNombre = (n) => String(n ?? '').trim().split(/\s+/)[0] || '';
