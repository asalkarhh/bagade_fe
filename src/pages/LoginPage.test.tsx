import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../api/errors.ts';
import type { AuthApi } from '../auth/authApi.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import { createApiClient } from '../api/client.ts';
import { LoginPage } from './LoginPage.tsx';

function renderLoginWithApi(api: AuthApi) {
  const client = createApiClient({ fetchImpl: vi.fn() as unknown as typeof fetch });
  return render(
    <SessionProvider client={client} api={api}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('LoginPage', () => {
  it('validates empty fields, supports show/hide password, and focuses first invalid input', async () => {
    const user = userEvent.setup();
    const api: AuthApi = {
      restoreSession: vi.fn(async () => null),
      signIn: vi.fn(),
      signOut: vi.fn(),
    };

    renderLoginWithApi(api);

    const submitButton = await screen.findByRole('button', { name: 'Sign in' });
    await user.click(submitButton);

    expect(screen.getByText('Enter your username.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/)).toHaveFocus();
    expect(api.signIn).not.toHaveBeenCalled();

    const passwordInput = screen.getByLabelText(/^Password/);
    expect(passwordInput).toHaveAttribute('type', 'password');
    const toggleBtn = screen.getByRole('button', { name: 'Show password' });
    await user.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('prevents duplicate submissions while pending and supports keyboard Enter submission', async () => {
    const user = userEvent.setup();
    let resolveSignIn!: (value: { userId: string; name: string; role: 'OWNER' }) => void;
    const signInMock = vi.fn(
      () =>
        new Promise<{ userId: string; name: string; role: 'OWNER' }>((resolve) => {
          resolveSignIn = resolve;
        }),
    );

    const api: AuthApi = {
      restoreSession: vi.fn(async () => null),
      signIn: signInMock,
      signOut: vi.fn(),
    };

    renderLoginWithApi(api);

    const usernameInput = await screen.findByLabelText(/Username/);
    const passwordInput = screen.getByLabelText(/^Password/);

    await user.type(usernameInput, 'owner1');
    await user.type(passwordInput, 'OwnerPass123!{Enter}');

    expect(signInMock).toHaveBeenCalledTimes(1);
    const pendingBtn = screen.getByRole('button', { name: 'Signing in…' });
    expect(pendingBtn).toBeDisabled();

    await user.click(pendingBtn);
    expect(signInMock).toHaveBeenCalledTimes(1);

    resolveSignIn({ userId: 'u-1', name: 'Shop Owner', role: 'OWNER' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    });
  });

  it('displays distinct messages for invalid credentials, backend unavailability, and CSRF rejection', async () => {
    const user = userEvent.setup();
    let mode: 'invalid' | 'unavailable' | 'csrf' = 'invalid';

    const api: AuthApi = {
      restoreSession: vi.fn(async () => null),
      signIn: vi.fn(async () => {
        if (mode === 'invalid') {
          throw new ApiClientError({
            kind: 'unauthorized',
            status: 401,
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
            requestId: 'req-bad-creds',
          });
        }
        if (mode === 'unavailable') {
          throw new ApiClientError({
            kind: 'network',
            status: 503,
            code: 'BACKEND_UNAVAILABLE',
            message: 'Unable to reach the server.',
            retryable: true,
          });
        }
        throw new ApiClientError({
          kind: 'csrf',
          status: 403,
          code: 'CSRF_ERROR',
          message: 'Invalid or missing CSRF token',
          requestId: 'req-csrf-err',
        });
      }),
      signOut: vi.fn(),
    };

    renderLoginWithApi(api);

    const usernameInput = await screen.findByLabelText(/Username/);
    const passwordInput = screen.getByLabelText(/^Password/);
    await user.type(usernameInput, 'owner1');
    await user.type(passwordInput, 'wrong');

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const invalidMsg = await screen.findByText(/Invalid username or password/i);
    expect(invalidMsg).toBeInTheDocument();

    mode = 'unavailable';
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const unavailableMsg = await screen.findByText(/Unable to reach the backend server/i);
    expect(unavailableMsg.textContent).not.toEqual(invalidMsg.textContent);

    mode = 'csrf';
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Security verification failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req-csrf-err/)).toBeInTheDocument();
  });

  it('supports keyboard Tab order across form controls and maps backend fieldErrors', async () => {
    const user = userEvent.setup();
    const api: AuthApi = {
      restoreSession: vi.fn(async () => null),
      signIn: vi.fn(async () => {
        throw new ApiClientError({
          kind: 'validation',
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          requestId: 'req-val',
          fieldErrors: [{ field: 'username', message: 'Username is required' }],
        });
      }),
      signOut: vi.fn(),
    };

    renderLoginWithApi(api);

    const usernameInput = await screen.findByLabelText(/Username/);
    const passwordInput = screen.getByLabelText(/^Password/);
    const showPasswordBtn = screen.getByRole('button', { name: 'Show password' });
    const submitBtn = screen.getByRole('button', { name: 'Sign in' });

    await user.tab();
    expect(usernameInput).toHaveFocus();
    await user.type(usernameInput, 'u');
    await user.tab();
    expect(passwordInput).toHaveFocus();
    await user.type(passwordInput, 'p');
    await user.tab();
    expect(showPasswordBtn).toHaveFocus();
    await user.tab();
    expect(submitBtn).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(await screen.findByText('Username is required')).toBeInTheDocument();
    expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
  });
});
