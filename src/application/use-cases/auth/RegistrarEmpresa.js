import { UseCase } from '../../shared/UseCase.js';
import { ConflictoError } from '../../shared/errors.js';
import { configuracionInicial } from '../../../domain/empresa/giros.js';

/** Alta de una empresa nueva con su primer usuario (admin). Es la puerta de entrada al sistema multiempresa. */
export class RegistrarEmpresa extends UseCase {
  constructor({ empresas, usuarios, hasher, tokens, generador }) {
    super();
    Object.assign(this, { empresas, usuarios, hasher, tokens, generador });
  }

  async ejecutar({ empresa: nombreEmpresa, nombre, email, password, moneda, giro }) {
    if (await this.usuarios.porEmail(email)) throw new ConflictoError('CORREO_REGISTRADO', 'Ese correo ya tiene cuenta');

    const empresa = await this.empresas.crear({
      nombre: nombreEmpresa,
      slug: await this.#slugLibre(nombreEmpresa),
      moneda,
      ...configuracionInicial(giro),
    });
    try {
      const usuario = await this.usuarios.crear(empresa.id, { nombre, email, passwordHash: await this.hasher.hash(password), rol: 'admin' });
      return { token: this.tokens.firmar({ ...usuario, empresaId: empresa.id }), usuario, empresa };
    } catch (e) {
      await this.empresas.borrar(empresa.id); // no dejar empresas huérfanas si falla el usuario
      throw e;
    }
  }

  async #slugLibre(nombre) {
    const base =
      nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'empresa';
    if (!(await this.empresas.existeSlug(base))) return base;
    return `${base}-${this.generador.sufijo()}`;
  }
}
