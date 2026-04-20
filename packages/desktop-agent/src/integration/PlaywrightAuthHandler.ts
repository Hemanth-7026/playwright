import type { AgentStatus, AuthHandler, FastPassOptions } from '../types';
import { DesktopAgent, type DesktopAgentOptions } from '../agent/DesktopAgent';

/**
 * Playwright-facing integration layer.
 *
 * Exposes a clean, promise-based API that blocks until
 * FastPass approval is complete:
 *
 *   const auth = createAuthHandler();
 *   await auth.handleFastPass();
 *
 * Does NOT depend on any Playwright internals — only on the
 * DesktopAgent which manages the actual automation.
 */
export class PlaywrightAuthHandler implements AuthHandler {
  private _agent: DesktopAgent;
  private _autoStarted = false;

  constructor(options?: DesktopAgentOptions) {
    this._agent = new DesktopAgent(options);
  }

  /**
   * Block until Okta Verify FastPass approval is complete.
   *
   * Starts the agent if not already running, waits for detection + approval,
   * then returns. Throws on timeout.
   *
   * @example
   *   // In a Playwright test
   *   const authHandler = createAuthHandler();
   *   await page.goto('https://myapp.example.com');
   *   await authHandler.handleFastPass();
   *   // Page is now authenticated
   */
  async handleFastPass(options?: FastPassOptions): Promise<void> {
    if (!this._agent.status().running) {
      await this._agent.start();
      this._autoStarted = true;
    }

    try {
      await this._agent.waitForApproval(
          options?.timeoutMs,
          options?.windowOptions,
      );
    } finally {
      // If we auto-started, stop after this one-shot
      if (this._autoStarted) {
        await this._agent.stop();
        this._autoStarted = false;
      }
    }
  }

  status(): AgentStatus {
    return this._agent.status();
  }

  async dispose(): Promise<void> {
    await this._agent.dispose();
  }

  /** Access the underlying agent for advanced usage. */
  get agent(): DesktopAgent {
    return this._agent;
  }
}

/**
 * Factory function — the recommended entry point.
 *
 * @example
 *   import { createAuthHandler } from '@playwright/desktop-agent';
 *   const auth = createAuthHandler({ config: { approvalTimeoutMs: 60000 } });
 *   await auth.handleFastPass();
 */
export function createAuthHandler(options?: DesktopAgentOptions): AuthHandler {
  return new PlaywrightAuthHandler(options);
}
