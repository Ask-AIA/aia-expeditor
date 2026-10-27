/**
 * Clock port: domain and application code read time through this
 * interface so tests can freeze it.
 */
export interface ClockPort {
  now(): Date;
}

/** Production clock: the real wall-clock time. */
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

/**
 * Controllable clock for tests. Starts at `initial` and only moves
 * when `advanceBy` or `setTo` is called.
 */
export class FixedClock implements ClockPort {
  private current: Date;

  constructor(initial: Date) {
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceBy(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  setTo(date: Date): void {
    this.current = new Date(date.getTime());
  }
}
