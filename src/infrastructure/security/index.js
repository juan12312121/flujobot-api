import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NoAutenticadoError } from '../../application/shared/errors.js';

export class BcryptPasswordHasher {
  hash(texto) {
    return bcrypt.hash(texto, 10);
  }

  comparar(texto, hash) {
    return bcrypt.compare(texto, hash);
  }
}

/** JWT con lo mínimo para autorizar sin ir a la BD: usuario, empresa y rol. */
export class JwtTokenService {
  constructor(secreto, expira) {
    this.secreto = secreto;
    this.expira = expira;
  }

  firmar({ id, empresaId, rol, email }) {
    return jwt.sign({ empresaId, rol, email }, this.secreto, { subject: id, expiresIn: this.expira });
  }

  verificar(token) {
    try {
      const p = jwt.verify(token, this.secreto);
      return { id: p.sub, empresaId: p.empresaId, rol: p.rol, email: p.email };
    } catch {
      throw new NoAutenticadoError('Sesión inválida o vencida');
    }
  }
}

export class CryptoGenerador {
  /** Secreto largo para X-Bot-Token. */
  token() {
    return crypto.randomBytes(24).toString('base64url');
  }

  /** Sufijo corto para nombres (instancias de Evolution, slugs). */
  sufijo() {
    return crypto.randomBytes(3).toString('hex');
  }

  /** Compara secretos en tiempo constante. */
  iguales(a, b) {
    const x = Buffer.from(String(a ?? ''));
    const y = Buffer.from(String(b ?? ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
}
