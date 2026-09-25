import { UseCase } from '../../shared/UseCase.js';
import { NoConfiguradoError } from '../../shared/errors.js';

/** Para qué es la imagen: define su carpeta dentro de la empresa. */
export const USOS_IMAGEN = ['productos', 'logo', 'mensajes'];

/**
 * Firma para que el navegador suba una imagen DIRECTO a Cloudinary (el secreto nunca sale del servidor).
 * Cada empresa tiene su carpeta: flujobot/<empresaId>/<uso>, así sus imágenes no se mezclan.
 */
export class FirmarSubidaImagen extends UseCase {
  constructor({ almacen }) {
    super();
    this.almacen = almacen;
  }

  async ejecutar({ actor, uso }) {
    if (!this.almacen.estaConfigurado()) throw new NoConfiguradoError('Subir imágenes no está configurado en el servidor (faltan las llaves de Cloudinary)');
    return this.almacen.firmarSubida(`flujobot/${actor.empresaId}/${uso}`);
  }
}
