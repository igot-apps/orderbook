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

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
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
    if (res.status === 401 && path !== '/auth/login') {
      clearAuth();
      if (window.location.pathname !== '/login') {
        window.location.assign(import.meta.env.MODE === 'github' ? `${import.meta.env.BASE_URL}#/login` : '/login');
      }
    }
    throw new ApiError(
      res.status,
      data?.error || res.statusText,
      data?.code,
      data?.details
    );
  }
  return data as T;
}
