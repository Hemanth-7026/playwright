import type { ActionResult, EnvironmentInfo, WindowInfo, Logger } from '../types';
import type { HandlerRegistry } from './HandlerRegistry';

/**
 * Orchestrates approval execution across registered handlers.
 *
 * Tries handlers in priority order until one succeeds.
 * Returns a combined result indicating which handler was used.
 */
export class ActionEngine {
  private _registry: HandlerRegistry;
  private _log: Logger;

  constructor(registry: HandlerRegistry, logger: Logger) {
    this._registry = registry;
    this._log = logger;
  }

  /**
   * Execute the approval action on the given window.
   * Tries all available handlers in priority order.
   */
  async execute(window: WindowInfo, env: EnvironmentInfo): Promise<ActionResult> {
    const handlers = await this._registry.available(env);

    if (handlers.length === 0) {
      this._log.error('ActionEngine', 'No action handlers available');
      return {
        success: false,
        handlerName: 'none',
        durationMs: 0,
        error: 'No action handlers available',
      };
    }

    for (const handler of handlers) {
      try {
        this._log.debug('ActionEngine', `Trying handler: ${handler.name}`);
        const result = await handler.execute(window, env);
        if (result.success) {
          this._log.info('ActionEngine', `Action succeeded via ${handler.name}`, {
            durationMs: result.durationMs,
          });
          return result;
        }
        this._log.warn('ActionEngine', `Handler ${handler.name} returned failure: ${result.error}`);
      } catch (e) {
        this._log.warn('ActionEngine', `Handler ${handler.name} threw`, { error: String(e) });
      }
    }

    return {
      success: false,
      handlerName: 'fallback-exhausted',
      durationMs: 0,
      error: 'All action handlers failed',
    };
  }

  get registry(): HandlerRegistry {
    return this._registry;
  }
}
