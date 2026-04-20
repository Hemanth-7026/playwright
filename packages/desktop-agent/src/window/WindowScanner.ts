import * as childProcess from 'child_process';
import type { WindowInfo, Logger } from '../types';

/**
 * Scans for visible windows via PowerShell / Win32.
 *
 * Uses the `Get-Process` + native interop approach to enumerate
 * windows without requiring native modules.
 */
export class WindowScanner {
  private _log: Logger;

  constructor(logger: Logger) {
    this._log = logger;
  }

  async listWindows(): Promise<WindowInfo[]> {
    try {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class Win32Window {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public static List<object> GetWindows() {
        var list = new List<object>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len == 0) return true;

            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);

            var cls = new StringBuilder(256);
            GetClassName(hWnd, cls, cls.Capacity);

            RECT rect;
            GetWindowRect(hWnd, out rect);

            list.Add(new {
                Handle    = (long)hWnd,
                Title     = System.Text.RegularExpressions.Regex.Replace(title, @"[\\x00-\\x1F\\x7F]", ""),
                ProcessId = (int)pid,
                ClassName = System.Text.RegularExpressions.Regex.Replace(cls.ToString(), @"[\\x00-\\x1F\\x7F]", ""),
                X         = rect.Left,
                Y         = rect.Top,
                Width     = rect.Right - rect.Left,
                Height    = rect.Bottom - rect.Top,
                Minimized = IsIconic(hWnd)
            });
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@
[Win32Window]::GetWindows() | ForEach-Object {
    [PSCustomObject]@{
        Handle    = $_.Handle
        Title     = $_.Title
        ProcessId = $_.ProcessId
        ClassName = $_.ClassName
        X         = $_.X
        Y         = $_.Y
        Width     = $_.Width
        Height    = $_.Height
        Minimized = $_.Minimized
    }
} | ConvertTo-Json -Compress`;

      const raw = await this._ps(script);
      if (!raw) return [];

      const rawPayload = raw.startsWith('[') ? raw : `[${raw}]`;
      const sanitized = this._sanitizeJson(raw);
      const payload = sanitized.startsWith('[') ? sanitized : `[${sanitized}]`;
      this._logPayload('WindowScanner', rawPayload, 'raw');
      if (payload !== rawPayload)
        this._logPayload('WindowScanner', payload, 'sanitized');

      let parsed: any[];
      try {
        parsed = JSON.parse(payload);
      } catch (e) {
        this._logPayload('WindowScanner', rawPayload, 'raw', true);
        if (payload !== rawPayload)
          this._logPayload('WindowScanner', payload, 'sanitized', true);
        throw e;
      }

      return (parsed as any[]).map(w => this._toWindowInfo(w));
    } catch (e) {
      this._log.warn('WindowScanner', 'Failed to enumerate windows', { error: String(e) });
      return [];
    }
  }

  /** Find a window by handle. */
  async findByHandle(handle: number): Promise<WindowInfo | null> {
    const windows = await this.listWindows();
    return windows.find(w => w.handle === handle) ?? null;
  }

  private _toWindowInfo(raw: any): WindowInfo {
    return {
      handle: raw.Handle ?? 0,
      title: raw.Title ?? '',
      processId: raw.ProcessId ?? 0,
      processName: '',
      className: raw.ClassName ?? '',
      bounds: { x: raw.X ?? 0, y: raw.Y ?? 0, width: raw.Width ?? 0, height: raw.Height ?? 0 },
      isVisible: true,
      isMinimized: raw.Minimized ?? false,
    };
  }

  private _sanitizeJson(raw: string): string {
    return raw.replace(/[\u0000-\u001F\u007F]/g, '');
  }

  private _logPayload(scope: string, payload: string, variant: 'raw' | 'sanitized', failed = false): void {
    const preview = payload.slice(0, 2000);
    this._log.warn(scope, failed ? `${variant} payload on parse failure` : `${variant} payload preview`, {
      length: payload.length,
      escaped: JSON.stringify(preview),
      hex: Buffer.from(preview, 'utf8').toString('hex'),
      truncated: payload.length > preview.length,
    });
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
