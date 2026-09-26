import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError } from '../../shared/errors.js';

export class ObtenerPerfil extends UseCase {
  constructor({ empresas, usuarios, superadmins = [] }) {
    super();
    Object.assign(this, { empresas, usuarios, superadmins });
  }

  async ejecutar({ actor }) {
    const usuario = await this.usuarios.obtener(actor.empresaId, actor.id);
    if (!usuario) throw new NoAutenticadoError('El usuario ya no existe');
    const empresa = await this.empresas.obtener(actor.empresaId);
    if (empresa?.activa === false) throw new NoAutenticadoError(`La empresa está suspendida${empresa.suspendidaMotivo ? `: ${empresa.suspendidaMotivo}` : ''}`);
    return { usuario: { ...usuario, esSuperadmin: this.superadmins.includes(usuario.email) }, empresa };
  }
}
