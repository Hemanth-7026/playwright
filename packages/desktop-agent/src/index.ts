/**
 * @playwright/desktop-agent
 *
 * Desktop automation module for handling Okta Verify FastPass
 * and other native authentication flows alongside Playwright.
 *
 * @example
 *   import { createAuthHandler } from '@playwright/desktop-agent';
 *
 *   const auth = createAuthHandler();
 *   await page.goto('https://myapp.example.com');
 *   await auth.handleFastPass();
 */

// Public API
export { createAuthHandler, PlaywrightAuthHandler } from './integration/PlaywrightAuthHandler';
export { DesktopAgent } from './agent/DesktopAgent';
export type { DesktopAgentOptions } from './agent/DesktopAgent';

// Configuration
export { ConfigManager } from './config/ConfigManager';

// Environment
export { EnvironmentManager } from './environment/EnvironmentManager';

// Detection (plugin system)
export { DetectionEngine } from './detection/DetectionEngine';
export { StrategyRegistry } from './detection/StrategyRegistry';
export { WindowTitleStrategy } from './detection/strategies/WindowTitleStrategy';
export { ProcessMonitorStrategy } from './detection/strategies/ProcessMonitorStrategy';
export { AccessibilityStrategy } from './detection/strategies/AccessibilityStrategy';
export { fuzzyMatch, matchesAny } from './detection/fuzzyMatch';

// Action (plugin system)
export { ActionEngine } from './action/ActionEngine';
export { HandlerRegistry } from './action/HandlerRegistry';
export { KeyboardApprovalHandler } from './action/handlers/KeyboardApprovalHandler';
export { ClickApprovalHandler } from './action/handlers/ClickApprovalHandler';

// Window management
export { WindowScanner } from './window/WindowScanner';
export { WindowManager } from './window/WindowManager';
export { focusInputField, dumpWindowControls } from './window/UIAutomationHelpers';

// Retry
export { RetryManager } from './retry/RetryManager';

// Logging
export { Logger } from './logging/Logger';

// Types
export type {
  AgentConfig,
  AgentStatus,
  AuthHandler,
  FastPassOptions,
  ActionHandler,
  ActionResult,
  DetectionStrategy,
  DetectionResult,
  DetectionPatternConfig,
  EnvironmentInfo,
  ScreenInfo,
  WindowInfo,
  WindowManipulationOptions,
  RetryOptions,
  BackoffStrategy,
  LogLevel,
  LogEntry,
  Logger as ILogger,
} from './types';
