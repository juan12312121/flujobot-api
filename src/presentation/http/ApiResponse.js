import { Pagina } from '../../application/shared/Pagina.js';

/** Todas las respuestas salen con la misma forma: { ok, data, meta? } o { ok: false, error }. */
export class ApiResponse {
  static enviar(res, status, resultado) {
    if (status === 204) return res.status(204).send();
    if (resultado instanceof Pagina) return res.status(status).json({ ok: true, data: resultado.items, meta: resultado.meta });
    return res.status(status).json({ ok: true, data: resultado ?? null });
  }

  static error(res, status, codigo, mensaje, detalles = []) {
    return res.status(status).json({ ok: false, error: { codigo, mensaje, detalles } });
  }
}
