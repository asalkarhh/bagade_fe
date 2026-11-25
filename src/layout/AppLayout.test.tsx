import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client.ts';
import type { AuthApi } from '../auth/authApi.ts';
import { SessionProvider } from '../auth/SessionContext.tsx';
import type { AuthSession } from '../auth/types.ts';
import { AppLayout } from './AppLayout.tsx';

function renderLayout(session: AuthSession, initialPath = '/billing') {
  const client = createApiClient({ fetchImpl: vi.fn() as unknown as typeof fetch });
  const api: AuthApi = {
    restoreSession: vi.fn(async () => session),
    signIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
  };

  return render(
    <SessionProvider client={client} api={api}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/billing" element={<h1>Billing</h1>} />
            <Route path="/inventory" element={<h1>Inventory</h1>} />
            <Route path="/reports" element={<h1>Reports</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('AppLayout responsive navigation', () => {
  it('renders inline navigation when links fit and switches to popover Menu when nav overflows', async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    let navClientWidth = 1024;
    let navScrollWidth = 620;
    let headerWidth = 1280;

    renderLayout({ userId: 'u-1', name: 'Shop Owner', role: 'OWNER' }, '/billing');

    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeInTheDocument();

    const header = screen.getByRole('banner');
    const navRow = header.querySelector('.header-nav-row') as HTMLElement;
    const menuList = document.getElementById('primary-nav-menu') as HTMLUListElement;

    Object.defineProperty(header, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: headerWidth, height: 100, top: 0, left: 0, bottom: 100, right: headerWidth }),
    });
    Object.defineProperty(navRow, 'clientWidth', {
      configurable: true,
      get: () => navClientWidth,
    });
    Object.defineProperty(navRow, 'scrollWidth', {
      configurable: true,
      get: () => navScrollWidth,
    });

    // Wide laptop width: inline mode
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(header).toHaveClass('is-wide');
    expect(menuList).not.toHaveAttribute('popover');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const billingLink = within(nav).getByRole('link', { name: 'Billing' });
    expect(billingLink).toHaveAttribute('aria-current', 'page');

    // Narrow phone width: collapses into popover menu
    navClientWidth = 340;
    navScrollWidth = 620;
    headerWidth = 375;

    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(header).not.toHaveClass('is-wide');
    expect(menuList).toHaveAttribute('popover', 'auto');
    expect(within(nav).getByRole('button', { name: 'Menu' })).toHaveAttribute(
      'aria-controls',
      'primary-nav-menu',
    );

    // Growing back to laptop width restores inline mode
    navClientWidth = 1024;
    headerWidth = 1280;
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(header).toHaveClass('is-wide');
    expect(menuList).not.toHaveAttribute('popover');

    vi.unstubAllGlobals();
  });
});
