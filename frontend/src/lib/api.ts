import { supabase, utcDates } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export type User = {
  id: string;
  name: string;
  phone: string;
  role: 'SELLER' | 'CUSTOMER';
  businessId: string;
  customerId?: string;
};

export function getStoredToken() {
  return sessionStorage.getItem('op_token');
}

export function setAuth(token: string, user: User) {
  sessionStorage.setItem('op_token', token);
  sessionStorage.setItem('op_user', JSON.stringify(user));
  // Remove credentials from older builds. localStorage is shared by every tab
  // and caused customer and seller sessions to overwrite one another.
  localStorage.removeItem('op_token');
  localStorage.removeItem('op_user');
}

export function clearAuth() {
  sessionStorage.removeItem('op_token');
  sessionStorage.removeItem('op_user');
  localStorage.removeItem('op_token');
  localStorage.removeItem('op_user');
}

export function getStoredUser(): User | null {
  const raw = sessionStorage.getItem('op_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function handleUnauthorized(path: string) {
  if (path === '/auth/login') return;
  clearAuth();
  void supabase?.auth.signOut();
  if (window.location.pathname !== '/login' && !window.location.hash.startsWith('#/login')) {
    window.location.assign(import.meta.env.MODE === 'github' ? `${import.meta.env.BASE_URL}#/login` : '/login');
  }
}

/** Calls the Supabase `api` SQL function, which mirrors the old REST endpoints. */
async function rpcApi<T>(path: string, options: RequestInit): Promise<T> {
  const [route, search = ''] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(search));
  let body: unknown = {};
  if (typeof options.body === 'string' && options.body) body = JSON.parse(options.body);
  const { data, error } = await supabase!.rpc('api', {
    p_method: (options.method || 'GET').toUpperCase(),
    p_path: route,
    p_query: query,
    p_body: body,
  });
  if (error) {
    const hinted = Number(error.hint);
    const status = hinted >= 400 && hinted < 600 ? hinted : error.code === '42501' || error.code === 'PGRST301' ? 401 : 400;
    if (status === 401) handleUnauthorized(path);
    throw new ApiError(status, error.message || 'Request failed', error.code);
  }
  return utcDates(data) as T;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (supabase) return rpcApi<T>(path, options);
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw new ApiError(
      res.status,
      data?.error || res.statusText,
      data?.code,
      data?.details
    );
  }
  return data as T;
}
