/** A frame owns only the identities it presents. No entity state is retained here. */
export class DisplayObjectIndex<T extends { destroy(): void }> {
  private readonly entries = new Map<string | number, T>();
  sync<V extends { id: string | number }>(
    values: readonly V[],
    create: (value: V) => T,
    update: (display: T, value: V) => void,
  ): void {
    const live = new Set<string | number>();
    for (const value of values) {
      if (live.has(value.id)) throw new Error(`Duplicate display identity: ${value.id}`);
      live.add(value.id);
      let display = this.entries.get(value.id);
      if (!display) {
        display = create(value);
        this.entries.set(value.id, display);
      }
      update(display, value);
    }
    for (const [id, display] of this.entries) {
      if (!live.has(id)) {
        this.entries.delete(id);
        display.destroy();
      }
    }
  }
  get size(): number { return this.entries.size; }
  dispose(): void {
    for (const display of this.entries.values()) display.destroy();
    this.entries.clear();
  }
}
