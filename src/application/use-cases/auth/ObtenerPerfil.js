import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError } from '../../shared/errors.js';

export class ObtenerPerfil extends UseCase {
  constructor({ empresas, usuarios }) {
    super();
    Object.assign(this, { empresas, usuarios });
  }

  async ejecutar({ actor }) {
    const usuario = await this.usuarios.obtener(actor.empresaId, actor.id);
    if (!usuario) throw new NoAutenticadoError('El usuario ya no existe');
    return { usuario, empresa: await this.empresas.obtener(actor.empresaId) };
  }
}
