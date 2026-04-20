import type { DetectionResult, EnvironmentInfo, Logger } from '../types';
import type { StrategyRegistry } from './StrategyRegistry';

/**
 * Orchestrates detection across all registered strategies.
 *
 * Strategies are tried in priority order. The first positive detection
 * with sufficient confidence wins. If no strategy succeeds, returns
 * a negative result.
 */
export class DetectionEngine {
  private _registry: StrategyRegistry;
  private _log: Logger;

  constructor(registry: StrategyRegistry, logger: Logger) {
    this._registry = registry;
    this._log = logger;
  }

  /**
   * Run all available strategies in priority order.
   * Returns the first detection with `detected === true`, or a negative result.
   */
  async detect(env: EnvironmentInfo): Promise<DetectionResult> {
    const strategies = await this._registry.available(env);

    if (strategies.length === 0) {
      this._log.warn('DetectionEngine', 'No detection strategies available');
      return { detected: false, strategyName: 'none', confidence: 0, timestamp: Date.now() };
    }

    for (const strategy of strategies) {
      try {
        this._log.debug('DetectionEngine', `Trying strategy: ${strategy.name}`);
        const result = await strategy.detect(env);
        if (result.detected) {
          this._log.info('DetectionEngine', `Detection succeeded via ${strategy.name}`, {
            confidence: result.confidence,
            window: result.window?.title,
          });
          return result;
        }
      } catch (e) {
        this._log.warn('DetectionEngine', `Strategy ${strategy.name} threw`, { error: String(e) });
      }
    }

    this._log.debug('DetectionEngine', 'No strategy detected the target');
    return { detected: false, strategyName: 'none', confidence: 0, timestamp: Date.now() };
  }

  get registry(): StrategyRegistry {
    return this._registry;
  }
}
