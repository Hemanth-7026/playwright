import * as childProcess from 'child_process';
import type { DetectionResult, DetectionStrategy, EnvironmentInfo, DetectionPatternConfig, Logger, WindowInfo } from '../../types';
import { matchesAny } from '../fuzzyMatch';

/**
 * Detects Okta Verify using Windows UI Automation (UIA) via PowerShell.
 *
 * UIA provides richer signals (button labels, control types) than raw
 * window titles, making it more resilient to cosmetic UI changes.
 * However it is heavier and may not be available in all environments.
 */
export class AccessibilityStrategy implements DetectionStrategy {
  readonly name = 'Accessibility';
  readonly priority = 30;

  private _patterns: DetectionPatternConfig;
  private _log: Logger;
  private _available: boolean | null = null;

  constructor(patterns: DetectionPatternConfig, logger: Logger) {
    this._patterns = patterns;
    this._log = logger;
  }

  async isAvailable(_env: EnvironmentInfo): Promise<boolean> {
    if (this._available !== null)
      return this._available;

    try {
      // Test whether UIAutomation assembly can be loaded
      await this._ps(`Add-Type -AssemblyName UIAutomationClient; 'ok'`);
      this._available = true;
    } catch {
      this._available = false;
      this._log.warn('Accessibility', 'UIAutomation not available in this environment');
    }
    return this._available;
  }

  async detect(_env: EnvironmentInfo): Promise<DetectionResult> {
    try {
      const script = `
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window
)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
$results = @()
foreach ($w in $windows) {
  $name = $w.Current.Name
  if ($name) {
    $results += [PSCustomObject]@{
      Name      = $name
      ProcessId = $w.Current.ProcessId
      ClassName = $w.Current.ClassName
      Handle    = $w.Current.NativeWindowHandle
    }
  }
}
$results | ConvertTo-Json -Compress`;

      const raw = await this._ps(script);
      if (!raw)
        return { detected: false, strategyName: this.name, confidence: 0, timestamp: Date.now() };

      const elements = JSON.parse(raw.startsWith('[') ? raw : `[${raw}]`) as any[];

      for (const el of elements) {
        const titleMatch = matchesAny(
            el.Name ?? '',
            this._patterns.windowTitles,
            this._patterns.fuzzyThreshold,
        );

        if (titleMatch.matched) {
          const windowInfo: WindowInfo = {
            handle: el.Handle ?? 0,
            title: el.Name ?? '',
            processId: el.ProcessId ?? 0,
            processName: '',
            className: el.ClassName ?? '',
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            isVisible: true,
            isMinimized: false,
          };

          this._log.info('Accessibility', `UIA matched: "${el.Name}" (score ${titleMatch.bestScore.toFixed(2)})`);
          return {
            detected: true,
            strategyName: this.name,
            confidence: titleMatch.bestScore,
            window: windowInfo,
            metadata: { matchedPattern: titleMatch.bestPattern, className: el.ClassName },
            timestamp: Date.now(),
          };
        }
      }
    } catch (e) {
      this._log.warn('Accessibility', 'Detection failed', { error: String(e) });
    }

    return { detected: false, strategyName: this.name, confidence: 0, timestamp: Date.now() };
  }

  updatePatterns(patterns: DetectionPatternConfig): void {
    this._patterns = patterns;
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
