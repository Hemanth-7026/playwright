import * as childProcess from 'child_process';
import type { ActionHandler, ActionResult, EnvironmentInfo, WindowInfo, Logger } from '../../types';

/**
 * Handles Okta Verify FastPass approval via keyboard simulation.
 *
 * Sends Enter / Tab+Enter keystrokes to the focused approval window.
 * This is the most common and reliable approach for standard FastPass dialogs.
 *
 * Also exposes a public `sendKeysToWindow` utility for arbitrary keystrokes.
 */
export class KeyboardApprovalHandler implements ActionHandler {
  readonly name = 'KeyboardApproval';
  readonly priority = 10;

  private _log: Logger;
  private _customKeys: { key: string; delayMs: number }[] | undefined;

  constructor(logger: Logger, customKeys?: { key: string; delayMs: number }[]) {
    this._log = logger;
    this._customKeys = customKeys;
  }

  async isAvailable(_env: EnvironmentInfo): Promise<boolean> {
    return process.platform === 'win32';
  }

  async execute(window: WindowInfo, _env: EnvironmentInfo): Promise<ActionResult> {
    const start = Date.now();
    try {
      const keys = this._customKeys ?? [{ key: '{ENTER}', delayMs: 300 }];
      await this.sendKeysToWindow(window.handle, keys);

      this._log.info('KeyboardApproval', `Sent ${keys.length} key(s) to window "${window.title}" (handle=${window.handle})`);

      return {
        success: true,
        handlerName: this.name,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        handlerName: this.name,
        durationMs: Date.now() - start,
        error: String(e),
      };
    }
  }

  /**
   * Public utility: focus a window and send keystrokes to it.
   *
   * Key format follows .NET SendKeys syntax:
   *   - Plain text:  'Hello World'
   *   - Enter:       '{ENTER}'
   *   - Tab:         '{TAB}'
   *   - Special:     '{BACKSPACE}', '{DELETE}', '{ESC}', etc.
   *   - Modifiers:   '+' (Shift), '^' (Ctrl), '%' (Alt)
   *     e.g. '^a' = Ctrl+A, '%{F4}' = Alt+F4
   */
  async sendKeysToWindow(handle: number, keys: { key: string; delayMs: number }[]): Promise<void> {
    // Build a PowerShell script that focuses the window and sends keystrokes.
    // Using SendKeys from .NET — avoids external dependencies.
    const keyScript = keys.map(k => `
Start-Sleep -Milliseconds ${k.delayMs}
[System.Windows.Forms.SendKeys]::SendWait('${k.key}')
`).join('\n');

    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Key {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
[Win32Key]::ShowWindow([IntPtr]${handle}, 9)
Start-Sleep -Milliseconds 100
[Win32Key]::SetForegroundWindow([IntPtr]${handle})
Start-Sleep -Milliseconds 200
${keyScript}`;

    await this._ps(script);
  }

  private _ps(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      childProcess.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 10_000, windowsHide: true },
          (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.trim());
          },
      );
    });
  }
}
