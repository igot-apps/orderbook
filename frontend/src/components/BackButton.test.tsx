import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Page } from './ui';

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
const renderAt = (entries: string[]) =>
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes><Route path="*" element={<><Where /><Page title="T">x</Page></>} /></Routes>
    </MemoryRouter>,
  );

describe('Back arrow', () => {
  it('is hidden on main tab pages', () => {
    for (const p of ['/seller', '/seller/orders', '/customer', '/customer/more']) {
      const { unmount } = renderAt([p]);
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
      unmount();
    }
  });
  it('goes to the parent page when opened directly', () => {
    renderAt(['/seller/reports']);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where').textContent).toBe('/seller/more');
  });
  it('order detail falls back to the order list', () => {
    renderAt(['/customer/orders/abc']);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where').textContent).toBe('/customer/orders');
  });
});
