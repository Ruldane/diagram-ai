/** PostgreSQL / socket error codes worth retrying: the same statement can succeed a moment later. */
const TRANSIENT_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53000", // insufficient_resources
  "53100", // disk_full
  "53200", // out_of_memory
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "55P03", // lock_not_available
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (starting up)
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

/** pg-pool and pg raise some connection failures without a code. */
const TRANSIENT_MESSAGE = /connection terminated|timeout exceeded when trying to connect|client was closed|connection error|the database system is (starting up|shutting down)/i;

/** Whether a failed database call may succeed if repeated (connection trouble, restarts, deadlocks) as opposed to bad data or a missing table. */
export function isTransientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  // Class 08 is "connection exception".
  if (typeof code === "string" && (TRANSIENT_CODES.has(code) || code.startsWith("08"))) return true;
  return typeof message === "string" && TRANSIENT_MESSAGE.test(message);
}

/** One-line description of an error for logs: no stack, no connection details. */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) return describeError(error.errors[0]);
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && !error.message.includes(code) ? `${error.message} (${code})` : error.message || error.name;
  }
  return String(error);
}
