import type { ActionHandler, EnvironmentInfo, Logger } from '../types';

/**
 * Registry for action handlers (approval handlers).
 *
 * Same plugin-based pattern as StrategyRegistry — handlers are tried
 * in priority order and new ones can be added at runtime.
 */
export class HandlerRegistry {
  private _handlers: ActionHandler[] = [];
  private _log: Logger;

  constructor(logger: Logger) {
    this._log = logger;
  }

  register(handler: ActionHandler): void {
    if (this._handlers.some(h => h.name === handler.name))
      throw new Error(`Handler "${handler.name}" is already registered`);
    this._handlers.push(handler);
    this._handlers.sort((a, b) => a.priority - b.priority);
    this._log.info('HandlerRegistry', `Registered handler: ${handler.name} (priority ${handler.priority})`);
  }

  unregister(name: string): boolean {
    const idx = this._handlers.findIndex(h => h.name === name);
    if (idx === -1) return false;
    this._handlers.splice(idx, 1);
    this._log.info('HandlerRegistry', `Unregistered handler: ${name}`);
    return true;
  }

  all(): readonly ActionHandler[] {
    return this._handlers;
  }

  async available(env: EnvironmentInfo): Promise<ActionHandler[]> {
    const results = await Promise.all(
        this._handlers.map(async h => ({ handler: h, ok: await h.isAvailable(env) })),
    );
    return results.filter(r => r.ok).map(r => r.handler);
  }

  async dispose(): Promise<void> {
    await Promise.all(this._handlers.map(h => h.dispose?.()));
    this._handlers = [];
  }

  get names(): string[] {
    return this._handlers.map(h => h.name);
  }
}
