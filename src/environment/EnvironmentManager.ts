import * as os from 'os';
import * as childProcess from 'child_process';
import type { EnvironmentInfo, ScreenInfo, Logger } from '../types';

/**
 * Detects OS version, display configuration, and user profile.
 *
 * All Win32-specific queries run through PowerShell so no native
 * add-ons are required. Results are cached and can be refreshed.
 */
export class EnvironmentManager {
  private _cached: EnvironmentInfo | null = null;
  private _log: Logger;

  constructor(logger: Logger) {
    this._log = logger;
  }

  /** Return cached environment info, or detect fresh. */
  async getEnvironment(forceRefresh = false): Promise<EnvironmentInfo> {
    if (this._cached && !forceRefresh)
      return this._cached;
    this._cached = await this._detect();
    this._log.info('EnvironmentManager', 'Environment detected', {
      os: this._cached.osVersion,
      screens: this._cached.screens.length,
      primary: `${this._cached.primaryScreen.width}x${this._cached.primaryScreen.height}`,
    });
    return this._cached;
  }

  // -----------------------------------------------------------------------

  private async _detect(): Promise<EnvironmentInfo> {
    const [osVersion, osBuild, screens] = await Promise.all([
      this._getOsVersion(),
      this._getOsBuild(),
      this._getScreens(),
    ]);

    const primary = screens.find(s => s.isPrimary) ?? screens[0] ?? {
      width: 1920, height: 1080, scaleFactor: 1, isPrimary: true,
    };

    return {
      osVersion,
      osBuild,
      architecture: os.arch() as EnvironmentInfo['architecture'],
      userProfile: os.homedir(),
      hostname: os.hostname(),
      screens,
      primaryScreen: primary,
    };
  }

  private async _getOsVersion(): Promise<string> {
    return `Windows ${os.release()}`;
  }

  private async _getOsBuild(): Promise<string> {
    try {
      return this._ps(
          '[System.Environment]::OSVersion.Version.Build',
      );
    } catch {
      return 'unknown';
    }
  }

  private async _getScreens(): Promise<ScreenInfo[]> {
    try {
      const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [PSCustomObject]@{
    Width       = $_.Bounds.Width
    Height      = $_.Bounds.Height
    ScaleFactor = 1
    IsPrimary   = $_.Primary
  }
} | ConvertTo-Json -Compress`;
      const raw = await this._ps(script);
      const parsed = JSON.parse(raw.startsWith('[') ? raw : `[${raw}]`);
      return (parsed as any[]).map(s => ({
        width: s.Width,
        height: s.Height,
        scaleFactor: s.ScaleFactor,
        isPrimary: s.IsPrimary,
      }));
    } catch {
      return [{ width: 1920, height: 1080, scaleFactor: 1, isPrimary: true }];
    }
  }

  private _ps(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      childProcess.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 5000, windowsHide: true },
          (err, stdout) => {
            if (err)
              reject(err);
            else
              resolve(stdout.trim());
          },
      );
    });
  }
}
