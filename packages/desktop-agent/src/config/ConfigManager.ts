import * as fs from 'fs';
import * as path from 'path';
import type { AgentConfig } from '../types';

const DEFAULT_CONFIG: AgentConfig = {
  pollIntervalMs: 500,
  approvalTimeoutMs: 30_000,
  detectionRetry: {
    maxAttempts: 5,
    baseDelayMs: 200,
    maxDelayMs: 5_000,
    backoff: 'exponential',
    jitter: 0.2,
  },
  actionRetry: {
    maxAttempts: 3,
    baseDelayMs: 300,
    maxDelayMs: 3_000,
    backoff: 'linear',
    jitter: 0.1,
  },
  patterns: {
    windowTitles: [
      'Okta Verify',
      'Okta FastPass',
      'Sign In - Okta',
      'Verify Your Identity',
      'Open Okta Verify?',
      'Permission Dialog',
      'Protocol Handler Dialog',
      'Open Okta Verify',
      'This site is trying to open',
    ],
    processNames: [
      'OktaVerify',
      'Okta Verify',
    ],
    windowClassNames: [
      'OktaVerifyWindow',
    ],
    fuzzyThreshold: 0.6,
  },
  windowDefaults: {
    moveOffScreen: true,
    restoreIfMinimized: true,
    bringToFront: true,
    restorePosition: true,
  },
  logLevel: 'info',
};

/**
 * Manages layered configuration:
 *   1. Built-in defaults (above)
 *   2. External JSON config file (optional)
 *   3. Runtime overrides (programmatic)
 *
 * Config can be reloaded at runtime without restart.
 */
export class ConfigManager {
  private _config: AgentConfig;
  private _externalPath: string | undefined;

  constructor(overrides?: Partial<AgentConfig>) {
    this._config = this._deepMerge(DEFAULT_CONFIG, overrides ?? {});
    this._externalPath = this._config.externalConfigPath;
    if (this._externalPath)
      this._loadExternalConfig(this._externalPath);
  }

  get config(): Readonly<AgentConfig> {
    return this._config;
  }

  /** Merge runtime overrides into the current config. */
  update(overrides: Partial<AgentConfig>): void {
    this._config = this._deepMerge(this._config, overrides);
  }

  /** Reload external config file from disk (hot-reload support). */
  reload(): void {
    if (this._externalPath)
      this._loadExternalConfig(this._externalPath);
  }

  /** Return a snapshot copy safe for logging. */
  snapshot(): AgentConfig {
    return JSON.parse(JSON.stringify(this._config));
  }

  // -----------------------------------------------------------------------

  private _loadExternalConfig(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved))
      return;
    const raw = fs.readFileSync(resolved, 'utf-8');
    const external = JSON.parse(raw) as Partial<AgentConfig>;
    this._config = this._deepMerge(this._config, external);
  }

  private _deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
    const result = { ...base };
    for (const key of Object.keys(override) as (keyof T)[]) {
      const val = override[key];
      if (val !== undefined && typeof val === 'object' && !Array.isArray(val) && val !== null) {
        result[key] = this._deepMerge(
            (result[key] ?? {}) as Record<string, any>,
            val as Record<string, any>,
        ) as T[keyof T];
      } else if (val !== undefined) {
        result[key] = val as T[keyof T];
      }
    }
    return result;
  }
}
