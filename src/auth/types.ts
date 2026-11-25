export type UserRole = 'OWNER' | 'WORKER';

export interface AuthSession {
  userId: string;
  name: string;
  role: UserRole;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable';
