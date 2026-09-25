import { ApiResponse } from './ApiResponse.js';
import { validarCon, validarParams } from './validar.js';

/**
 * Controlador base: traduce HTTP ⇄ caso de uso y nada más.
 * Cada acción se declara en una línea:
 *
 *   crear = this.accion('crearNota', { body: esquemas.crear, status: 201 });
 *
 * La entrada del caso de uso es { actor, ...params de la ruta, ...query, ...body, ...extra(req) }.
 */
export class BaseController {
  /** @param {Record<string, import('../../application/shared/UseCase.js').UseCase>} casos */
  constructor(casos) {
    this.casos = casos;
  }

  /**
   * @param {string} nombreCaso  llave del caso de uso en `casos`
   * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, status?: number, extra?: (req) => object }} [opciones]
   */
  accion(nombreCaso, { body, query, status = 200, extra } = {}) {
    const caso = this.casos[nombreCaso];
    if (!caso) throw new Error(`${this.constructor.name}: no existe el caso de uso "${nombreCaso}"`);
    return async (req, res) => {
      const entrada = {
        actor: req.actor,
        ...validarParams(req.params),
        ...(query ? validarCon(query, req.query) : {}),
        ...(body ? validarCon(body, req.body) : {}),
        ...(extra ? extra(req) : {}),
      };
      return ApiResponse.enviar(res, status, await caso.ejecutar(entrada));
    };
  }
}
