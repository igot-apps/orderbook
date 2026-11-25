import { ApiError } from './api';
import { supabase } from './supabase';

/** Calls the Paystack Edge Function (supabase/functions/paystack) as the signed-in user. */
export async function paystackAction<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new ApiError(503, 'Online payments are only available on the online version.');
  const { data, error } = await supabase.functions.invoke('paystack', { body });
  if (error) {
    let status = 500;
    let message = 'The payment service did not respond. Please try again.';
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      status = ctx.status;
      try {
        message = (await ctx.json()).error || message;
      } catch {
        /* keep the default message */
      }
    }
    throw new ApiError(status, message);
  }
  return data as T;
}

/** Paystack sends the customer back here with ?order=…&reference=… (see main.tsx). */
export function paystackReturnUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

/** Turns a Paystack return (?order=…&reference=…) into the order's payment page, which verifies it. */
export function routePaystackReturn() {
  const params = new URLSearchParams(window.location.search);
  const order = params.get('order');
  const reference = params.get('reference') || params.get('trxref');
  if (!order || !reference) return;
  const hash = `#/pay/${encodeURIComponent(order)}?reference=${encodeURIComponent(reference)}`;
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}
