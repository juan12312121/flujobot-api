import { UseCase } from '../../shared/UseCase.js';
import { ConflictoError } from '../../shared/errors.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { exigirAdmin, existe } from '../../services/permisos.js';

/** Equipo de la empresa: el admin da de alta editores (arman flujos y catálogo) u otros admins. */

export class ListarUsuarios extends UseCase {
  constructor({ usuarios }) {
    super();
    this.usuarios = usuarios;
  }

  ejecutar({ actor }) {
    return this.usuarios.listar(actor.empresaId);
  }
}

export class CrearUsuario extends UseCase {
  constructor({ usuarios, hasher }) {
    super();
    Object.assign(this, { usuarios, hasher });
  }

  async ejecutar({ actor, nombre, email, password, rol }) {
    exigirAdmin(actor);
    if (await this.usuarios.porEmail(email)) throw new ConflictoError('CORREO_REGISTRADO', 'Ese correo ya tiene cuenta');
    return this.usuarios.crear(actor.empresaId, { nombre, email, rol, passwordHash: await this.hasher.hash(password) });
  }
}

export class BorrarUsuario extends UseCase {
  constructor({ usuarios }) {
    super();
    this.usuarios = usuarios;
  }

  async ejecutar({ actor, usuarioId }) {
    exigirAdmin(actor);
    if (usuarioId === actor.id) throw new ReglaDeNegocioError('NO_A_TI_MISMO', 'No puedes borrar tu propio usuario');
    existe(await this.usuarios.borrar(actor.empresaId, usuarioId), 'Usuario no encontrado');
  }
}
