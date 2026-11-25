import { apiClient, type ApiClient } from '../api/client.ts';
import { ApiClientError, isApiClientError } from '../api/errors.ts';
import type { AuthSession, LoginCredentials, UserRole } from './types.ts';

function isUserRole(value: unknown): value is UserRole {
  return value === 'OWNER' || value === 'WORKER';
}

function parseAuthSession(data: unknown): AuthSession {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiClientError({
      kind: 'server',
      status: 200,
      code: 'INVALID_SESSION_PAYLOAD',
      message: 'Received an unexpected session payload from the server.',
    });
  }

  const record = data as Record<string, unknown>;
  if (
    typeof record.userId !== 'string' ||
    !record.userId ||
    typeof record.name !== 'string' ||
    !record.name ||
    !isUserRole(record.role)
  ) {
    throw new ApiClientError({
      kind: 'server',
      status: 200,
      code: 'INVALID_SESSION_PAYLOAD',
      message: 'Session response is missing required user details.',
    });
  }

  return {
    userId: record.userId,
    name: record.name,
    role: record.role,
  };
}

export interface AuthApi {
  restoreSession(signal?: AbortSignal): Promise<AuthSession | null>;
  signIn(credentials: LoginCredentials): Promise<AuthSession>;
  signOut(): Promise<void>;
}

export function createAuthApi(client: ApiClient = apiClient): AuthApi {
  return {
    async restoreSession(signal?: AbortSignal): Promise<AuthSession | null> {
      try {
        const data = await client.get<unknown>('/auth/session', {
          signal,
          handleUnauthorized: false,
          headers: {
            'Cache-Control': 'no-cache',
          },
        });
        // Clear any stale in-memory CSRF token after restoring an existing session;
        // the next protected write will fetch a fresh token for the restored session.
        client.clearCsrfToken();
        return parseAuthSession(data);
      } catch (error) {
        if (isApiClientError(error) && error.kind === 'unauthorized') {
          client.clearCsrfToken();
          return null;
        }
        throw error;
      }
    },

    async signIn(credentials: LoginCredentials): Promise<AuthSession> {
      const data = await client.post<unknown>('/auth/session', credentials, {
        handleUnauthorized: false,
      });
      const session = parseAuthSession(data);

      // Login rotates JSESSIONID and generates a new CSRF token on the server.
      // Clear the pre-login token and immediately pull a fresh CSRF token into memory.
      client.clearCsrfToken();
      try {
        await client.refreshCsrfToken();
      } catch {
        // Leave memory empty if eager refresh fails; the next protected write will fetch one.
      }

      return session;
    },

    async signOut(): Promise<void> {
      await client.delete<void>('/auth/session', {
        handleUnauthorized: true,
      });
      client.clearCsrfToken();
    },
  };
}

export const authApi = createAuthApi();
