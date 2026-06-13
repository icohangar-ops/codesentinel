/**
 * Vendored from cubiczan-resilience (typescript/src/errors.ts), ported to
 * CommonJS so it can be `require`d by this plain-JS repo. Semantics preserved.
 *
 * Discriminated reasons a resilient operation can ultimately fail:
 *  - "timeout"   — an attempt exceeded its allotted time budget.
 *  - "network"   — the underlying transport (e.g. fetch) threw / connection failed.
 *  - "http"      — the server returned a non-OK status that we treat as a failure.
 *  - "ssrf"      — the target host was rejected by the SSRF allowlist hook.
 *  - "exhausted" — all retry attempts were used up.
 *  - "aborted"   — the caller's own AbortSignal aborted the operation.
 */

class ResilienceError extends Error {
  constructor(kind, message, options = {}) {
    super(message);
    this.name = "ResilienceError";
    this.kind = kind;
    this.attempts = options.attempts ?? 1;
    this.status = options.status;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, ResilienceError.prototype);
  }
}

/** Type guard for ResilienceError. */
function isResilienceError(value) {
  return value instanceof ResilienceError;
}

module.exports = { ResilienceError, isResilienceError };
