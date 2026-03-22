import type { DetectionResult, DetectionStrategy, EnvironmentInfo, DetectionPatternConfig, Logger } from '../../types';
import { matchesAny } from '../fuzzyMatch';
import { WindowScanner } from '../../window/WindowScanner';

/**
 * Detects Okta Verify by scanning visible window titles against
 * config-driven patterns with fuzzy matching.
 *
 * This is the primary (and most portable) detection strategy.
 */
export class WindowTitleStrategy implements DetectionStrategy {
  readonly name = 'WindowTitle';
  readonly priority = 10;

  private _patterns: DetectionPatternConfig;
  private _scanner: WindowScanner;
  private _log: Logger;

  constructor(patterns: DetectionPatternConfig, logger: Logger) {
    this._patterns = patterns;
    this._scanner = new WindowScanner(logger);
    this._log = logger;
  }

  async isAvailable(_env: EnvironmentInfo): Promise<boolean> {
    // Available on all Windows systems
    return process.platform === 'win32';
  }

  async detect(env: EnvironmentInfo): Promise<DetectionResult> {
    const windows = await this._scanner.listWindows();
    this._log.debug('WindowTitle', `Scanned ${windows.length} windows`);

    for (const win of windows) {
      const titleMatch = matchesAny(
          win.title,
          this._patterns.windowTitles,
          this._patterns.fuzzyThreshold,
      );

      if (titleMatch.matched) {
        this._log.info('WindowTitle', `Matched window: "${win.title}" (score ${titleMatch.bestScore.toFixed(2)}, pattern "${titleMatch.bestPattern}")`);
        return {
          detected: true,
          strategyName: this.name,
          confidence: titleMatch.bestScore,
          window: win,
          metadata: { matchedPattern: titleMatch.bestPattern },
          timestamp: Date.now(),
        };
      }
    }

    return { detected: false, strategyName: this.name, confidence: 0, timestamp: Date.now() };
  }

  /** Allow live config refresh. */
  updatePatterns(patterns: DetectionPatternConfig): void {
    this._patterns = patterns;
  }
}
