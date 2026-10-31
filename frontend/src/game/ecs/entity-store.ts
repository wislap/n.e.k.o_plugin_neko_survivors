import { nextEntityId } from '../actors/entity.ts';
import { MOTION_FIELDS, createComponentColumns, type ComponentColumns } from './components.ts';

/** Numeric components are authoritative in one dense table. Object identities
 * remain stable for encounter controllers and synchronous combat callbacks. */
export class ComponentEntity {
  readonly id = nextEntityId();
  #local: Record<string, number> | undefined;
  #binding: { columns: ComponentColumns; values: Float64Array[]; fields: readonly string[]; lifetime: { active: boolean }; row: number } | undefined;
  #standalone: { columns: ComponentColumns; values: Float64Array[]; fields: readonly string[]; lifetime: { active: boolean }; row: number } | undefined;
  declare x: number; declare y: number; declare vx: number; declare vy: number;
  declare radius: number; declare age: number; declare dead: boolean;
  protected initializeComponents(values: Record<string, number>): void { this.#local = values; }
  get componentState() { return this.#binding ?? this.#standalone; }
  get componentRow(): number { return this.#binding?.lifetime.active ? this.#binding.row : -1; }
  get componentColumns(): ComponentColumns | undefined { return this.#binding?.lifetime.active ? this.#binding.columns : undefined; }
  readComponent(name: string): number { const binding = this.#binding ?? this.#standalone; return binding ? binding.columns[name][binding.row] : this.#local?.[name] ?? 0; }
  writeComponent(name: string, value: number): void {
    const binding = this.#binding ?? this.#standalone;
    if (binding) binding.columns[name][binding.row] = value;
    else (this.#local ??= {})[name] = value;
  }
  bindComponents(columns: ComponentColumns, values: Float64Array[], fields: readonly string[], lifetime: { active: boolean }, row: number): void {
    if (this.#binding?.lifetime.active) throw new TypeError('Entity already belongs to a component table');
    for (let i = 0; i < fields.length; i++) values[i][row] = this.readComponent(fields[i]);
    this.#local = undefined; this.#standalone = undefined; this.#binding = { columns, values, fields, lifetime, row };
  }
  moveComponentRow(row: number): void { if (!this.#binding) throw new TypeError('Detached entity'); this.#binding.row = row; }
  detachComponents(): void {
    if (!this.#binding) return;
    const local: Record<string, number> = {};
    const { fields, values, row } = this.#binding;
    for (let i = 0; i < fields.length; i++) local[fields[i]] = values[i][row];
    this.#local = local; this.#binding = undefined;
  }
  numericComponents(fields: readonly string[]) {
    if (this.#binding) return this.#binding;
    if (!this.#standalone) {
      const columns = createComponentColumns(fields);
      for (const name of fields) columns[name] = new Float64Array([this.#local?.[name] ?? 0]);
      this.#standalone = { columns, values: fields.map(name => columns[name]), fields, lifetime: { active: false }, row: 0 }; this.#local = undefined;
    }
    return this.#standalone;
  }
}
/** Shared prototype accessors support existing controllers, never per-entity Maps. */
export function defineComponents(prototype: object, fields: readonly string[], booleans: readonly string[] = [], start = 0): void {
  for (let index = start; index < fields.length; index++) {
    const name = fields[index], boolean = booleans.includes(name);
    Object.defineProperty(prototype, name, {
      configurable: false, enumerable: true,
      get(this: ComponentEntity) {
        const binding = this.componentState;
        const value = binding ? binding.values[index][binding.row] : this.readComponent(name);
        return boolean ? !!value : value;
      },
      set(this: ComponentEntity, value: number | boolean) {
        const binding = this.componentState;
        if (binding) binding.values[index][binding.row] = Number(value);
        else this.writeComponent(name, Number(value));
      },
    });
  }
}

defineComponents(ComponentEntity.prototype, MOTION_FIELDS, ['dead']);

/** Physical rows follow the old list's reverse sweep/swap order exactly.
 * Logical IDs never recycle. Removed facades detach before rows are reused. */
export class ComponentList<T extends ComponentEntity> {
  readonly items: T[] = [];
  private data: ComponentColumns;
  get columns(): ComponentColumns { return this.data; }
  private lifetime = { active: true };
  private readonly identities = new Map<number, T>();
  private values: Float64Array[];
  private capacity = 0;
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) { this.fields = fields; this.data = createComponentColumns(fields); this.values = fields.map(name => this.columns[name]); }
  private reserve(size: number): void {
    if (size <= this.capacity) return;
    this.capacity = Math.max(64, this.capacity * 2, size);
    for (let i = 0; i < this.fields.length; i++) { const name = this.fields[i], next = new Float64Array(this.capacity); next.set(this.columns[name]); this.columns[name] = this.values[i] = next; }
  }
  add(entity: T): T {
    if (this.identities.has(entity.id) || entity.componentRow !== -1) throw new TypeError('Entity already belongs to a component table');
    this.reserve(this.items.length + 1); entity.bindComponents(this.columns, this.values, this.fields, this.lifetime, this.items.length);
    this.identities.set(entity.id, entity); this.items.push(entity); return entity;
  }
  get(id: number): T | undefined { return this.identities.get(id); }
  sweep(onRemove?: (entity: T) => void): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.columns.dead[i]) continue;
      const entity = this.items[i], lastIndex = this.items.length - 1;
      entity.detachComponents(); this.identities.delete(entity.id);
      const last = this.items.pop()!;
      if (i < this.items.length) {
        this.items[i] = last;
        for (const name of this.fields) this.columns[name][i] = this.columns[name][lastIndex];
        last.moveComponentRow(i);
      }
      onRemove?.(entity);
    }
  }
  clear(): void {
    // Retired facades retain their old block; fresh rows never alias those values.
    // Whole-wave removal does not copy every numeric field of every entity.
    this.lifetime.active = false;
    this.data = createComponentColumns(this.fields); this.values = this.fields.map(name => this.data[name]);
    this.lifetime = { active: true }; this.capacity = 0;
    this.items.length = 0; this.identities.clear();
  }
  get length(): number { return this.items.length; }
}
