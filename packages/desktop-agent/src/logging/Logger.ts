import type { LogEntry, LogLevel, Logger as ILogger } from '../types';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Structured logger with component tagging and configurable verbosity.
 *
 * All log entries are emitted as structured JSON so they can be consumed
 * by external log aggregators or written to file.
 */
export class Logger implements ILogger {
  private _level: LogLevel;
  private _listeners: ((entry: LogEntry) => void)[] = [];

  constructor(level: LogLevel = 'info') {
    this._level = level;
  }

  setLevel(level: LogLevel): void {
    this._level = level;
  }

  /** Subscribe to log entries (for file writers, remote sinks, etc.). */
  onEntry(listener: (entry: LogEntry) => void): void {
    this._listeners.push(listener);
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this._emit('debug', component, message, data);
  }

  info(component: string, message: string, data?: Record<string, unknown>): void {
    this._emit('info', component, message, data);
  }

  warn(component: string, message: string, data?: Record<string, unknown>): void {
    this._emit('warn', component, message, data);
  }

  error(component: string, message: string, data?: Record<string, unknown>): void {
    this._emit('error', component, message, data);
  }

  // -----------------------------------------------------------------------

  private _emit(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this._level])
      return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...(data ? { data } : {}),
    };

    // Structured console output
    const prefix = `[${entry.timestamp}] [${level.toUpperCase().padEnd(5)}] [${component}]`;
    if (level === 'error')
      // eslint-disable-next-line no-console
      console.error(`${prefix} ${message}`, data ?? '');
    else if (level === 'warn')
      // eslint-disable-next-line no-console
      console.warn(`${prefix} ${message}`, data ?? '');
    else
      // eslint-disable-next-line no-console
      console.log(`${prefix} ${message}`, data ?? '');

    for (const listener of this._listeners)
      listener(entry);
  }
}
