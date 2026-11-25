import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from './components/ui';
import { toast } from './lib/toast';
import { AuthProvider } from './lib/auth';
import App from './App';
import { PinGate } from './components/PinLock';
import { installNumberInputWheelGuard } from './lib/numberInputWheel';
import { routePaystackReturn } from './lib/payments';
import './index.css';

installNumberInputWheelGuard();
routePaystackReturn();
const Router = import.meta.env.MODE === 'github' ? HashRouter : BrowserRouter;

const liveQueryKeys = new Set([
  'order', 'customer-orders', 'seller-orders', 'customer-dashboard', 'seller-dashboard',
  'my-notifications', 'my-payments', 'payments', 'pay', 'delivery-orders', 'customer',
  'customers',
]);

// Any mutation can declare meta: { success: 'Saved' } to get a toast automatically.
const mutationCache = new MutationCache({
  onSuccess: (_data, _vars, _ctx, mutation) => {
    const msg = mutation.meta?.success;
    if (typeof msg === 'string') toast.success(msg);
    // Refresh all dependent views, including lists with different query keys.
    void queryClient.invalidateQueries();
  },
  onError: (error, _vars, _ctx, mutation) => {
    if (mutation.meta?.silentError) return;
    toast.error(error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.');
  },
});

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Only active operational screens poll; hidden tabs pause automatically.
      refetchInterval: (query) => {
        const key = String(query.queryKey[0]);
        if (!liveQueryKeys.has(key)) return false;
        return key === 'order' || key === 'pay' || key === 'my-notifications' ? 5_000 : 15_000;
      },
      refetchIntervalInBackground: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <PinGate>
            <App />
          </PinGate>
          <Toaster />
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
