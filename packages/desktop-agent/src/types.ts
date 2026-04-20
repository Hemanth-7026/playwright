/// <reference types="node" />

/**
 * Core type definitions and interfaces for the Desktop Agent.
 *
 * All modules depend on these types but never on each other's implementations,
 * enabling loose coupling and plugin-based extensibility.
 */

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface ScreenInfo {
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface EnvironmentInfo {
  osVersion: string;
  osBuild: string;
  architecture: 'x64' | 'arm64' | 'ia32';
  userProfile: string;
  hostname: string;
  screens: ScreenInfo[];
  primaryScreen: ScreenInfo;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export interface WindowInfo {
  handle: number;
  title: string;
  processId: number;
  processName: string;
  className: string;
  bounds: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isMinimized: boolean;
}

export interface WindowManipulationOptions {
  /** Move window off-screen to avoid user disturbance */
  moveOffScreen?: boolean;
  /** Restore minimized window before interaction */
  restoreIfMinimized?: boolean;
  /** Bring window to foreground */
  bringToFront?: boolean;
  /** Return window to original position after action */
  restorePosition?: boolean;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectionResult {
  detected: boolean;
  strategyName: string;
  confidence: number;       // 0.0 – 1.0
  window?: WindowInfo;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface DetectionStrategy {
  readonly name: string;
  readonly priority: number;  // Lower = tried first

  /** Return true if this strategy can operate in the current environment. */
  isAvailable(env: EnvironmentInfo): Promise<boolean>;

  /** Attempt to detect the target prompt. */
  detect(env: EnvironmentInfo): Promise<DetectionResult>;

  /** Optional: release resources held by this strategy. */
  dispose?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Action / Approval
// ---------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  handlerName: string;
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionHandler {
  readonly name: string;
  readonly priority: number;

  /** Return true if this handler can operate in the current environment. */
  isAvailable(env: EnvironmentInfo): Promise<boolean>;

  /** Execute the approval action on the given window. */
  execute(window: WindowInfo, env: EnvironmentInfo): Promise<ActionResult>;

  /** Optional cleanup. */
  dispose?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Retry / Backoff
// ---------------------------------------------------------------------------

export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoff: BackoffStrategy;
  /** Jitter factor (0–1) to add randomness and avoid thundering herd. */
  jitter: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DetectionPatternConfig {
  windowTitles: string[];
  processNames: string[];
  windowClassNames: string[];
  /** Minimum fuzzy-match score (0–1) to consider a match. */
  fuzzyThreshold: number;
}

export interface AgentConfig {
  /** Polling interval (ms) for the background detection loop. */
  pollIntervalMs: number;
  /** Maximum time (ms) to wait for a single approval cycle. */
  approvalTimeoutMs: number;
  /** Retry policy for detection. */
  detectionRetry: RetryOptions;
  /** Retry policy for approval actions. */
  actionRetry: RetryOptions;
  /** Detection patterns (config-driven, no code changes required). */
  patterns: DetectionPatternConfig;
  /** Window manipulation defaults. */
  windowDefaults: WindowManipulationOptions;
  /** Log level. */
  logLevel: LogLevel;
  /** Path to external config file (overrides built-in defaults). */
  externalConfigPath?: string;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  debug(component: string, message: string, data?: Record<string, unknown>): void;
  info(component: string, message: string, data?: Record<string, unknown>): void;
  warn(component: string, message: string, data?: Record<string, unknown>): void;
  error(component: string, message: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

export interface AgentStatus {
  running: boolean;
  uptime: number;
  lastDetection: DetectionResult | null;
  lastAction: ActionResult | null;
  registeredStrategies: string[];
  registeredHandlers: string[];
}

// ---------------------------------------------------------------------------
// Playwright integration
// ---------------------------------------------------------------------------

export interface FastPassOptions {
  /** Override the approval timeout for this call. */
  timeoutMs?: number;
  /** Override window manipulation options. */
  windowOptions?: WindowManipulationOptions;
}

export interface AuthHandler {
  /** Block until FastPass approval is complete or timeout. */
  handleFastPass(options?: FastPassOptions): Promise<void>;

  /** Returns current agent status. */
  status(): AgentStatus;

  /** Gracefully shut down the agent. */
  dispose(): Promise<void>;
}
