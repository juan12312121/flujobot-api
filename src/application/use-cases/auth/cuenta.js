import crypto from 'node:crypto';
import { UseCase } from '../../shared/UseCase.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';

/**
 * Recuperar contraseña y verificar el correo. Los enlaces llevan un token aleatorio de un solo uso;
 * en la base solo se guarda su huella (sha256), así un respaldo filtrado no sirve para entrar.
 */

const HORA = 3600_000;
const huella = (token) => crypto.createHash('sha256').update(token).digest('hex');
const nuevoToken = () => crypto.randomBytes(32).toString('base64url');

/** Manda el enlace para verificar el correo (lo usan el registro, el alta de usuarios y "reenviar"). */
export async function enviarVerificacion({ usuarios, correo, urlFrontend }, usuario) {
  const token = nuevoToken();
  await usuarios.guardarToken(usuario.id, { tipo: 'verificar', hash: huella(token), expira: new Date(Date.now() + 72 * HORA) });
  await correo.enviar({
    para: usuario.email,
    asunto: 'Confirma tu correo en FlujoBot',
    texto: `Hola ${usuario.nombre.split(' ')[0]}, confirma tu correo para proteger tu cuenta:\n\n${urlFrontend}/verificar?token=${token}\n\nEl enlace vence en 3 días.`,
  });
}

/** "Olvidé mi contraseña": siempre responde lo mismo, exista o no el correo (no revela quién tiene cuenta). */
export class SolicitarRecuperacion extends UseCase {
  constructor({ usuarios, correo, urlFrontend }) {
    super();
    Object.assign(this, { usuarios, correo, urlFrontend });
  }

  async ejecutar({ email }) {
    const usuario = await this.usuarios.porEmail(email);
    if (usuario) {
      const token = nuevoToken();
      await this.usuarios.guardarToken(usuario.id, { tipo: 'recuperar', hash: huella(token), expira: new Date(Date.now() + HORA) });
      await this.correo
        .enviar({
          para: usuario.email,
          asunto: 'Restablece tu contraseña de FlujoBot',
          texto: `Hola ${usuario.nombre.split(' ')[0]}, recibimos una solicitud para cambiar tu contraseña. Entra aquí para elegir una nueva:\n\n${this.urlFrontend}/restablecer?token=${token}\n\nEl enlace vence en 1 hora. Si no fuiste tú, ignora este correo: tu contraseña no cambia.`,
        })
        .catch((e) => console.warn('No se envió el correo de recuperación:', e.message));
    }
    return { mensaje: 'Si el correo tiene cuenta, te enviamos un enlace para restablecer la contraseña.' };
  }
}

export class RestablecerPassword extends UseCase {
  constructor({ usuarios, hasher }) {
    super();
    Object.assign(this, { usuarios, hasher });
  }

  async ejecutar({ token, password }) {
    const usuario = await this.usuarios.porToken('recuperar', huella(token));
    if (!usuario) throw new ReglaDeNegocioError('ENLACE_INVALIDO', 'El enlace no es válido o ya venció. Pide uno nuevo.');
    // Abrir el enlace del correo también demuestra que el correo es suyo
    await this.usuarios.cambiarPassword(usuario.id, await this.hasher.hash(password));
    return { mensaje: 'Listo, ya puedes entrar con tu nueva contraseña.' };
  }
}

export class VerificarCorreo extends UseCase {
  constructor({ usuarios }) {
    super();
    this.usuarios = usuarios;
  }

  async ejecutar({ token }) {
    const usuario = await this.usuarios.porToken('verificar', huella(token));
    if (!usuario) throw new ReglaDeNegocioError('ENLACE_INVALIDO', 'El enlace no es válido o ya venció. Pide otro desde el panel.');
    await this.usuarios.marcarVerificado(usuario.id);
    return { mensaje: 'Correo confirmado. ¡Gracias!' };
  }
}

export class ReenviarVerificacion extends UseCase {
  constructor({ usuarios, correo, urlFrontend }) {
    super();
    Object.assign(this, { usuarios, correo, urlFrontend });
  }

  async ejecutar({ actor }) {
    const usuario = await this.usuarios.obtener(actor.empresaId, actor.id);
    if (!usuario || usuario.emailVerificado) return { mensaje: 'Tu correo ya está confirmado.' };
    await enviarVerificacion(this, usuario);
    return { mensaje: `Te enviamos el enlace a ${usuario.email}.` };
  }
}
