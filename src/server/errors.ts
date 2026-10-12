export type ServiceErrorCode = "not_found" | "invalid" | "conflict" | "forbidden" | "unauthenticated" | "rate_limited";

/** An expected failure with a message that is safe (and useful) to show to a user or an agent. */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what: string): ServiceError => new ServiceError("not_found", what);
export const invalid = (message: string): ServiceError => new ServiceError("invalid", message);

export const HTTP_STATUS: Record<ServiceErrorCode, number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  forbidden: 403,
  unauthenticated: 401,
  rate_limited: 429,
};

export const conflict = (message: string): ServiceError => new ServiceError("conflict", message);
export const forbidden = (message: string): ServiceError => new ServiceError("forbidden", message);
/** No valid credentials. The browser answers it by showing the sign-in page; agents by sending a token. */
export const unauthenticated = (message = "Sign in to continue."): ServiceError => new ServiceError("unauthenticated", message);
