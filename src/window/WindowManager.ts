import * as childProcess from 'child_process';
import type { WindowInfo, WindowManipulationOptions, EnvironmentInfo, Logger } from '../types';

/**
 * Manages window position, focus, and visibility.
 *
 * All operations use PowerShell + Win32 interop so there are no native
 * module dependencies. Coordinates are computed dynamically from the
 * environment's screen info.
 */
export class WindowManager {
  private _log: Logger;
  private _savedPositions = new Map<number, { x: number; y: number; width: number; height: number }>();

  constructor(logger: Logger) {
    this._log = logger;
  }

  /**
   * Prepare a window for interaction based on the given options.
   * Returns a cleanup function that restores the original state.
   */
  async prepare(
      window: WindowInfo,
      env: EnvironmentInfo,
      options: WindowManipulationOptions,
  ): Promise<() => Promise<void>> {
    const restoreActions: (() => Promise<void>)[] = [];

    // Save original bounds
    this._savedPositions.set(window.handle, { ...window.bounds });

    if (options.restoreIfMinimized && window.isMinimized) {
      await this._restoreWindow(window.handle);
      restoreActions.push(() => this._minimizeWindow(window.handle));
    }

    if (options.moveOffScreen) {
      const offscreen = this._computeOffScreenPosition(env);
      await this._moveWindow(window.handle, offscreen.x, offscreen.y, window.bounds.width, window.bounds.height);
      if (options.restorePosition) {
        const saved = this._savedPositions.get(window.handle)!;
        restoreActions.push(() => this._moveWindow(window.handle, saved.x, saved.y, saved.width, saved.height));
      }
    }

    if (options.bringToFront)
      await this._bringToFront(window.handle);

    return async () => {
      for (const restore of restoreActions.reverse()) {
        try {
          await restore();
        } catch (e) {
          this._log.warn('WindowManager', 'Restore action failed', { error: String(e) });
        }
      }
      this._savedPositions.delete(window.handle);
    };
  }

  // -----------------------------------------------------------------------
  // Primitive operations
  // -----------------------------------------------------------------------

  private async _moveWindow(handle: number, x: number, y: number, w: number, h: number): Promise<void> {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Move {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
[Win32Move]::MoveWindow([IntPtr]${handle}, ${x}, ${y}, ${w}, ${h}, $true)`;
    await this._ps(script);
    this._log.debug('WindowManager', `Moved window ${handle} to (${x},${y},${w},${h})`);
  }

  private async _bringToFront(handle: number): Promise<void> {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
[Win32Focus]::ShowWindow([IntPtr]${handle}, 9)
[Win32Focus]::SetForegroundWindow([IntPtr]${handle})`;
    await this._ps(script);
    this._log.debug('WindowManager', `Brought window ${handle} to front`);
  }

  private async _restoreWindow(handle: number): Promise<void> {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Restore {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
[Win32Restore]::ShowWindow([IntPtr]${handle}, 9)`;
    await this._ps(script);
  }

  private async _minimizeWindow(handle: number): Promise<void> {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Min {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
[Win32Min]::ShowWindow([IntPtr]${handle}, 6)`;
    await this._ps(script);
  }

  /**
   * Compute coordinates that place the window just beyond the visible screen area.
   * Uses the primary screen dimensions so it works with any resolution.
   */
  private _computeOffScreenPosition(env: EnvironmentInfo): { x: number; y: number } {
    const screen = env.primaryScreen;
    return { x: screen.width + 100, y: 0 };
  }

  private _ps(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      childProcess.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 5000, windowsHide: true },
          (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.trim());
          },
      );
    });
  }
}
