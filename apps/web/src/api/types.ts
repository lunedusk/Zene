

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: {
    requestId?: string;
    [key: string]: unknown;
  };
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiErrorBody;

export type DashHttpStatus =
  | 200
  | 201
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 429
  | 500
  | 502
  | 503
  | 504;

export class DashApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'DashApiError';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export interface SessionUser {
  id: string;
  username?: string;
  discriminator?: string;
  avatar?: string | null;
  bits?: string[];
  isBotOwner?: boolean;
}

export interface RegistrySurface {
  id: string;
  pluginId: string;
  label?: string;
  path?: string;
  icon?: string;
}

export interface RegistrySnapshot {
  plugins: Array<{
    pluginId: string;
    surfaces: RegistrySurface[];
  }>;
  version?: number | string;
}
