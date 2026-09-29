import { UseCase } from '../../shared/UseCase.js';
import { ConflictoError } from '../../shared/errors.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { exigirAdmin, existe } from '../../services/permisos.js';
import { enviarVerificacion } from '../auth/cuenta.js';

/** Equipo de la empresa: el admin da de alta a su gente con un rol (editor, cajero, recepción, repartidor...). */

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
  constructor({ usuarios, hasher, correo, urlFrontend, bitacora }) {
    super();
    Object.assign(this, { usuarios, hasher, correo, urlFrontend, bitacora });
  }

  async ejecutar({ actor, nombre, email, password, rol, telefono = '' }) {
    exigirAdmin(actor);
    if (await this.usuarios.porEmail(email)) throw new ConflictoError('CORREO_REGISTRADO', 'Ese correo ya tiene cuenta');
    const usuario = await this.usuarios.crear(actor.empresaId, { nombre, email, rol, telefono, passwordHash: await this.hasher.hash(password) });
    if (this.correo) enviarVerificacion(this, usuario).catch((e) => console.warn('No se envió la verificación:', e.message));
    await this.bitacora?.registrar(actor, 'usuario.crear', { entidad: 'usuario', entidadId: usuario.id, detalle: `${email} (${rol})` });
    return usuario;
  }
}

/** Cambiar el rol o el teléfono de alguien del equipo. */
export class EditarUsuario extends UseCase {
  constructor({ usuarios, bitacora }) {
    super();
    Object.assign(this, { usuarios, bitacora });
  }

  async ejecutar({ actor, usuarioId, ...cambios }) {
    exigirAdmin(actor);
    if (usuarioId === actor.id && cambios.rol && cambios.rol !== 'admin') {
      throw new ReglaDeNegocioError('NO_A_TI_MISMO', 'No puedes quitarte el rol de administrador');
    }
    const u = existe(await this.usuarios.actualizar(actor.empresaId, usuarioId, cambios), 'Usuario no encontrado');
    const { passwordHash: _, ...usuario } = u;
    await this.bitacora?.registrar(actor, 'usuario.editar', { entidad: 'usuario', entidadId: usuarioId, detalle: `${usuario.email}: ${JSON.stringify(cambios)}` });
    return usuario;
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
