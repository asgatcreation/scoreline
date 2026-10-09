import { Logger } from '@nestjs/common';
import { QuotaTracker } from './quota.js';
import type { ProviderName } from './types.js';

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly kind: 'quota' | 'rate-limit' | 'http' | 'plan' | 'network' | 'not-found',
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** Where the daily request count is saved so restarts don't forget it. */
export interface UsageStore {
  load(provider: ProviderName, day: string): Promise<number>;
  increment(provider: ProviderName, day: string, error?: string): Promise<void>;
}

export interface ProviderHttpOptions {
  provider: ProviderName;
  baseUrl: string;
  headers: Record<string, string>;
  quota: QuotaTracker;
  usage?: UsageStore;
  /** Wait up to this long for a free slot instead of failing. */
  maxWaitMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Read remaining-quota headers and plan errors from the response. */
  inspect?: (res: Response, body: unknown) => { remaining?: number; error?: string };
}

/**
 * The only way adapters talk to a provider. Every request is counted,
 * spaced to the plan's limits, and backed off on errors or 429s.
 */
export class ProviderHttp {
  private readonly logger: Logger;
  private restored = false;

  constructor(private readonly opts: ProviderHttpOptions) {
    this.logger = new Logger(`Http:${opts.provider}`);
  }

  get quota(): QuotaTracker {
    return this.opts.quota;
  }

  async get<T>(path: string): Promise<T> {
    const { quota, provider } = this.opts;
    await this.restoreUsage();

    const wait = quota.waitMs();
    if (wait > 0) {
      if (wait > (this.opts.maxWaitMs ?? 0)) {
        throw new ProviderError(
          provider,
          'quota',
          `no request budget for ${Math.ceil(wait / 1000)}s`,
          wait,
        );
      }
      await sleep(wait);
    }

    quota.recordRequest();
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(this.opts.baseUrl + path, {
        headers: this.opts.headers,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fail(`network error: ${message}`);
      throw new ProviderError(provider, 'network', message);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const retryMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
      await this.fail('HTTP 429 rate limited', retryMs);
      throw new ProviderError(provider, 'rate-limit', 'rate limited (429)', retryMs);
    }
    if (res.status === 404) {
      // "No such data" (e.g. no table for a finished tournament) is not a
      // provider fault, so it costs a request but never triggers a backoff.
      quota.recordSuccess();
      await this.saveUsage();
      throw new ProviderError(provider, 'not-found', `nothing at ${redact(path)}`);
    }
    if (!res.ok) {
      await this.fail(`HTTP ${res.status}`);
      throw new ProviderError(provider, 'http', `HTTP ${res.status} for ${redact(path)}`);
    }

    const body = (await res.json()) as T;
    const info = this.opts.inspect?.(res, body) ?? {};
    if (info.remaining !== undefined) quota.syncRemaining(info.remaining);
    if (info.error) {
      const rateLimited = /rate ?limit|too many/i.test(info.error);
      await this.fail(info.error, rateLimited ? 60_000 : undefined);
      throw new ProviderError(provider, rateLimited ? 'rate-limit' : 'plan', info.error);
    }

    quota.recordSuccess();
    await this.saveUsage();
    return body;
  }

  private async restoreUsage(): Promise<void> {
    if (this.restored || !this.opts.usage) return;
    this.restored = true;
    try {
      const used = await this.opts.usage.load(this.opts.provider, this.opts.quota.today);
      this.opts.quota.restore(this.opts.quota.today, used);
    } catch (err) {
      this.logger.warn(`Could not restore usage: ${(err as Error).message}`);
    }
  }

  private async saveUsage(error?: string): Promise<void> {
    try {
      await this.opts.usage?.increment(this.opts.provider, this.opts.quota.today, error);
    } catch (err) {
      this.logger.warn(`Could not save usage: ${(err as Error).message}`);
    }
  }

  private async fail(reason: string, retryAfterMs?: number): Promise<void> {
    const backoff = this.opts.quota.recordFailure(Date.now(), retryAfterMs);
    this.logger.warn(`${reason}; backing off ${Math.round(backoff / 1000)}s`);
    await this.saveUsage(reason);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Never log query values that might carry identifiers. */
function redact(path: string): string {
  return path.split('?')[0] ?? path;
}
