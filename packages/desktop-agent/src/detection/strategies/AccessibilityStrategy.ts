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
$textType = [System.Windows.Automation.ControlType]::Text
$buttonType = [System.Windows.Automation.ControlType]::Button
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
    $safeName = [System.Text.RegularExpressions.Regex]::Replace($name, '[\\x00-\\x1f\\x7f]', '')
    $safeClassName = [System.Text.RegularExpressions.Regex]::Replace($w.Current.ClassName, '[\\x00-\\x1f\\x7f]', '')
    $descendantNames = New-Object System.Collections.Generic.List[string]
    $descendants = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $descendants) {
      try {
        $controlType = $child.Current.ControlType
        if ($controlType -ne $textType -and $controlType -ne $buttonType) {
          continue
        }
        $childName = [System.Text.RegularExpressions.Regex]::Replace($child.Current.Name, '[\\x00-\\x1f\\x7f]', '')
        if (-not [string]::IsNullOrWhiteSpace($childName) -and -not $descendantNames.Contains($childName)) {
          $descendantNames.Add($childName)
        }
      } catch {
      }
    }
    $results += [PSCustomObject]@{
      Name            = $safeName
      ProcessId       = $w.Current.ProcessId
      ClassName       = $safeClassName
      Handle          = $w.Current.NativeWindowHandle
      DescendantNames = @($descendantNames)
    }
  }
}
$results | ConvertTo-Json -Compress`;

      const raw = await this._ps(script);
      if (!raw)
        return { detected: false, strategyName: this.name, confidence: 0, timestamp: Date.now() };

      const rawPayload = raw.startsWith('[') ? raw : `[${raw}]`;
      const sanitized = this._sanitizeJson(raw);
      const payload = sanitized.startsWith('[') ? sanitized : `[${sanitized}]`;
      this._logPayload('Accessibility', rawPayload, 'raw');
      if (payload !== rawPayload)
        this._logPayload('Accessibility', payload, 'sanitized');

      let elements: any[];
      try {
        elements = JSON.parse(payload) as any[];
      } catch (e) {
        this._logPayload('Accessibility', rawPayload, 'raw', true);
        if (payload !== rawPayload)
          this._logPayload('Accessibility', payload, 'sanitized', true);
        throw e;
      }

      for (const el of elements) {
        const candidates = [el.Name ?? '', ...((el.DescendantNames as string[] | undefined) ?? [])]
            .filter(Boolean);
        const bestMatch = this._bestMatch(candidates);

        if (bestMatch.matched) {
          const matchedText = bestMatch.value;
          const windowInfo: WindowInfo = {
            handle: el.Handle ?? 0,
            title: matchedText,
            processId: el.ProcessId ?? 0,
            processName: '',
            className: el.ClassName ?? '',
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            isVisible: true,
            isMinimized: false,
          };

          this._log.info('Accessibility', `UIA matched: "${matchedText}" (score ${bestMatch.bestScore.toFixed(2)})`, {
            ownerWindow: el.Name ?? '',
          });
          return {
            detected: true,
            strategyName: this.name,
            confidence: bestMatch.bestScore,
            window: windowInfo,
            metadata: {
              matchedPattern: bestMatch.bestPattern,
              matchedText,
              ownerWindowTitle: el.Name ?? '',
              className: el.ClassName,
            },
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

  private _bestMatch(candidates: string[]): { matched: boolean; bestScore: number; bestPattern: string; value: string } {
    let bestScore = 0;
    let bestPattern = '';
    let bestValue = '';

    for (const candidate of candidates) {
      const match = matchesAny(
          candidate,
          this._patterns.windowTitles,
          this._patterns.fuzzyThreshold,
      );
      if (match.bestScore > bestScore) {
        bestScore = match.bestScore;
        bestPattern = match.bestPattern;
        bestValue = candidate;
      }
    }

    return {
      matched: bestScore >= this._patterns.fuzzyThreshold,
      bestScore,
      bestPattern,
      value: bestValue,
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
