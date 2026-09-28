import { Inject, Injectable, UnauthorizedException, ForbiddenException, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { ROLE_PERMISSIONS, type AuthSession, type Permission, type SessionUser, type Role } from '@labcopilot/contracts';
import { DatabaseService } from '../database';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider';
import { digest, equalToken, hashPassword, verifyPassword } from './crypto';

export const SESSION_COOKIE = 'labcopilot_session';
export const SESSION_MS = 8 * 60 * 60 * 1000;

function toSessionUser(user: { id: string; username: string; displayName: string; role: Role; facilityId: string; facility: { name: string } }): SessionUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role,
    facilityId: user.facilityId, facilityName: user.facility.name, permissions: [...ROLE_PERMISSIONS[user.role]] };
}

@Injectable()
export class DevelopmentAuthProvider implements AuthProvider {
  readonly mode = 'development' as const;
  // A nonexistent username follows the same password-hashing path.
  private readonly dummyHash = hashPassword(randomBytes(32).toString('hex'));
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async authenticate(username: string, password: string): Promise<SessionUser | null> {
    const user = await this.db.user.findUnique({ where: { username }, include: { facility: true } });
    const valid = verifyPassword(password, user?.passwordHash ?? this.dummyHash);
    return valid && user?.active ? toSessionUser(user) : null;
  }
}

@Injectable()
export class AuthService {
  // Small local-demo rate limit; production needs a shared edge/identity policy.
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider) {}

  private token(request: Request): string | undefined {
    return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  }
  requireOrigin(request: Request) {
    if (request.headers.origin !== process.env.WEB_ORIGIN) throw new ForbiddenException('Request origin is not permitted.');
  }
  private setCookie(response: Response, token: string, expires: Date) {
    response.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/api', expires });
  }
  async login(request: Request, response: Response, username: string, password: string): Promise<AuthSession> {
    this.requireOrigin(request);
    const now = Date.now(); const key = request.ip ?? 'local';
    for (const [entry, value] of this.attempts) if (value.resetAt <= now) this.attempts.delete(entry);
    const attempt = this.attempts.get(key) ?? { count: 0, resetAt: now + 60_000 };
    if (attempt.count >= 20) throw new HttpException('Too many login attempts. Try again in one minute.', 429);
    attempt.count += 1; this.attempts.set(key, attempt);
    const user = await this.provider.authenticate(username, password);
    if (!user) throw new UnauthorizedException('Invalid demo username or password.');
    const previous = this.token(request);
    if (previous) await this.db.session.deleteMany({ where: { tokenHash: digest(previous) } });
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_MS);
    await this.db.session.create({ data: { tokenHash: digest(token), csrfToken, userId: user.id, expiresAt } });
    this.setCookie(response, token, expiresAt);
    return { user, csrfToken, expiresAt: expiresAt.toISOString(), authMode: 'development' };
  }
  async session(request: Request): Promise<AuthSession> {
    const token = this.token(request);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Sign in to continue.');
    const session = await this.db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: { include: { facility: true } } } });
    if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active) throw new UnauthorizedException('Your session has expired. Sign in again.');
    // Read current role and facility on every request; cookie claims are never authority.
    return { user: toSessionUser(session.user), csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString(), authMode: 'development' };
  }
  async authorize(request: Request, permission?: Permission, mutation = false, workspace = false): Promise<AuthSession> {
    const session = await this.session(request);
    if (permission && !session.user.permissions.includes(permission)) throw new ForbiddenException('Your role does not permit this action.');
    if (workspace && (request.headers['x-workspace-user-id'] !== session.user.id || request.headers['x-workspace-facility-id'] !== session.user.facilityId)) {
      throw new ForbiddenException('This workspace belongs to a different signed-in identity. Sign in again before synchronizing.');
    }
    if (mutation) {
      this.requireOrigin(request);
      const token = request.headers['x-csrf-token'];
      if (typeof token !== 'string' || !equalToken(token, session.csrfToken)) throw new ForbiddenException('Invalid request token. Refresh your session.');
    }
    return session;
  }
  async logout(request: Request, response: Response) {
    await this.authorize(request, undefined, true);
    const token = this.token(request)!;
    await this.db.session.deleteMany({ where: { tokenHash: digest(token) } });
    response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/api' });
    return { signedOut: true };
  }
}

