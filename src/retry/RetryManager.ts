import type { RetryOptions, Logger } from '../types';

/**
 * Generic retry executor with configurable backoff and jitter.
 *
 * Used by both the DetectionEngine and ActionEngine to provide
 * resilient execution with graceful degradation.
 */
export class RetryManager {
  private _log: Logger;

  constructor(logger: Logger) {
    this._log = logger;
  }

  /**
   * Execute `fn` with retries according to the given options.
   *
   * @returns The result of `fn`, or throws after all attempts exhausted.
   */
  async execute<T>(
      label: string,
      options: RetryOptions,
      fn: (attempt: number) => Promise<T>,
      shouldRetry: (error: unknown, result: T) => boolean = () => false,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        const result = await fn(attempt);
        if (!shouldRetry(undefined, result))
          return result;

        this._log.debug('RetryManager', `${label}: attempt ${attempt}/${options.maxAttempts} — retrying based on result`);
      } catch (e) {
        lastError = e;
        this._log.warn('RetryManager', `${label}: attempt ${attempt}/${options.maxAttempts} failed`, {
          error: String(e),
        });
      }

      if (attempt < options.maxAttempts) {
        const delay = this._computeDelay(attempt, options);
        this._log.debug('RetryManager', `${label}: waiting ${delay}ms before attempt ${attempt + 1}`);
        await this._sleep(delay);
      }
    }

    throw new Error(`${label}: all ${options.maxAttempts} attempts exhausted. Last error: ${lastError}`);
  }

  // "fire once" — returns result or null, never throws.
  async tryOnce<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this._log.warn('RetryManager', `${label}: single attempt failed`, { error: String(e) });
      return null;
    }
  }

  // -----------------------------------------------------------------------

  private _computeDelay(attempt: number, options: RetryOptions): number {
    let delay: number;
    switch (options.backoff) {
      case 'fixed':
        delay = options.baseDelayMs;
        break;
      case 'linear':
        delay = options.baseDelayMs * attempt;
        break;
      case 'exponential':
        delay = options.baseDelayMs * Math.pow(2, attempt - 1);
        break;
    }

    // Clamp
    delay = Math.min(delay, options.maxDelayMs);

    // Jitter
    if (options.jitter > 0) {
      const jitterRange = delay * options.jitter;
      delay += (Math.random() * 2 - 1) * jitterRange;
      delay = Math.max(0, delay);
    }

    return Math.round(delay);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
