import type { RenderStreamView } from './render-stream.ts';
import type { DifficultyId } from './commands';

export type { GamePhase } from './run/run-progression.ts';
import type { GamePhase } from './run/run-progression.ts';
export type EntityId = number | string;
export interface Point { x: number; y: number }

export interface ActorView extends Point {
  id: EntityId;
  kind: 'player' | 'enemy' | 'pet' | 'turret' | 'phantom' | 'chest';
  definitionId: string;
  /** null means intentionally procedural; undefined uses the default identity. */
  spriteId?: string | null;
  silhouette?: string;
  noEyes?: boolean;
  radius: number;
  angle: number;
  color: string;
  hp?: number;
  maxHp?: number;
  alpha?: number;
  scale?: number;
  downed?: boolean;
  boss?: boolean;
  facing?: number;
  accent?: string; blinkPhase?: number; age?: number;
  facePlayer?: boolean; faceRotate?: boolean;
  recoil?: number; spawnProgress?: number; glowPhase?: number;
  label?: string;
  shield?: number; maxShield?: number; hurtFlash?: number;
  invulnerability?: number; moving?: boolean; walkPhase?: number; mutant?: boolean;
  rescueProgress?: number; rescueNeed?: number; downCount?: number; wallFlash?: number;
  elite?: boolean; slot?: number;
  bubble?: { text: string; alpha: number };
  emote?: 'heal' | 'attack' | 'vacuum' | 'steal';
  vacuum?: { radius: number; progress: number };
}

export interface ProjectileView extends Point {
  id: EntityId;
  hostile: boolean;
  radius: number;
  angle: number;
  color: string;
  shape?: 'circle' | 'needle' | 'orb' | 'laser' | 'star' | 'rice' | 'drop' | 'shard' | 'petal' | 'ring' | 'blade' | 'jade' | 'paw' | 'bead';
  hitRadius?: number;
  anchor?: 'center' | 'head';
  length?: number;
  width?: number;
  alpha?: number;
  playerStyle?: 'coin' | 'orb' | 'tracer' | 'shot';
  trail?: readonly (Point & { alpha: number })[];
  age?: number;
}

export interface PickupView extends Point {
  id: EntityId;
  kind: 'xp' | 'material' | 'heal';
  variant: 1 | 2;
  bobPhase: number;
}

export interface EffectView extends Point {
  id: EntityId;
  kind: 'spark' | 'ring' | 'slash' | 'text' | 'explosion' | 'trail' | 'emitter'
    | 'thrust' | 'spin' | 'beam' | 'nova' | 'chain' | 'sparkle' | 'hit' | 'impact' | 'shockwave' | 'shard';
  variant?: 'blood' | 'orb' | 'vent' | 'wing' | 'glow' | 'glass' | 'blade' | 'crack';
  radius: number;
  color: string;
  alpha: number;
  angle?: number;
  text?: string;
  progress?: number; end?: Point; points?: readonly Point[]; arc?: number;
  playerOwned?: boolean;
  width?: number; power?: number; rays?: number; seed?: number; critical?: boolean;
  notes?: readonly { angle: number; speed: number; text: string; size: number; rotation: number; spin: number }[];
}

export interface TelegraphView extends Point {
  id: EntityId;
  kind: 'circle' | 'line' | 'cone';
  color: string;
  alpha: number;
  radius?: number;
  end?: Point;
  angle?: number;
  spread?: number;
  width?: number;
}

/** Live P1 values for display-frame HUD animation; no presentation state. */
export interface HudFrame {
  hp: number; maxHp: number; shield: number;
  xp: number; xpNeeded: number; level: number;
}
/** Small live top-bar values; menus retain their last combat display. */
export interface HudChromeFrame {
  wave: number; materials: number; secondsLeft: number;
  timerTotal: number; timerLabel: string; timerVisible: boolean;
  flandre: boolean;
}

export interface GameFrame {
  /** Borrowed compact transient stream; excludes these entities from the object arrays. */
  transients?: RenderStreamView;
  tick: number;
  time: number;
  phase: GamePhase;
  combat: boolean;
  hud?: Readonly<HudFrame> | null;
  hudChrome?: Readonly<HudChromeFrame> | null;
  camera: Point & { zoom: number; shake?: number };
  backgroundId: string;
  worldHalfSize: number;
  actors: readonly ActorView[];
  projectiles: readonly ProjectileView[];
  pickups: readonly PickupView[];
  effects: readonly EffectView[];
  telegraphs: readonly TelegraphView[];
  terrain?: readonly TerrainView[];
  weapons?: readonly WeaponView[];
  weather?: WeatherView;
  encounter?: EncounterView;
  comet?: CometView;
  maze?: MazeView;
}

export interface MazeView {
  plaza: Point & { width: number; height: number };
  bounds: Point & { width: number; height: number };
  entry: Point; exit: Point; walls: readonly TerrainView[];
}

export interface CometView {
  phase: string; time: number; age: number; center: Point;
  direction: number; halfSize: number; flash: number;
  bolts: readonly (Point & { landY: number; radius: number; vy: number; elapsed: number; landed: boolean; exploded: boolean; seed: number })[];
  rings: readonly (Point & { radius: number; elapsed: number; duration: number; delay: number; kind: string; warm: boolean })[];
  trails: readonly (Point & { radius: number; alpha: number })[];
}

export interface TerrainView extends Point {
  id: EntityId;
  kind: 'rect' | 'circle';
  width?: number; height?: number; radius?: number;
  material: 'ice' | 'wall' | 'tree';
  alpha?: number;
}
export interface WeaponView extends Point {
  id: EntityId; ownerId: EntityId; definitionId: string;
  angle: number; radius: number; alpha?: number;
  trail: readonly Point[]; orbitRadius: number; color: string; ballIndex: number;
}
export interface WeatherView {
  id: string; strength: number; fogStrength: number; elapsed: number; flash: number;
  meteors: readonly (Point & { id: EntityId; radius: number; progress: number; side?: number })[];
  burnZones: readonly (Point & { id: EntityId; radius: number; alpha: number })[];
  typhoons: readonly (Point & { id: EntityId; radius: number; angle: number })[];
  fogClouds?: readonly (Point & { id: EntityId; radius: number })[];
}
interface EncounterBase {
  state: string; time: number; introTime: number;
  arena: Point & { halfWidth: number; halfHeight: number };
  hp: number; maxHp: number; boss: Point; title?: string; flash?: number; fade?: number;
}
export type EncounterView =
  | (EncounterBase & { kind: 'flandre'; cardId: string; cardName: string; declaration: number; purgeCooldown: number })
  | (EncounterBase & { kind: 'vergil'; chairVisible: boolean; chairFacing: number; charge: number; veil: number; guarding?: boolean; guardShatter?: number;
      slashes: readonly (Point & { id: EntityId; angle: number; radius: number; alpha: number })[];
      rifts: readonly (Point & { id: EntityId; radius: number; alpha: number })[];
      blades: readonly { id: EntityId; x1: number; y1: number; x2: number; y2: number; alpha: number; seed: number }[] })
  | (EncounterBase & { kind: 'remilia'; sigil: number; ending: number; animationFrame?: number; alpha?: number;
      bats: readonly (Point & { width: number; height: number; alpha: number })[] })
  | (EncounterBase & { kind: 'halloween'; moonPhase: number; veil: number;
      cats: readonly (Point & { id: 'choco' | 'vanilla'; alpha: number; frame?: number })[];
      pumpkins: readonly (Point & { id: EntityId; radius: number; alpha: number; exploding?: boolean; progress?: number })[];
      candies: readonly (Point & { id: EntityId; color: string })[] });

export interface CharacterChoice {
  id: string; name: string; role: string; description: string; color: string;
  portraitId?: string;
  glyph?: string;
  statModifiers?: readonly { statId: string; name: string; value: number; percent: boolean }[];
  startWeapon?: { id: string; name: string; color: string };
  ability?: { name: string; text: string }; skill?: { name: string; text: string };
}
export interface DifficultyChoice { id: DifficultyId; name: string; color: string; description: string }
export interface DisplayStatRow { label: string; value: string | number; tone?: 'up' | 'down' | 'up-tip' }
export interface WeaponSummary {
  instanceId: number; definitionId: string; name: string; tier: number; level: number;
  color: string; glyph: string; kind: string; tierName: string; tierColor: string;
  tooltip: string; sellValue: number;
  recipe?: { targetName: string; targetColor: string; targetDescription: string; cost: number; canCombine: boolean; needMaterials: number };
}
export interface PlayerSummary {
  id: number; name: string; characterId: string;
  hp: number; maxHp: number; shield: number;
  level: number; xp: number; xpNeeded: number; materials: number; kills: number;
  damageDealt: number; damageTaken: number; timeAlive: number;
  downed: boolean; weapons: readonly WeaponSummary[];
  statDetails: readonly { statId: string; name: string; value: number; unit: 'flat' | 'percent'; description: string; formatted: string }[];
  items: readonly { id: string; name: string; count: number; color?: string; tooltip?: string }[];
  rerollCost: number;
  glyph?: string; color?: string; characterTip?: string; maxWeapons: number;
  waveIncome?: { total: number; harvest: number; clear: number; cleanup?: number } | null;
}
export interface OfferSummary {
  id: string; name: string; description: string; kind: 'weapon' | 'item';
  definitionId: string; price: number; tier: number; sold: boolean; locked: boolean;
  ownerId: number;
  color: string; glyph: string; tierName: string; tierColor: string;
  behaviorLabel: string; ownedCount: number; pawMark: boolean; tooltip: string;
  statRows: readonly DisplayStatRow[];
}
export interface UpgradeSummary {
  id: string; name: string; description: string; rarity: 'common' | 'rare' | 'epic' | 'legendary'; color: string;
  healAll: boolean;
  shieldPercent: number;
  glyph?: string; icon?: string; rarityColor: string; rarityName: string; mult: number;
  effectLines: readonly string[];
}
export interface RewardSummary {
  id: string; definitionId: string; name: string; description: string; sellValue: number;
  color?: string; glyph?: string; rare?: boolean;
}
export interface GameUiSnapshot {
  revision: number;
  phase: GamePhase;
  combat: boolean;
  wave: number;
  secondsLeft: number;
  difficulty: DifficultyId;
  difficultyInfo: DifficultyChoice;
  maxWaves: number;
  players: readonly PlayerSummary[];
  offers: readonly OfferSummary[];
  upgrades: readonly UpgradeSummary[];
  rewards: readonly RewardSummary[];
  retryStats: Readonly<{ wave: number; total: number; manual: number }>;
  rerollCost: number;
  pilot: boolean;
  canRetry: boolean;
  won: boolean;
  endless: boolean;
  challengeName?: string;
  timerLabel: string;
  timerVisible: boolean;
  timerTotal: number; challengeId?: 'flandre' | 'vergil' | 'remilia' | 'halloween';
  seed: number;
  autoUpgrade: boolean;
  unlockedChallenges: readonly string[];
}
