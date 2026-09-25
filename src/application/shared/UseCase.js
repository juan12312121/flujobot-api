/**
 * Base de los casos de uso: una sola acción del sistema con una sola puerta de entrada.
 * Reciben sus dependencias (puertos) por constructor y no saben de HTTP ni de SQL.
 */
export class UseCase {
  /** @param {object} _entrada  datos ya validados + { actor } */
  async ejecutar(_entrada) {
    throw new Error(`${this.constructor.name}.ejecutar() no está implementado`);
  }
}
