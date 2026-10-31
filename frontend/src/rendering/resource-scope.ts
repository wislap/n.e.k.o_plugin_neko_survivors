/** Refcounted asynchronous ownership shared by renderer instances during remounts. */
export class ResourcePool<T> {
  private readonly entries = new Map<string, { users: number; promise: Promise<T>; settled: boolean }>();
  private readonly unloading = new Map<string, Promise<void>>();
  constructor(private readonly load: (url: string) => Promise<T>, private readonly unload: (url: string) => Promise<void>) {}
  acquire(url: string): { value: Promise<T>; release(): void } {
    let entry = this.entries.get(url);
    if (!entry) {
      entry = { users: 0, settled: false, promise: (this.unloading.get(url) ?? Promise.resolve()).then(() => this.load(url)) };
      const captured = entry;
      this.entries.set(url, entry);
      entry.promise = entry.promise.then(value => {
        captured.settled = true;
        if (captured.users === 0) this.releaseEntry(url, captured);
        return value;
      }, error => {
        captured.settled = true;
        if (this.entries.get(url) === captured) this.entries.delete(url);
        throw error;
      });
    }
    entry.users++;
    let released = false;
    return { value: entry.promise, release: () => {
      if (released) return;
      released = true;
      entry.users--;
      if (entry.users === 0 && entry.settled) this.releaseEntry(url, entry);
    } };
  }
  private releaseEntry(url: string, entry: { users: number; promise: Promise<T>; settled: boolean }): void {
    if (this.entries.get(url) !== entry) return;
    this.entries.delete(url);
    // Serialize future acquires after unload to prevent stale cache races.
    const unloading = Promise.resolve().then(() => this.unload(url));
    this.unloading.set(url, unloading);
    void unloading.finally(() => {
      if (this.unloading.get(url) === unloading) this.unloading.delete(url);
    }).catch(() => undefined);
  }
}
