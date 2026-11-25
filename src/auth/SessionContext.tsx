import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiClient, type ApiClient } from '../api/client.ts';
import { isAbortError, isApiClientError, type ApiClientError } from '../api/errors.ts';
import { authApi, createAuthApi, type AuthApi } from './authApi.ts';
import type { AuthSession, AuthStatus, LoginCredentials } from './types.ts';
import { SessionContext, type SessionContextValue } from './useSession.ts';

export interface SessionProviderProps {
  children: ReactNode;
  client?: ApiClient;
  api?: AuthApi;
}

export function SessionProvider({
  children,
  client = apiClient,
  api,
}: SessionProviderProps) {
  const resolvedAuthApi = useMemo(
    () => api ?? (client === apiClient ? authApi : createAuthApi(client)),
    [api, client],
  );

  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionError, setSessionError] = useState<ApiClientError | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<ApiClientError | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [suppressNextReturnTo, setSuppressNextReturnTo] = useState(false);

  const inFlightSignInRef = useRef<Promise<AuthSession> | null>(null);
  const inFlightLogoutRef = useRef<Promise<void> | null>(null);
  const restoreIdRef = useRef(0);

  const runRestore = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++restoreIdRef.current;
      try {
        const restored = await resolvedAuthApi.restoreSession(signal);
        if (requestId !== restoreIdRef.current || signal?.aborted) {
          return;
        }

        if (restored) {
          setSession(restored);
          setStatus('authenticated');
          setSessionNotice(null);
          setLogoutError(null);
          setSuppressNextReturnTo(false);
        } else {
          setSession(null);
          setStatus('unauthenticated');
        }
      } catch (error) {
        if (isAbortError(error) || signal?.aborted || requestId !== restoreIdRef.current) {
          return;
        }
        setSession(null);
        setStatus('unavailable');
        setSessionError(isApiClientError(error) ? error : null);
      }
    },
    [resolvedAuthApi],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++restoreIdRef.current;

    resolvedAuthApi
      .restoreSession(controller.signal)
      .then((restored) => {
        if (requestId !== restoreIdRef.current || controller.signal.aborted) {
          return;
        }
        if (restored) {
          setSession(restored);
          setStatus('authenticated');
          setSessionNotice(null);
          setLogoutError(null);
          setSuppressNextReturnTo(false);
        } else {
          setSession(null);
          setStatus('unauthenticated');
        }
      })
      .catch((error: unknown) => {
        if (
          isAbortError(error) ||
          controller.signal.aborted ||
          requestId !== restoreIdRef.current
        ) {
          return;
        }
        setSession(null);
        setStatus('unavailable');
        setSessionError(isApiClientError(error) ? error : null);
      });

    return () => {
      controller.abort();
    };
  }, [resolvedAuthApi]);

  useEffect(() => {
    return client.setUnauthorizedHandler(() => {
      restoreIdRef.current += 1;
      setSession(null);
      setStatus('unauthenticated');
      setSessionError(null);
      setLogoutError(null);
      setIsLoggingOut(false);
      setSuppressNextReturnTo(false);
      setSessionNotice('Your session expired or was signed out. Please sign in again.');
    });
  }, [client]);

  const retrySessionRestore = useCallback(async () => {
    setStatus('loading');
    setSessionError(null);
    await runRestore();
  }, [runRestore]);

  const signIn = useCallback(
    async (credentials: LoginCredentials): Promise<AuthSession> => {
      if (inFlightSignInRef.current) {
        return inFlightSignInRef.current;
      }

      const signInPromise = (async () => {
        setSessionNotice(null);
        setLogoutError(null);
        setSuppressNextReturnTo(false);
        try {
          const nextSession = await resolvedAuthApi.signIn(credentials);
          restoreIdRef.current += 1;
          setSession(nextSession);
          setStatus('authenticated');
          setSessionError(null);
          return nextSession;
        } catch (error) {
          if (isApiClientError(error) && error.kind === 'network') {
            setSessionError(error);
          } else {
            setSessionError(null);
            setStatus((prev) => (prev === 'unavailable' ? 'unauthenticated' : prev));
          }
          throw error;
        }
      })();

      inFlightSignInRef.current = signInPromise;
      try {
        return await signInPromise;
      } finally {
        if (inFlightSignInRef.current === signInPromise) {
          inFlightSignInRef.current = null;
        }
      }
    },
    [resolvedAuthApi],
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (inFlightLogoutRef.current) {
      return inFlightLogoutRef.current;
    }

    const logoutPromise = (async () => {
      setIsLoggingOut(true);
      setLogoutError(null);
      try {
        await resolvedAuthApi.signOut();
        restoreIdRef.current += 1;
        setSuppressNextReturnTo(true);
        setSession(null);
        setStatus('unauthenticated');
        setSessionError(null);
        setSessionNotice(null);
      } catch (error) {
        // If the server returned 401 on logout, the global unauthorized handler
        // already cleared the local session; otherwise preserve session for retry.
        if (isApiClientError(error) && error.kind !== 'unauthorized') {
          setLogoutError(error);
        } else if (!isApiClientError(error)) {
          setLogoutError(null);
        }
        throw error;
      } finally {
        setIsLoggingOut(false);
      }
    })();

    inFlightLogoutRef.current = logoutPromise;
    try {
      await logoutPromise;
    } finally {
      if (inFlightLogoutRef.current === logoutPromise) {
        inFlightLogoutRef.current = null;
      }
    }
  }, [resolvedAuthApi]);

  const consumeSuppressNextReturnTo = useCallback(() => {
    setSuppressNextReturnTo(false);
  }, []);

  const clearLogoutError = useCallback(() => {
    setLogoutError(null);
  }, []);

  const clearSessionNotice = useCallback(() => {
    setSessionNotice(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      sessionError,
      sessionNotice,
      logoutError,
      isLoggingOut,
      suppressNextReturnTo,
      consumeSuppressNextReturnTo,
      signIn,
      signOut,
      retrySessionRestore,
      clearLogoutError,
      clearSessionNotice,
    }),
    [
      status,
      session,
      sessionError,
      sessionNotice,
      logoutError,
      isLoggingOut,
      suppressNextReturnTo,
      consumeSuppressNextReturnTo,
      signIn,
      signOut,
      retrySessionRestore,
      clearLogoutError,
      clearSessionNotice,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
