import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError } from '../../shared/errors.js';

export class IniciarSesion extends UseCase {
  constructor({ empresas, usuarios, hasher, tokens, superadmins = [] }) {
    super();
    Object.assign(this, { empresas, usuarios, hasher, tokens, superadmins });
  }

  async ejecutar({ email, password }) {
    const encontrado = await this.usuarios.porEmail(email);
    // Mismo mensaje para correo inexistente y contraseña mala: no revelar qué correos existen
    if (!encontrado || !(await this.hasher.comparar(password, encontrado.passwordHash))) {
      throw new NoAutenticadoError('Correo o contraseña incorrectos');
    }
    const { passwordHash: _, ...usuario } = encontrado;
    const empresa = await this.empresas.obtener(usuario.empresaId);
    if (!empresa?.activa) throw new NoAutenticadoError(`La empresa está suspendida${empresa?.suspendidaMotivo ? `: ${empresa.suspendidaMotivo}` : ''}`);
    return { token: this.tokens.firmar(usuario), usuario: { ...usuario, esSuperadmin: this.superadmins.includes(usuario.email) }, empresa };
  }
}
