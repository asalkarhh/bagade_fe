import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isApiClientError } from '../api/errors.ts';
import { useSession } from '../auth/useSession.ts';
import { resolvePostLoginPath } from '../navigation/navItems.ts';
import './LoginPage.css';

interface LocationStateWithFrom {
  from?: unknown;
}

interface FieldErrorsState {
  username?: string;
  password?: string;
}

interface FormBannerState {
  message: string;
  requestId?: string | null;
}

function formatLoginError(error: unknown): {
  banner: FormBannerState;
  fields: FieldErrorsState;
} {
  if (!isApiClientError(error)) {
    return {
      banner: {
        message: 'Sign-in failed unexpectedly. Please try again.',
      },
      fields: {},
    };
  }

  if (error.kind === 'network') {
    return {
      banner: {
        message:
          'Unable to reach the backend server. Confirm the server is running and try again.',
        requestId: error.requestId,
      },
      fields: {},
    };
  }

  if (error.kind === 'unauthorized' && error.code === 'INVALID_CREDENTIALS') {
    return {
      banner: {
        message:
          'Invalid username or password. Check your credentials and try again.',
        requestId: error.requestId,
      },
      fields: {},
    };
  }

  if (error.kind === 'csrf') {
    return {
      banner: {
        message:
          'Security verification failed (CSRF token rejected or expired). Submit again to retry with a fresh token.',
        requestId: error.requestId,
      },
      fields: {},
    };
  }

  if (error.kind === 'validation') {
    const fields: FieldErrorsState = {};
    for (const item of error.fieldErrors) {
      if (item.field === 'username' && !fields.username) {
        fields.username = item.message;
      } else if (item.field === 'password' && !fields.password) {
        fields.password = item.message;
      }
    }
    return {
      banner: {
        message:
          error.fieldErrors.length > 0
            ? 'Please enter both username and password.'
            : error.message,
        requestId: error.requestId,
      },
      fields,
    };
  }

  return {
    banner: {
      message: error.message || 'Sign-in request was rejected by the server.',
      requestId: error.requestId,
    },
    fields: {},
  };
}

export function LoginPage() {
  const { status, sessionError, sessionNotice, signIn, retrySessionRestore } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  const headingId = useId();
  const usernameId = useId();
  const usernameErrorId = useId();
  const passwordId = useId();
  const passwordErrorId = useId();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [edited, setEdited] = useState({ username: false, password: false });
  const [fieldErrors, setFieldErrors] = useState<FieldErrorsState>({});
  const [submitError, setSubmitError] = useState<FormBannerState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submittingRef = useRef(false);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.title = 'Sign in | Bagade Clothing';
  }, []);

  const validateField = (field: 'username' | 'password', value: string): string | undefined => {
    if (field === 'username') {
      return value.trim().length === 0 ? 'Enter your username.' : undefined;
    }
    return value.length === 0 ? 'Enter your password.' : undefined;
  };

  const handleUsernameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setUsername(nextValue);
    setEdited((prev) => (prev.username ? prev : { ...prev, username: true }));
    if (fieldErrors.username && !validateField('username', nextValue)) {
      setFieldErrors((prev) => ({ ...prev, username: undefined }));
    }
    if (submitError) {
      setSubmitError(null);
    }
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setPassword(nextValue);
    setEdited((prev) => (prev.password ? prev : { ...prev, password: true }));
    if (fieldErrors.password && !validateField('password', nextValue)) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (submitError) {
      setSubmitError(null);
    }
  };

  const handleBlur = (field: 'username' | 'password') => (_event: FocusEvent<HTMLInputElement>) => {
    if (!edited[field]) {
      return;
    }
    const value = field === 'username' ? username : password;
    const message = validateField(field, value);
    setFieldErrors((prev) => ({ ...prev, [field]: message }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current || isSubmitting) {
      return;
    }

    const usernameMessage = validateField('username', username);
    const passwordMessage = validateField('password', password);
    if (usernameMessage || passwordMessage) {
      setFieldErrors({
        username: usernameMessage,
        password: passwordMessage,
      });
      setSubmitError({
        message: 'Enter both your username and password to sign in.',
      });
      if (usernameMessage) {
        usernameInputRef.current?.focus();
      } else {
        passwordInputRef.current?.focus();
      }
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);

    try {
      const nextSession = await signIn({
        username: username.trim(),
        password,
      });
      const state = location.state as LocationStateWithFrom | null;
      const target = resolvePostLoginPath(state?.from, nextSession.role);
      navigate(target, { replace: true });
    } catch (error) {
      const formatted = formatLoginError(error);
      setSubmitError(formatted.banner);
      if (formatted.fields.username || formatted.fields.password) {
        setFieldErrors(formatted.fields);
        if (formatted.fields.username) {
          usernameInputRef.current?.focus();
        } else {
          passwordInputRef.current?.focus();
        }
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const showUnavailableNotice =
    status === 'unavailable' && !submitError && sessionError !== null;

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby={headingId}>
        <div className="login-brand">
          <span className="login-brand__mark" aria-hidden="true">
            B
          </span>
          <div>
            <h1 id={headingId} tabIndex={-1}>
              Sign in
            </h1>
            <p className="login-brand__subtitle">Bagade Clothing — Inventory &amp; Billing</p>
          </div>
        </div>

        {sessionNotice ? (
          <div className="alert-banner alert-banner--info" role="status">
            <svg
              className="alert-banner__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <div className="alert-banner__content">
              <p>{sessionNotice}</p>
            </div>
          </div>
        ) : null}

        {showUnavailableNotice ? (
          <div className="alert-banner alert-banner--warning" role="status">
            <svg
              className="alert-banner__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="alert-banner__content">
              <p>{sessionError.message}</p>
              <div className="alert-banner__actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    void retrySessionRestore();
                  }}
                >
                  Retry connection
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {submitError ? (
          <div className="alert-banner alert-banner--error" role="alert">
            <svg
              className="alert-banner__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="alert-banner__content">
              <p>{submitError.message}</p>
              {submitError.requestId ? (
                <p className="alert-banner__meta">Request ID: {submitError.requestId}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <form className="login-form" onSubmit={handleSubmit} noValidate aria-labelledby={headingId}>
          <div className="form-field">
            <label htmlFor={usernameId} className="form-label">
              Username <span className="form-required" aria-hidden="true">*</span>
            </label>
            <input
              ref={usernameInputRef}
              id={usernameId}
              name="username"
              type="text"
              className="form-input"
              value={username}
              onChange={handleUsernameChange}
              onBlur={handleBlur('username')}
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              required
              aria-invalid={fieldErrors.username ? 'true' : 'false'}
              aria-describedby={fieldErrors.username ? usernameErrorId : undefined}
            />
            {fieldErrors.username ? (
              <p id={usernameErrorId} className="field-error">
                <span aria-hidden="true">!</span>
                <span>{fieldErrors.username}</span>
              </p>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor={passwordId} className="form-label">
              Password <span className="form-required" aria-hidden="true">*</span>
            </label>
            <div className="password-input-row">
              <input
                ref={passwordInputRef}
                id={passwordId}
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={password}
                onChange={handlePasswordChange}
                onBlur={handleBlur('password')}
                autoComplete="current-password"
                enterKeyHint="done"
                required
                aria-invalid={fieldErrors.password ? 'true' : 'false'}
                aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
              />
              <button
                type="button"
                className="password-toggle"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {fieldErrors.password ? (
              <p id={passwordErrorId} className="field-error">
                <span aria-hidden="true">!</span>
                <span>{fieldErrors.password}</span>
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            className="btn-primary login-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
