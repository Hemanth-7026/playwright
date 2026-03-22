import * as childProcess from 'child_process';
import type { ActionHandler, ActionResult, EnvironmentInfo, WindowInfo, Logger } from '../../types';

/**
 * Handles approval by clicking the "Yes" / "Approve" button via UI Automation.
 *
 * Uses UIA to locate the approval button by name pattern, then invokes
 * the Invoke pattern on it. More precise than keyboard simulation but
 * depends on UIA being available.
 */
export class ClickApprovalHandler implements ActionHandler {
  readonly name = 'ClickApproval';
  readonly priority = 20;

  private _log: Logger;
  private _buttonPatterns: string[];

  constructor(logger: Logger, buttonPatterns?: string[]) {
    this._log = logger;
    this._buttonPatterns = buttonPatterns ?? [
      'Yes',
      'Approve',
      'Allow',
      'Accept',
      'Confirm',
      'OK',
      'Continue',
    ];
  }

  async isAvailable(_env: EnvironmentInfo): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
      await this._ps(`Add-Type -AssemblyName UIAutomationClient; 'ok'`);
      return true;
    } catch {
      return false;
    }
  }

  async execute(window: WindowInfo, _env: EnvironmentInfo): Promise<ActionResult> {
    const start = Date.now();
    try {
      const patternsJson = JSON.stringify(this._buttonPatterns);

      const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$hwnd = [IntPtr]${window.handle}
$element = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)

$btnCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$buttons = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCondition)

$patterns = ${patternsJson} | ConvertFrom-Json
$clicked = $false

foreach ($btn in $buttons) {
  $name = $btn.Current.Name
  foreach ($p in $patterns) {
    if ($name -like "*$p*") {
      $invokePattern = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invokePattern.Invoke()
      Write-Output "Clicked: $name"
      $clicked = $true
      break
    }
  }
  if ($clicked) { break }
}

if (-not $clicked) { throw "No matching button found" }`;

      const output = await this._ps(script);
      this._log.info('ClickApproval', `UIA click succeeded: ${output}`);

      return {
        success: true,
        handlerName: this.name,
        durationMs: Date.now() - start,
        metadata: { output },
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
