export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = 'APP_ERROR', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown) {
  return new AppError(400, message, 'BAD_REQUEST', details);
}

export function unauthorized(message = 'Unauthorized') {
  return new AppError(401, message, 'UNAUTHORIZED');
}

export function forbidden(message = 'Forbidden') {
  return new AppError(403, message, 'FORBIDDEN');
}

export function notFound(message = 'Not found') {
  return new AppError(404, message, 'NOT_FOUND');
}

export function conflict(message: string, details?: unknown) {
  return new AppError(409, message, 'CONFLICT', details);
}
