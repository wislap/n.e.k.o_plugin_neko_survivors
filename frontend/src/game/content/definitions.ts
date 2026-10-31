import type { StatModifiers } from '../progression/stats.ts';

export type CharacterId = 'yui' | 'mimi' | 'luna' | 'shiro' | 'nana' | 'kuro' | 'youyi' | 'neon_party';
export type WeaponId = 'cat_paw' | 'claw_glove' | 'fish_shield' | 'shadow_dagger' | 'pebble_toss' | 'star_wand' | 'lucky_coin' | 'toy_turret' | 'tuna_blade' | 'mouse_toy' | 'crit_lance' | 'yarn_thrower' | 'bubble_gun' | 'bell_chime' | 'cardboard_turret' | 'fish_bone_scythe' | 'iron_hammer' | 'thousand_claw' | 'laser_pointer' | 'meteor_paw' | 'chain_bell' | 'cat_ear_turret' | 'void_scythe' | 'cat_king_hammer' | 'nine_lives_claw' | 'meow_cannon' | 'thunder_god_bell' | 'meow_fortress';
export type ItemId = 'laevatein' | 'yamato' | 'warm_milk' | 'cat_armor' | 'lucky_bell' | 'thick_fur' | 'healing_herb' | 'sharp_fang' | 'catnip' | 'scope_lens' | 'iron_knuckle' | 'magic_gem' | 'crit_eye' | 'glass_cannon' | 'gear_oil' | 'radar_chip' | 'turret_blueprint' | 'steel_plate' | 'shiny_coin' | 'magnet_paw' | 'four_leaf' | 'lucky_cat' | 'running_shoes' | 'feather' | 'ap_round' | 'cursed_collar' | 'blood_pact' | 'greed_idol' | 'berserk_pill' | 'dried_fish' | 'lobster_pillow' | 'smart_wand' | 'dr_m_notes' | 'lucky_cat_paw' | 'black_cape' | 'cat_taffy' | 'overload_chip';
export type EnemyId = 'slime' | 'mouse' | 'bat' | 'crab' | 'spitter' | 'bomber' | 'tank' | 'charger' | 'splitter' | 'ghost' | 'chaos_egg' | 'spiral_cat' | 'blade_cat' | 'stalker' | 'healer_bunny' | 'elite_crab' | 'elite_spitter' | 'treasure_mimic' | 'treasure_mimic_elite' | 'boss_cat_king' | 'boss_void_lord' | 'boss_pandora' | 'boss_nono' | 'boss_acid_cat' | 'boss_apple_cider' | 'flandre' | 'flandre_sit' | 'flandre_idle2' | 'flandre_idle3' | 'flandre_idle4' | 'flandre_sit2' | 'flandre_sit3' | 'flandre_laevateinn';
export type UpgradeId = 'up_maxhp' | 'up_damage' | 'up_attackspeed' | 'up_movespeed' | 'up_armor' | 'up_regen' | 'up_pickup' | 'up_harvest' | 'up_crit' | 'up_critdmg' | 'up_lifesteal' | 'up_dodge' | 'up_luck' | 'up_range' | 'up_melee' | 'up_ranged' | 'up_elem' | 'up_glass' | 'up_fortress' | 'up_greed' | 'up_berserk' | 'up_heal_now';
export type WeatherId = 'fog' | 'bloodMoon' | 'meteor' | 'rain' | 'breeze' | 'typhoon' | 'clear' | 'scorch' | 'calm' | 'riverFog';
export type DifficultyId = 'easy' | 'normal' | 'hard' | 'nightmare';
export type RarityId = 'common' | 'rare' | 'epic' | 'legendary';
export type WeaponTier = 1 | 2 | 3 | 4;

export interface CharacterDefinition {
  id: CharacterId;
  name: string;
  role: string;
  color: string;
  accent: string;
  glyph: string;
  desc: string;
  stats: StatModifiers;
  mods: StatModifiers;
  pct: StatModifiers;
  startWeapon: WeaponId;
  rerollCostMul?: number;
}

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  tier: WeaponTier;
  kind: 'melee' | 'ranged' | 'element' | 'turret';
  behavior: 'sweep' | 'thrust' | 'spin' | 'shot' | 'homing' | 'bounce' | 'deploy' | 'orbit' | 'spread' | 'nova' | 'quake' | 'flurry' | 'beam' | 'chain' | 'aura';
  color: string;
  glyph: string;
  damage: number;
  cooldown: number;
  range: number;
  arc?: number;
  knockback?: number;
  desc: string;
  width?: number;
  critBonus?: number;
  speed?: number;
  pierce?: number;
  homing?: number;
  bounces?: number;
  turretLife?: number;
  turretMax?: number;
  turretCooldown?: number;
  orbitCount?: number;
  orbitSpeed?: number;
  orbitBallRadius?: number;
  critDamageBonus?: number;
  shots?: number;
  spreadAngle?: number;
  lifesteal?: number;
  shockwave?: boolean;
  stun?: number;
  thrusts?: number;
  explosionRadius?: number;
  chains?: number;
  chainRange?: number;
  armorShred?: number;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  color: string;
  glyph: string;
  price: number;
  finalDamageMul?: number;
  finalTakenMul?: number;
  maxStacks?: number;
  flandreOnly?: boolean;
  desc: string;
  bossDropOnly?: boolean;
  mods?: StatModifiers;
  pct?: StatModifiers;
  curse?: StatModifiers;
  apPierce?: number;
  levelUpAllStats?: number;
  lifestealHealBonus?: number;
  lifestealDamageMul?: boolean;
  forceHoming?: boolean;
  rangeFinalMul?: number;
  thornsRadius?: number;
  thornsArmorMul?: number;
  critAgainChance?: number;
  hurtMissChance?: number;
  statCapBonus?: StatModifiers;
  healDoubleBelowHalf?: boolean;
  hitDebuff?: { perHit: number; max: number };
}

export interface EnemyDefinition {
  id: EnemyId;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  color: string;
  shape: 'blob' | 'tri' | 'diamond' | 'hex' | 'circle' | 'square' | 'chest' | 'star' | 'shrimp' | 'bottle';
  behavior: 'chase' | 'zigzag' | 'orbit' | 'shooter' | 'exploder' | 'chaseShooter' | 'charger' | 'splitter' | 'healer' | 'flee' | 'boss' | 'meleeBoss' | 'tank';
  xp: number;
  materials: number;
  desc: string;
  armor?: number;
  projectileShape?: 'drop' | 'shard' | 'star' | 'petal' | 'blade';
  attackCooldown?: number;
  attackRange?: number;
  projectileSpeed?: number;
  projectileDamage?: number;
  explosionDamage?: number;
  explosionRadius?: number;
  projectileColor?: string;
  bulletPattern?: 'aimed' | 'random' | 'spiral' | 'ring' | 'spread';
  projectileCount?: number;
  projectileRadius?: number;
  chargeSpeed?: number;
  chargeWindup?: number;
  chargeDuration?: number;
  chargeDistanceMul?: number;
  splitInto?: EnemyId;
  splitCount?: number;
  dodge?: number;
  randomSpread?: number;
  spiralStep?: number;
  spawnFromWave?: number;
  healRadius?: number;
  healInterval?: number;
  healPct?: { normal: number; elite: number; boss: number };
  healBuffDuration?: number;
  healBuff?: { damagePct: number; damageReduction: number };
  keepDistance?: number;
  elite?: boolean;
  scale?: number;
  projectileSpread?: number;
  glow?: boolean;
  treasure?: boolean;
  treasureRare?: boolean;
  boss?: boolean;
  bossName?: string;
  summonCount?: number;
  summonCooldown?: number;
  bulletJitterDeg?: number | [number, number];
  noCanvasEyes?: boolean;
  kite?: string;
  phase3SpeedMul?: number;
  crystalEvery?: number;
  crystalColor?: string;
  crystalFan?: { fromPhase: number; count: number; spreadDeg: number; speedMul: number; colors: (string)[] };
  phase3CrystalRings?: boolean;
  phase3RainbowRing?: boolean;
  signature?: 'pandora' | 'nono';
  hpNightmare?: number;
  facePlayer?: boolean;
  faceRotate?: boolean;
  phaseCharge?: boolean;
  phaseWaterJet?: { retreatDistance: number; retreatDuration: number; windup: number; jetSpeed: number; jetLength: number; jetWidth: number; jetDamage: number; jetCount: number; cooldown: number };
  projectileRange?: number;
  chaseSpeedMul?: number;
  chargeRepeats?: number;
  phase3AppleCrystals?: { color: string };
}

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  glyph: string;
  icon: string;
  color: string;
  mods?: StatModifiers;
  maxLevel: number;
  weight: number;
  desc: string;
  pct?: StatModifiers;
  heal?: number;
  shieldPct?: { common: number; rare: number; epic: number; legendary: number };
}

interface WeatherDefinitionBase {
  id: WeatherId;
  name: string;
  color: string;
  rampS: number;
  hint: string;
  say: string;
  miss?: number;
  atkBase?: number;
  atkStep?: number;
  atkStepS?: number;
  outMul?: number;
  moveMul?: number;
  invulnMin?: number;
  noKnockback?: boolean;
  vacuum?: boolean;
  dotPct?: number;
  regenPct?: number;
}

/** Each weather identity requires its actual mechanism parameters. */
interface WeatherParameters {
  fog: { miss: number };
  bloodMoon: { atkBase: number; atkStep: number; atkStepS: number };
  meteor: {};
  rain: { outMul: number };
  breeze: { moveMul: number };
  typhoon: { invulnMin: number; noKnockback: boolean };
  clear: { vacuum: boolean };
  scorch: { dotPct: number };
  calm: { regenPct: number };
  riverFog: {};
}
export type WeatherDefinition = {
  [K in WeatherId]: WeatherDefinitionBase & { id: K } & WeatherParameters[K]
}[WeatherId];

export interface CharacterSkillDefinition {
  ability: { name: string; text: string };
  skill: { name: string; text: string };
  params: { xpMul?: number; harvestPerRound?: number; lethalInvuln?: number; lethalSpeedMul?: number; lethalSpeedTime?: number; lethalPerRound?: number; lobsterChance?: number; lobsterMul?: number; distanceBonusMax?: number; distanceFull?: number; stackDamage?: number; stackMove?: number; stackDuration?: number; stackGold?: number; luckPerHarvest?: number; luckyHitChance?: number; luckyHitMul?: number; luckyGuardReduction?: number; luckyChanceMax?: number; luckyChancePerLuck?: number; meleeRangeMul?: number; curseInterval?: number; curseChance?: number; curseChancePerAS?: number; curseDuration?: number; curseDamageMul?: number; curseSpeedMul?: number; curseRateMul?: number; shieldMaxPct?: number; breakLockout?: number; stackPerHit?: number; stackMax?: number };
  statMul?: Partial<Record<keyof StatModifiers | 'damageTaken', number>>;
  statsFinalMul?: StatModifiers;
  luckEffectMul?: number;
}

export interface DifficultyDefinition {
  id: DifficultyId;
  name: string;
  tag: string;
  color: string;
  desc: string;
  enemyHp: number;
  enemyDamage: number;
  enemyCount: number;
  enemySpeed: number;
  enemyFireRate: number;
  bulletCount: number;
  bulletSpeed: number;
  materialMul: number;
  xpMul: number;
  enemySpeedMelee?: number;
}

export interface WaveDefinition {
  spawns: ({ id: EnemyId; weight: number })[];
  budget: number;
  elites?: number;
  boss?: EnemyId;
  isBoss?: boolean;
  duration?: number;
  bosses?: EnemyId[];
  endless?: boolean;
}

export interface UpgradeRarity { id: RarityId; name: string; color: string; mult: number; downsideMult: number; weight: number }
export interface ScaledUpgrade extends Omit<UpgradeDefinition, 'shieldPct'> { rarity: RarityId; rarityName: string; rarityColor: string; mult: number; shieldPct: number }
export interface WeaponRecipe { from: WeaponId; to: WeaponId; cost: number }
