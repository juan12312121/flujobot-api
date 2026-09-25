import { Router } from 'express';

/** Nombres de acción del controlador → método y ruta del CRUD estándar. */
const CRUD = {
  listar: ['get', '/'],
  crear: ['post', '/'],
  obtener: ['get', '/:id'],
  editar: ['patch', '/:id'],
  borrar: ['delete', '/:id'],
};

/** Envuelve el handler para que un error asíncrono llegue al manejador de errores. */
const capturar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Router base. Los hijos implementan `rutas()`:
 *
 *   rutas() {
 *     this.post('/:notaId/pagar', 'pagar');   // nombre de la acción del controlador
 *     this.crud(':notaId');                   // listar/crear/obtener/editar/borrar que existan
 *   }
 *
 * Las rutas propias van ANTES que el CRUD para que "/salir" no lo atrape "/:id".
 */
export class BaseRouter {
  /**
   * @param {import('./BaseController.js').BaseController} controller
   * @param {{ middlewares?: Function[] }} [opciones]  se aplican a todas las rutas del router
   */
  constructor(controller, { middlewares = [] } = {}) {
    this.controller = controller;
    this.middlewares = middlewares;
  }

  rutas() {
    throw new Error(`${this.constructor.name}.rutas() no está implementado`);
  }

  /** Arma y devuelve el express.Router. */
  registrar() {
    // mergeParams: los routers anidados (/tableros/:tableroId/notas) ven :tableroId
    this.router = Router({ mergeParams: true });
    for (const mw of this.middlewares) this.router.use(mw);
    this.rutas();
    return this.router;
  }

  crud(idParam = ':id', acciones = Object.keys(CRUD)) {
    for (const accion of acciones) {
      if (!this.controller[accion]) continue;
      const [metodo, ruta] = CRUD[accion];
      this.agregar(metodo, ruta.replace(':id', idParam), accion);
    }
  }

  agregar(metodo, ruta, ...handlers) {
    const ultimo = handlers.pop();
    const fn = typeof ultimo === 'string' ? this.controller[ultimo] : ultimo;
    if (typeof fn !== 'function') throw new Error(`${this.constructor.name}: handler inválido para ${metodo.toUpperCase()} ${ruta}`);
    this.router[metodo](ruta, ...handlers, capturar(fn));
  }

  get(ruta, ...h) {
    this.agregar('get', ruta, ...h);
  }

  post(ruta, ...h) {
    this.agregar('post', ruta, ...h);
  }

  put(ruta, ...h) {
    this.agregar('put', ruta, ...h);
  }

  patch(ruta, ...h) {
    this.agregar('patch', ruta, ...h);
  }

  delete(ruta, ...h) {
    this.agregar('delete', ruta, ...h);
  }
}
