/** Fixed game steps, independent of display callbacks. Debt is measured in game
 * seconds. Capacity limiting discards requested wall-time debt, never a rule step;
 * the unserved amount and achieved speed are explicit diagnostics. */
export class SimulationClock {
  speed = 1;
  backlog = 0;
  unserved = 0;
  resetDebt = 0;
  private previous?: number;
  update(now: number): void {
    if (this.previous !== undefined) this.backlog += Math.max(0, now - this.previous) / 1000 * this.speed;
    this.previous = now;
    const limit = this.speed;
    if (this.backlog > limit) { this.unserved += this.backlog - limit; this.backlog = limit; }
  }
  reset(now?: number): void { this.resetDebt += this.backlog; this.previous = now; this.backlog = 0; }
  setSpeed(speed: number): void {
    if (![1, 2, 4, 8].includes(speed)) throw new RangeError('Speed must be 1, 2, 4 or 8');
    this.speed = speed; this.reset();
  }
  get due(): boolean { return this.backlog + 1e-10 >= 1 / 60; }
  consume(): void { this.backlog = Math.max(0, this.backlog - 1 / 60); }
  get delayMs(): number { return Math.max(0, (1 / 60 - this.backlog) * 1000 / this.speed); }
}
