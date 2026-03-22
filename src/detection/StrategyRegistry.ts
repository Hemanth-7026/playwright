import type { DetectionStrategy, EnvironmentInfo } from '../types';
import type { Logger } from '../logging/Logger';

/**
 * Registry for detection strategies.
 *
 * Strategies are tried in priority order (lower number = higher priority).
 * New strategies can be registered at runtime without modifying any core code.
 */
export class StrategyRegistry {
  private _strategies: DetectionStrategy[] = [];
  private _log: Logger;

  constructor(logger: Logger) {
    this._log = logger;
  }

  /** Register a strategy. Duplicate names are rejected. */
  register(strategy: DetectionStrategy): void {
    if (this._strategies.some(s => s.name === strategy.name))
      throw new Error(`Strategy "${strategy.name}" is already registered`);
    this._strategies.push(strategy);
    this._strategies.sort((a, b) => a.priority - b.priority);
    this._log.info('StrategyRegistry', `Registered strategy: ${strategy.name} (priority ${strategy.priority})`);
  }

  /** Unregister a strategy by name. */
  unregister(name: string): boolean {
    const idx = this._strategies.findIndex(s => s.name === name);
    if (idx === -1)
      return false;
    this._strategies.splice(idx, 1);
    this._log.info('StrategyRegistry', `Unregistered strategy: ${name}`);
    return true;
  }

  /** Return all registered strategies sorted by priority. */
  all(): readonly DetectionStrategy[] {
    return this._strategies;
  }

  /** Return only strategies available in the given environment. */
  async available(env: EnvironmentInfo): Promise<DetectionStrategy[]> {
    const results = await Promise.all(
        this._strategies.map(async s => ({ strategy: s, ok: await s.isAvailable(env) })),
    );
    return results.filter(r => r.ok).map(r => r.strategy);
  }

  /** Dispose all strategies. */
  async dispose(): Promise<void> {
    await Promise.all(this._strategies.map(s => s.dispose?.()));
    this._strategies = [];
  }

  get names(): string[] {
    return this._strategies.map(s => s.name);
  }
}
