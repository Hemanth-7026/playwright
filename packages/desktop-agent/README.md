# @playwright/desktop-agent

A highly flexible, scalable, and resilient desktop automation module that integrates with Playwright to automatically handle Okta Verify FastPass approval (and other native auth flows) in the background on Windows.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Playwright Test Code                  │
│         await authHandler.handleFastPass()              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Integration Layer                          │
│  PlaywrightAuthHandler  (promise-based, blocks caller)  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│               Desktop Agent (core)                      │
│  Polling loop · retry/fallback · listener management    │
├─────────┬───────────┬───────────┬───────────────────────┤
│Detection│  Action   │  Window   │     Environment       │
│ Engine  │  Engine   │  Manager  │      Manager          │
├─────────┴───────────┴───────────┴───────────────────────┤
│         Strategy & Handler Registries (plugin)          │
├─────────────────────────────────────────────────────────┤
│  Config Manager  │  Logger  │  Retry Manager            │
└─────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Files | Purpose |
|-------|-------|---------|
| **Integration** | `integration/PlaywrightAuthHandler.ts` | Promise-based API for Playwright tests |
| **Agent** | `agent/DesktopAgent.ts`, `agent/AgentService.ts` | Background polling loop, lifecycle, auto-start |
| **Detection** | `detection/DetectionEngine.ts`, `detection/StrategyRegistry.ts`, `detection/strategies/*` | Multi-strategy prompt detection with fallback |
| **Action** | `action/ActionEngine.ts`, `action/HandlerRegistry.ts`, `action/handlers/*` | Multi-handler approval execution with fallback |
| **Window** | `window/WindowScanner.ts`, `window/WindowManager.ts` | Win32 window enumeration, focus, move, restore |
| **Environment** | `environment/EnvironmentManager.ts` | OS version, screen resolution, user profile |
| **Retry** | `retry/RetryManager.ts` | Configurable retries with fixed/linear/exponential backoff + jitter |
| **Config** | `config/ConfigManager.ts` | Layered config: defaults → external JSON → runtime overrides |
| **Logging** | `logging/Logger.ts` | Structured logging with component tags |

---

## Folder Structure

```
packages/desktop-agent/
├── package.json
├── tsconfig.json
├── config/
│   └── default.config.json         # External config (editable without code changes)
└── src/
    ├── index.ts                     # Public API barrel export
    ├── types.ts                     # All interfaces and type definitions
    ├── agent/
    │   ├── DesktopAgent.ts          # Core background agent
    │   └── AgentService.ts          # Windows Task Scheduler auto-start
    ├── config/
    │   └── ConfigManager.ts         # Layered configuration
    ├── logging/
    │   └── Logger.ts                # Structured logging
    ├── environment/
    │   └── EnvironmentManager.ts    # OS / display detection
    ├── detection/
    │   ├── DetectionEngine.ts       # Strategy orchestrator
    │   ├── StrategyRegistry.ts      # Plugin registry for strategies
    │   ├── fuzzyMatch.ts            # Fuzzy string matching util
    │   └── strategies/
    │       ├── WindowTitleStrategy.ts
    │       ├── ProcessMonitorStrategy.ts
    │       └── AccessibilityStrategy.ts
    ├── action/
    │   ├── ActionEngine.ts          # Handler orchestrator
    │   ├── HandlerRegistry.ts       # Plugin registry for handlers
    │   └── handlers/
    │       ├── KeyboardApprovalHandler.ts
    │       └── ClickApprovalHandler.ts
    ├── window/
    │   ├── WindowScanner.ts         # Win32 window enumeration
    │   └── WindowManager.ts         # Window focus / move / restore
    ├── retry/
    │   └── RetryManager.ts          # Retry with backoff
    └── integration/
        └── PlaywrightAuthHandler.ts # Playwright-facing API
```

---

## Quick Start

### Basic Playwright Usage

```typescript
import { test, expect } from '@playwright/test';
import { createAuthHandler } from '@playwright/desktop-agent';

const authHandler = createAuthHandler();

test('login with Okta FastPass', async ({ page }) => {
  await page.goto('https://myapp.example.com/login');

  // Click the SSO / Okta login button
  await page.click('button:has-text("Sign in with Okta")');

  // Block until FastPass approval completes (or times out)
  await authHandler.handleFastPass();

  // Page is now authenticated
  await expect(page.locator('.dashboard')).toBeVisible();
});

test.afterAll(async () => {
  await authHandler.dispose();
});
```

### Custom Configuration

```typescript
const authHandler = createAuthHandler({
  config: {
    approvalTimeoutMs: 60_000,
    pollIntervalMs: 250,
    logLevel: 'debug',
    patterns: {
      windowTitles: ['Okta Verify', 'My Custom Auth Prompt'],
      processNames: ['OktaVerify', 'MyAuthApp'],
      windowClassNames: [],
      fuzzyThreshold: 0.5,
    },
  },
});
```

### External Config File (no code changes)

```typescript
const authHandler = createAuthHandler({
  config: {
    externalConfigPath: './okta-agent.config.json',
  },
});
```

Edit `okta-agent.config.json` to change patterns, timeouts, and behavior
without touching any code.

Browser-hosted protocol prompts such as `Open Okta Verify?` are handled as part
of the normal FastPass detection flow through the built-in matching patterns.

### Persistent Background Agent

```typescript
import { DesktopAgent, AgentService } from '@playwright/desktop-agent';
import { Logger } from '@playwright/desktop-agent';

// Run the agent as a long-lived process
const agent = new DesktopAgent();
await agent.start();

// Install auto-start on login (one-time setup)
const service = new AgentService(agent.logger);
await service.install('./run-agent.js');

// Agent now polls in the background
// Stop with: await agent.stop();
```

### Manual Popup Validation

The package includes a reproducible popup simulation and approval check:

```powershell
Set-Location C:\Users\maddi\source\repos\playwright\packages\desktop-agent
npm run build
npm run test:vscode-popup
```

This starts a Windows Forms dialog titled `Open VS Code?` and verifies that
the package detects it and approves it using the popup API.

---

## Adding a New Detection Strategy (Without Changing Core Logic)

To demonstrate the plugin architecture, here's how to add a **toast notification** detection strategy:

```typescript
import {
  DesktopAgent,
  createAuthHandler,
} from '@playwright/desktop-agent';
import type {
  DetectionStrategy,
  DetectionResult,
  EnvironmentInfo,
} from '@playwright/desktop-agent';

/**
 * Detects Okta Verify toast notifications via Windows Action Center.
 * (Example custom strategy — add without modifying any core files.)
 */
class ToastNotificationStrategy implements DetectionStrategy {
  readonly name = 'ToastNotification';
  readonly priority = 15; // Between WindowTitle (10) and ProcessMonitor (20)

  async isAvailable(env: EnvironmentInfo): Promise<boolean> {
    // Only available on Windows 10+
    return process.platform === 'win32' && parseInt(env.osBuild) >= 10240;
  }

  async detect(env: EnvironmentInfo): Promise<DetectionResult> {
    // ... your custom toast detection logic here ...
    // For example, query the WinRT notification API via PowerShell
    return {
      detected: false,
      strategyName: this.name,
      confidence: 0,
      timestamp: Date.now(),
    };
  }
}

// Register the custom strategy — no core code modified
const auth = createAuthHandler();
(auth as any).agent.strategies.register(new ToastNotificationStrategy());

// Use as normal
await auth.handleFastPass();
```

The `StrategyRegistry` and `HandlerRegistry` accept any object implementing
the `DetectionStrategy` or `ActionHandler` interface. Core logic never needs
to change.

---

## How the System Handles Environment Differences

### 1. Environment Abstraction

The `EnvironmentManager` detects at runtime:
- **OS version & build** — strategies can check `isAvailable()` and skip themselves
  on unsupported Windows versions
- **Screen resolution** — `WindowManager` computes off-screen coordinates dynamically
  from `EnvironmentInfo.primaryScreen`, never using hardcoded pixel values
- **User profile path** — used for locating per-user config and log files
- **Multi-monitor** — all screens are enumerated; the primary screen is used
  for off-screen positioning by default

### 2. Config-Driven Detection

Window titles, process names, and class names are stored in the external
config file and matched via fuzzy matching. When Okta ships a version that
changes the window title from "Okta Verify" to "Okta Verify - FastPass v2",
you update the config file — no code change, no recompile:

```json
{
  "patterns": {
    "windowTitles": [
      "Okta Verify",
      "Okta Verify - FastPass v2"
    ],
    "fuzzyThreshold": 0.55
  }
}
```

Lowering `fuzzyThreshold` makes matching more tolerant of minor text
differences across versions.

### 3. Strategy Fallback Chain

If window title matching fails (e.g., a UI redesign), the Detection Engine
automatically falls through to:
1. `ProcessMonitorStrategy` — detects the OktaVerify process (less precise
   but version-independent)
2. `AccessibilityStrategy` — uses UI Automation tree traversal (resilient
   to visual changes, reads semantic element names)

Each strategy reports a **confidence score**, so the engine can prefer
high-confidence matches while still accepting lower-confidence fallbacks.

### 4. Action Handler Fallback

Similarly, if `KeyboardApprovalHandler` (SendKeys Enter) fails — perhaps
the dialog layout changed and focus lands on the wrong button —
`ClickApprovalHandler` uses UI Automation to find and invoke the approval
button by its accessible name, independent of visual layout.

### 5. Display-Adaptive Window Management

The `WindowManager` never uses hardcoded screen coordinates. It:
- Queries `EnvironmentInfo.primaryScreen.width` to compute off-screen placement
- Saves and restores original window bounds regardless of resolution
- Handles minimized windows by restoring them before interaction

### 6. Version Awareness

The `ProcessMonitorStrategy` reports the process name which can include
version suffixes. The config-driven fuzzy matching adapts automatically.
For deeper version detection, a custom strategy can read the Okta Verify
executable's file version via PowerShell:

```powershell
(Get-Item "C:\...\OktaVerify.exe").VersionInfo.FileVersion
```

And adjust its detection behavior dynamically.

---

## Resilience Features

| Feature | Implementation |
|---------|---------------|
| **Retry with backoff** | `RetryManager` — fixed, linear, or exponential backoff with jitter |
| **Fallback chain** | Strategies/handlers tried in priority order; first success wins |
| **Graceful degradation** | If all automated handlers fail, logs state for manual intervention |
| **Hot-reload config** | `ConfigManager.reload()` re-reads external JSON without restart |
| **Fault isolation** | Each strategy/handler runs in its own try/catch; one failure doesn't stop others |
| **Structured logging** | Every detection attempt, success, failure, and unknown state is logged with timestamps and component tags |
| **Auto-start** | `AgentService` installs a Windows Task Scheduler entry for login trigger |

---

## API Reference

### `createAuthHandler(options?): AuthHandler`

Factory function. Returns a `PlaywrightAuthHandler` ready for use.

### `AuthHandler.handleFastPass(options?): Promise<void>`

Blocks until FastPass approval completes. Throws on timeout.

### `AuthHandler.status(): AgentStatus`

Returns current agent state: uptime, last detection/action, registered plugins.

### `AuthHandler.dispose(): Promise<void>`

Shuts down the agent and releases all resources.

### `DesktopAgent`

Full-featured agent with `start()`, `stop()`, `waitForApproval()`, direct
access to strategy/handler registries, and config hot-reload.

### `StrategyRegistry.register(strategy: DetectionStrategy): void`

Add a custom detection strategy at runtime.

### `HandlerRegistry.register(handler: ActionHandler): void`

Add a custom action handler at runtime.
