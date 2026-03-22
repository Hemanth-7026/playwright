import * as childProcess from 'child_process';
import type { DetectionResult, DetectionStrategy, EnvironmentInfo, DetectionPatternConfig, Logger } from '../../types';
import { matchesAny } from '../fuzzyMatch';

/**
 * Detects Okta Verify by scanning running processes.
 *
 * This is a secondary strategy — less precise than window-title matching
 * but still useful as a corroborating signal or fallback when the window
 * title has changed between application versions.
 */
export class ProcessMonitorStrategy implements DetectionStrategy {
  readonly name = 'ProcessMonitor';
  readonly priority = 20;

  private _patterns: DetectionPatternConfig;
  private _log: Logger;

  constructor(patterns: DetectionPatternConfig, logger: Logger) {
    this._patterns = patterns;
    this._log = logger;
  }

  async isAvailable(_env: EnvironmentInfo): Promise<boolean> {
    return process.platform === 'win32';
  }

  async detect(_env: EnvironmentInfo): Promise<DetectionResult> {
    const processes = await this._listProcesses();
    this._log.debug('ProcessMonitor', `Scanned ${processes.length} processes`);

    for (const proc of processes) {
      const nameMatch = matchesAny(
          proc.name,
          this._patterns.processNames,
          this._patterns.fuzzyThreshold,
      );

      if (nameMatch.matched) {
        this._log.info('ProcessMonitor', `Matched process: "${proc.name}" pid=${proc.pid} (score ${nameMatch.bestScore.toFixed(2)})`);
        return {
          detected: true,
          strategyName: this.name,
          confidence: nameMatch.bestScore * 0.8, // Lower confidence since process ≠ prompt
          metadata: { processName: proc.name, pid: proc.pid },
          timestamp: Date.now(),
        };
      }
    }

    return { detected: false, strategyName: this.name, confidence: 0, timestamp: Date.now() };
  }

  updatePatterns(patterns: DetectionPatternConfig): void {
    this._patterns = patterns;
  }

  private async _listProcesses(): Promise<{ name: string; pid: number }[]> {
    return new Promise((resolve) => {
      const script = `Get-Process | Select-Object ProcessName, Id | ConvertTo-Json -Compress`;
      childProcess.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 5000, windowsHide: true },
          (err, stdout) => {
            if (err) {
              this._log.warn('ProcessMonitor', 'Failed to list processes', { error: String(err) });
              resolve([]);
              return;
            }
            try {
              const raw = JSON.parse(stdout.trim().startsWith('[') ? stdout.trim() : `[${stdout.trim()}]`);
              resolve((raw as any[]).map(p => ({ name: p.ProcessName, pid: p.Id })));
            } catch {
              resolve([]);
            }
          },
      );
    });
  }
}
