import type {
  AgentConfig,
  AgentStatus,
  DetectionResult,
  ActionResult,
  WindowManipulationOptions,
  Logger as ILogger,
} from '../types';
import { ConfigManager } from '../config/ConfigManager';
import { Logger } from '../logging/Logger';
import { EnvironmentManager } from '../environment/EnvironmentManager';
import { DetectionEngine } from '../detection/DetectionEngine';
import { StrategyRegistry } from '../detection/StrategyRegistry';
import { ActionEngine } from '../action/ActionEngine';
import { HandlerRegistry } from '../action/HandlerRegistry';
import { WindowManager } from '../window/WindowManager';
import { RetryManager } from '../retry/RetryManager';

// Built-in strategies
import { WindowTitleStrategy } from '../detection/strategies/WindowTitleStrategy';
import { ProcessMonitorStrategy } from '../detection/strategies/ProcessMonitorStrategy';
import { AccessibilityStrategy } from '../detection/strategies/AccessibilityStrategy';

// Built-in handlers
import { KeyboardApprovalHandler } from '../action/handlers/KeyboardApprovalHandler';
import { ClickApprovalHandler } from '../action/handlers/ClickApprovalHandler';

export interface DesktopAgentOptions {
  config?: Partial<AgentConfig>;
  /** If true, skip registering built-in strategies/handlers (for testing). */
  bare?: boolean;
}

/**
 * Persistent background Desktop Agent.
 *
 * Orchestrates:
 *   1. Environment detection
 *   2. Prompt detection (via pluggable strategies)
 *   3. Window management (move off-screen, focus)
 *   4. Approval execution (via pluggable handlers)
 *   5. Retry / fallback logic
 *
 * Runs a polling loop that can be started/stopped. The Playwright
 * integration layer sits on top of this.
 */
export class DesktopAgent {
  private _configManager: ConfigManager;
  private _logger: Logger;
  private _envManager: EnvironmentManager;
  private _detectionEngine: DetectionEngine;
  private _actionEngine: ActionEngine;
  private _windowManager: WindowManager;
  private _retryManager: RetryManager;
  private _strategyRegistry: StrategyRegistry;
  private _handlerRegistry: HandlerRegistry;

  // Background loop state
  private _running = false;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _startTime = 0;
  private _lastDetection: DetectionResult | null = null;
  private _lastAction: ActionResult | null = null;

  // Listeners for one-shot approval requests
  private _approvalListeners: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(options?: DesktopAgentOptions) {
    this._configManager = new ConfigManager(options?.config);
    const cfg = this._configManager.config;

    this._logger = new Logger(cfg.logLevel);
    this._envManager = new EnvironmentManager(this._logger);
    this._retryManager = new RetryManager(this._logger);
    this._windowManager = new WindowManager(this._logger);

    this._strategyRegistry = new StrategyRegistry(this._logger);
    this._detectionEngine = new DetectionEngine(this._strategyRegistry, this._logger);

    this._handlerRegistry = new HandlerRegistry(this._logger);
    this._actionEngine = new ActionEngine(this._handlerRegistry, this._logger);

    if (!options?.bare)
      this._registerDefaults(cfg);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start the background polling loop. */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    this._startTime = Date.now();
    this._logger.info('DesktopAgent', 'Agent started');

    // Warm up environment cache
    await this._envManager.getEnvironment();

    this._schedulePoll();
  }

  /** Stop the background polling loop gracefully. */
  async stop(): Promise<void> {
    this._running = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    // Reject pending listeners
    for (const l of this._approvalListeners) {
      clearTimeout(l.timeoutHandle);
      l.reject(new Error('Agent stopped'));
    }
    this._approvalListeners = [];
    this._logger.info('DesktopAgent', 'Agent stopped');
  }

  /**
   * One-shot: wait until a FastPass prompt is detected and approved,
   * or until timeout.  Used by the Playwright integration layer.
   */
  waitForApproval(
      timeoutMs?: number,
      windowOptions?: WindowManipulationOptions,
  ): Promise<void> {
    const timeout = timeoutMs ?? this._configManager.config.approvalTimeoutMs;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._removeListener(entry);
        reject(new Error(`FastPass approval timed out after ${timeout}ms`));
      }, timeout);

      const entry = { resolve, reject, timeoutHandle };
      this._approvalListeners.push(entry);

      // Start polling if not already running
      if (!this._running)
        this.start();
    });
  }

  /** Current agent status snapshot. */
  status(): AgentStatus {
    return {
      running: this._running,
      uptime: this._running ? Date.now() - this._startTime : 0,
      lastDetection: this._lastDetection,
      lastAction: this._lastAction,
      registeredStrategies: this._strategyRegistry.names,
      registeredHandlers: this._handlerRegistry.names,
    };
  }

  /** Hot-reload configuration. */
  reloadConfig(): void {
    this._configManager.reload();
    this._logger.setLevel(this._configManager.config.logLevel);
    this._logger.info('DesktopAgent', 'Configuration reloaded');
  }

  /** Access registries for programmatic plugin management. */
  get strategies(): StrategyRegistry { return this._strategyRegistry; }
  get handlers(): HandlerRegistry { return this._handlerRegistry; }
  get config(): ConfigManager { return this._configManager; }
  get logger(): ILogger { return this._logger; }

  /** Dispose all resources. */
  async dispose(): Promise<void> {
    await this.stop();
    await this._strategyRegistry.dispose();
    await this._handlerRegistry.dispose();
    this._logger.info('DesktopAgent', 'Agent disposed');
  }

  // -----------------------------------------------------------------------
  // Internal loop
  // -----------------------------------------------------------------------

  private _schedulePoll(): void {
    if (!this._running) return;
    this._pollTimer = setTimeout(async () => {
      await this._pollOnce();
      this._schedulePoll();
    }, this._configManager.config.pollIntervalMs);
  }

  private async _pollOnce(): Promise<void> {
    try {
      const env = await this._envManager.getEnvironment();
      const cfg = this._configManager.config;

      // Detection with retries
      const detection = await this._retryManager.execute(
          'Detection',
          cfg.detectionRetry,
          () => this._detectionEngine.detect(env),
          (_err, result) => !result.detected,
      ).catch(() => null);

      if (!detection?.detected)
        return;

      this._lastDetection = detection;

      if (!detection.window) {
        this._logger.warn('DesktopAgent', 'Detection succeeded but no window info');
        return;
      }

      // Window management
      const cleanup = await this._windowManager.prepare(
          detection.window,
          env,
          cfg.windowDefaults,
      );

      try {
        // Action with retries
        const action = await this._retryManager.execute(
            'Action',
            cfg.actionRetry,
            () => this._actionEngine.execute(detection.window!, env),
            (_err, result) => !result.success,
        ).catch((e): ActionResult => ({
          success: false,
          handlerName: 'retry-exhausted',
          durationMs: 0,
          error: String(e),
        }));

        this._lastAction = action;

        if (action.success) {
          this._logger.info('DesktopAgent', 'Approval cycle completed successfully');
          this._resolveListeners();
        } else {
          this._logger.error('DesktopAgent', 'Approval cycle failed', { error: action.error });
        }
      } finally {
        await cleanup();
      }
    } catch (e) {
      this._logger.error('DesktopAgent', 'Poll cycle error', { error: String(e) });
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private _resolveListeners(): void {
    for (const l of this._approvalListeners) {
      clearTimeout(l.timeoutHandle);
      l.resolve();
    }
    this._approvalListeners = [];
  }

  private _removeListener(entry: (typeof this._approvalListeners)[number]): void {
    const idx = this._approvalListeners.indexOf(entry);
    if (idx !== -1)
      this._approvalListeners.splice(idx, 1);
  }

  private _registerDefaults(cfg: AgentConfig): void {
    // Detection strategies
    this._strategyRegistry.register(new WindowTitleStrategy(cfg.patterns, this._logger));
    this._strategyRegistry.register(new ProcessMonitorStrategy(cfg.patterns, this._logger));
    this._strategyRegistry.register(new AccessibilityStrategy(cfg.patterns, this._logger));

    // Action handlers
    this._handlerRegistry.register(new KeyboardApprovalHandler(this._logger));
    this._handlerRegistry.register(new ClickApprovalHandler(this._logger));
  }
}
