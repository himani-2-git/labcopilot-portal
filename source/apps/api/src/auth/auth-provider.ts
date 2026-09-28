import type { SessionUser } from '@labcopilot/contracts';

// The credential exchange is adapter-specific. Sessions and authorization remain
// owned by LabCopilot when a future Keycloak callback supplies an identity.
export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
export interface AuthProvider {
  readonly mode: 'development' | 'oidc';
  authenticate(username: string, password: string): Promise<SessionUser | null>;
}
