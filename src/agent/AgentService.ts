import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { Logger } from '../types';

/**
 * Manages the Windows Task Scheduler entry for auto-start on login.
 *
 * Creates a scheduled task that launches the agent when the user logs in,
 * ensuring persistent background operation without requiring a Windows Service.
 */
export class AgentService {
  private _log: Logger;
  private _taskName: string;

  constructor(logger: Logger, taskName = 'PlaywrightDesktopAgent') {
    this._log = logger;
    this._taskName = taskName;
  }

  /** Install the scheduled task for current-user login trigger. */
  async install(agentScriptPath: string): Promise<void> {
    const resolved = path.resolve(agentScriptPath);
    if (!fs.existsSync(resolved))
      throw new Error(`Agent script not found: ${resolved}`);

    const nodeExe = process.execPath;
    const script = `
$action  = New-ScheduledTaskAction -Execute '${this._escapeForPs(nodeExe)}' -Argument '${this._escapeForPs(resolved)}'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName '${this._taskName}' -Action $action -Trigger $trigger -Settings $settings -Description 'Playwright Desktop Agent for Okta FastPass automation' -Force
`;
    await this._ps(script);
    this._log.info('AgentService', `Scheduled task "${this._taskName}" installed`);
  }

  /** Remove the scheduled task. */
  async uninstall(): Promise<void> {
    await this._ps(`Unregister-ScheduledTask -TaskName '${this._taskName}' -Confirm:$false -ErrorAction SilentlyContinue`);
    this._log.info('AgentService', `Scheduled task "${this._taskName}" removed`);
  }

  /** Check whether the scheduled task exists. */
  async isInstalled(): Promise<boolean> {
    try {
      const result = await this._ps(`Get-ScheduledTask -TaskName '${this._taskName}' -ErrorAction Stop | Select-Object -ExpandProperty TaskName`);
      return result.trim() === this._taskName;
    } catch {
      return false;
    }
  }

  private _escapeForPs(value: string): string {
    return value.replace(/'/g, "''");
  }

  private _ps(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      childProcess.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 15_000, windowsHide: true },
          (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.trim());
          },
      );
    });
  }
}
