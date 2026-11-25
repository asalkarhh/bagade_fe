import { createContext, useContext } from 'react';
import type { ApiClientError } from '../api/errors.ts';
import type { AuthSession, AuthStatus, LoginCredentials } from './types.ts';

export interface SessionContextValue {
  status: AuthStatus;
  session: AuthSession | null;
  sessionError: ApiClientError | null;
  sessionNotice: string | null;
  logoutError: ApiClientError | null;
  isLoggingOut: boolean;
  suppressNextReturnTo: boolean;
  consumeSuppressNextReturnTo: () => void;
  signIn: (credentials: LoginCredentials) => Promise<AuthSession>;
  signOut: () => Promise<void>;
  retrySessionRestore: () => Promise<void>;
  clearLogoutError: () => void;
  clearSessionNotice: () => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
