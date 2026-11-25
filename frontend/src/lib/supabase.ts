import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase is the backend when both values are set (GitHub Pages build). */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: window.sessionStorage,
          storageKey: 'op_sb_session',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;

/** Phone logins are stored in Supabase Auth as email-shaped identifiers (no SMS needed). */
export function phoneEmail(phone: string) {
  return `p${phone.replace(/\D/g, '')}@phone.orderbook.app`;
}

const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** Database timestamps are UTC without a zone suffix; mark them as UTC like the old API did. */
export function utcDates<T>(value: T): T {
  if (typeof value === 'string') return (NAIVE_ISO.test(value) ? `${value}Z` : value) as T;
  if (Array.isArray(value)) return value.map(utcDates) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = utcDates(v);
    return out as T;
  }
  return value;
}
