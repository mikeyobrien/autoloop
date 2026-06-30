// Classify a backend's error output into a typed, actionable class. An
// unclassified transient outage is a trust failure (it can be laundered into a
// confident verdict or kill a run as a generic backend_failed), so the harness
// keys retry/quarantine/circuit-breaker behavior off these classes.

export type BackendErrorClass =
  | "rate_limited"
  | "quota_exhausted"
  | "auth_failed"
  | "transient_error"
  | "none";

/**
 * Map raw backend error text to a {@link BackendErrorClass}. Deterministic and
 * order-sensitive: more specific/actionable classes win over generic transient
 * patterns (e.g. an explicit 429 is `rate_limited`, not `transient_error`;
 * quota beats auth). Returns `none` when nothing matches.
 */
export function classifyBackendError(text: string): BackendErrorClass {
  if (!text) return "none";
  const t = text.toLowerCase();

  // Quota / billing exhaustion — won't self-resolve on retry.
  if (
    /\bquota\b/.test(t) ||
    /insufficient[_\s-]*(quota|credit|credits|funds|balance)/.test(t) ||
    /exceeded your current quota/.test(t) ||
    /billing|payment required|\b402\b/.test(t) ||
    /(usage|credit|spend)[_\s-]*(limit|cap)\s*(reached|exceeded)/.test(t)
  ) {
    return "quota_exhausted";
  }

  // Rate limiting — retryable after a delay.
  if (
    /\b429\b/.test(t) ||
    /rate[_\s-]?limit/.test(t) ||
    /too many requests/.test(t) ||
    /retry[-_\s]?after/.test(t)
  ) {
    return "rate_limited";
  }

  // Authentication / authorization — won't self-resolve on retry.
  if (
    /\b401\b/.test(t) ||
    /\b403\b/.test(t) ||
    /unauthorized/.test(t) ||
    /authentication (failed|error|required)/.test(t) ||
    /invalid (api[_\s-]?key|token|credentials)/.test(t) ||
    /(api[_\s-]?key|token).*(invalid|expired|missing)/.test(t) ||
    /forbidden/.test(t)
  ) {
    return "auth_failed";
  }

  // Transient server/network errors — retryable.
  if (
    /\b5(00|02|03|04|29)\b/.test(t) ||
    /overloaded/.test(t) ||
    /service unavailable/.test(t) ||
    /temporarily unavailable/.test(t) ||
    /(gateway )?timeout/.test(t) ||
    /\b(econnreset|etimedout|enotfound|eai_again|econnrefused|epipe)\b/.test(
      t,
    ) ||
    /socket hang ?up/.test(t) ||
    /connection (reset|refused|closed|error)/.test(t)
  ) {
    return "transient_error";
  }

  return "none";
}

/** Whether a class is potentially retryable (rate-limit / transient outage). */
export function isRetryableErrorClass(cls: BackendErrorClass): boolean {
  return cls === "rate_limited" || cls === "transient_error";
}
