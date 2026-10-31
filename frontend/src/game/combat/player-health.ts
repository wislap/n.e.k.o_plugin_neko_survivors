/** Mutable health only: no entity, inventory, world or challenge knowledge. */
export interface HealthState {
  hp: number; shield: number; maxShield: number; shieldFullBlock: boolean;
  invuln: number; hurtFlash: number; damageTaken: number;
  dead: boolean; downed: boolean; duoMode: boolean | undefined;
  downCount: number; rescueProgress: number; _rescueIdle: number; _rescueGate: number;
  lsBudget: number;
}
export interface PlayerDamageOptions {
  ignoreIFrames?: boolean; fixedDamage?: number; noMiss?: boolean; weatherChecked?: boolean;
  pierceArmor?: boolean; trueBonus?: number; projectile?: boolean; noTaken?: boolean; invuln?: number;
}
export interface DirectHit {
  damage: number; sourceX: number; sourceY: number; invulnerabilitySeconds: number;
  /** Halloween historically accepts hits while downed; other direct profiles reject them. */
  ignoreDowned: boolean;
  onApplied?: () => void;
}
export interface HealthHooks {
  tryLethalSave(sourceX?: number, sourceY?: number): boolean;
  onHealthDamage(): void;
  onShieldBreak(): void;
  onHurt(damage: number, sourceX: number, sourceY: number): void;
  onDodge(): void;
  onDeath(): void;
  onDown(): void;
  onRevive(): void;
  onKnockdown(): void;
  onOverheal(overflow: number): void;
}
export interface DamageDefense {
  avoids(options: PlayerDamageOptions): boolean;
  modify(amount: number, options: PlayerDamageOptions): number;
  invulnerability(options: PlayerDamageOptions): number;
}
export const CONTACT_INVULN = 0.8;
export const PROJECTILE_INVULN = 0.6;
export const LIFESTEAL_PROCS_PER_SEC = 10;

/** A takeover remembers a fraction only for a living actor. Display rounding never enters rules. */
export function captureHealthFraction(state: Pick<HealthState, 'hp' | 'dead' | 'downed'>, maxHp: number): number | null {
  if (state.dead || state.downed) return null;
  if (!Number.isFinite(state.hp) || !Number.isFinite(maxHp) || maxHp < 1 || state.hp <= 0 || state.hp > maxHp) {
    throw new TypeError('接管生命状态不一致');
  }
  return state.hp / maxHp;
}
export function restoreHealthFraction(state: Pick<HealthState, 'hp' | 'dead' | 'downed'>, fraction: number, maxHp: number): void {
  if (state.dead || state.downed) return;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1 || !Number.isFinite(maxHp) || maxHp < 1) {
    throw new TypeError('交还生命状态不一致');
  }
  state.hp = Math.min(maxHp, Math.max(1, fraction * maxHp));
}

export function rescueNeed(state: Pick<HealthState, 'downCount'>) {
  return state.downCount <= 1 ? 5 : state.downCount === 2 ? 10 : 30;
}
export function rescueRegain(state: Pick<HealthState, 'downCount'>) {
  return state.downCount <= 1 ? 0.4 : state.downCount === 2 ? 1 : 2.5;
}
export function downPlayer(state: HealthState, hooks: HealthHooks) {
  state.downed = true;
  state.downCount += 1;
  state.rescueProgress = rescueNeed(state);
  state._rescueIdle = 0;
  state._rescueGate = 0;
  state.dead = false;
  state.hp = 0;
  state.invuln = 1.5;
  hooks.onKnockdown();
  hooks.onDown();
}
function settleLethal(state: HealthState, hooks: HealthHooks, notifyDeath: boolean) {
  if (!(state.hp <= 0)) return;
  state.hp = 0;
  if (state.duoMode) downPlayer(state, hooks);
  else {
    state.dead = true;
    if (notifyDeath) hooks.onDeath();
  }
}
function absorbShield(state: HealthState, damage: number, fullBlock: boolean, hooks: HealthHooks) {
  if (!(state.shield > 0)) return damage;
  const absorbed = fullBlock ? damage : Math.min(state.shield, damage);
  state.shield = fullBlock ? 0 : state.shield - absorbed;
  if (state.shield <= 0) {
    state.shield = 0;
    hooks.onShieldBreak();
  }
  return fullBlock ? 0 : damage - absorbed;
}
interface HealthCommit {
  amount: number; toHp: number; sourceX: number; sourceY: number;
  invulnerability: number | undefined;
  defensiveAbilities: boolean;
  notifyDeath: boolean;
  onApplied?: () => void;
}
function commitDamage(state: HealthState, commit: HealthCommit, hooks: HealthHooks) {
  state.hp -= commit.toHp;
  state.damageTaken += commit.amount;
  if (commit.invulnerability !== undefined) state.invuln = commit.invulnerability;
  state.hurtFlash = 0.25;
  if (commit.defensiveAbilities) {
    if (commit.toHp > 0) hooks.onHealthDamage();
    hooks.onHurt(commit.amount, commit.sourceX, commit.sourceY);
  }
  commit.onApplied?.();
  settleLethal(state, hooks, commit.notifyDeath);
  return commit.amount;
}
/** Fixed and ordinary hits share the commit path, but retain their distinct policies. */
export function receiveDamage(state: HealthState, damage: number, sourceX: number, sourceY: number,
  options: PlayerDamageOptions, defense: DamageDefense, hooks: HealthHooks) {
  const ignoreI = options.ignoreIFrames === true;
  if (state.downed || state.dead || (!ignoreI && state.invuln > 0)) return 0;
  if (defense.avoids(options)) { hooks.onDodge(); return 0; }
  const fixedDamage = options.fixedDamage;
  const fixed = fixedDamage != null;
  const final = fixed ? Math.max(1, fixedDamage) : defense.modify(damage, options);
  const toHp = absorbShield(state, final, !fixed && state.shieldFullBlock, hooks);
  if (toHp > 0 && toHp >= state.hp && state.hp > 0
      && (fixed ? hooks.tryLethalSave() : hooks.tryLethalSave(sourceX, sourceY))) {
    // Protected hits historically add zero to damageTaken: the old ability set
    // HP to one before the statistic sampled HP-1. Keep that receipt unchanged.
    state.hp = 1;
    hooks.onHurt(toHp, sourceX, sourceY);
    return toHp;
  }
  return commitDamage(state, {
    amount: final, toHp, sourceX, sourceY,
    invulnerability: !fixed && !ignoreI ? defense.invulnerability(options) : undefined,
    defensiveAbilities: true, notifyDeath: true,
  }, hooks);
}
/** Direct profiles bypass shields, evasion, armor and character defensive abilities. */
export function receiveDirectHit(state: HealthState, hit: DirectHit, hooks: HealthHooks) {
  if (state.invuln > 0 || state.dead || (!hit.ignoreDowned && state.downed)) return 0;
  return commitDamage(state, {
    amount: hit.damage, toHp: hit.damage, sourceX: hit.sourceX, sourceY: hit.sourceY,
    invulnerability: hit.invulnerabilitySeconds, defensiveAbilities: false, notifyDeath: false,
    onApplied: hit.onApplied,
  }, hooks);
}
export function healPlayer(state: HealthState, amount: number, maxHp: number, hooks: HealthHooks) {
  const before = state.hp;
  state.hp = Math.min(maxHp, state.hp + amount);
  const healed = state.hp - before;
  const overflow = amount - healed;
  if (overflow > 0) hooks.onOverheal(overflow);
  return healed;
}
export function addPlayerShield(state: HealthState, amount: number, replace: boolean) {
  if (!(amount > 0)) return 0;
  const before = state.shield;
  state.shield = replace ? Math.max(state.shield, amount) : state.shield + amount;
  state.maxShield = Math.max(state.maxShield, state.shield);
  return state.shield - before;
}
export function rescuePlayer(state: HealthState, maxHp: number, hooks: HealthHooks) {
  if (!state.downed || (state._rescueGate ?? 0) > 0) return false;
  state._rescueGate = 0.2;
  state._rescueIdle = 0;
  state.rescueProgress = Math.max(0, Math.round(state.rescueProgress ?? rescueNeed(state)) - 1);
  if (!(state.rescueProgress <= 0)) return false;
  state.downed = false;
  state.hp = Math.max(1, Math.round(maxHp * 0.3));
  state.invuln = 2;
  hooks.onRevive();
  return true;
}
export function refillLifesteal(state: Pick<HealthState, 'lsBudget'>, dt: number) {
  state.lsBudget = Math.min(LIFESTEAL_PROCS_PER_SEC,
    (state.lsBudget ?? LIFESTEAL_PROCS_PER_SEC) + LIFESTEAL_PROCS_PER_SEC * dt);
  return state.lsBudget;
}

/** The chance roll precedes the budget check, including exhausted-budget hits. */
export function applyLifesteal(state: Pick<HealthState, 'lsBudget'>, chance: number, context: {
  blocked: boolean;
  random: { next(): number };
  heal(): number;
}) {
  if (chance <= 0 || context.blocked) return 0;
  if (context.random.next() * 100 >= chance) return 0;
  if ((state.lsBudget ?? LIFESTEAL_PROCS_PER_SEC) < 1) return 0;
  state.lsBudget -= 1;
  return context.heal();
}
