import { GameDisplayBuffer, displayRawData, type DisplayFrame } from './display-frame.ts';
import { GameFrameBuffer, emptyProjectileView } from './frame-buffer.ts';
import type { SessionEngine } from './session-engine.ts';
import type { Player } from './actors/player.ts';
import type { EnemyBody } from './actors/enemy.ts';
import type { Chest } from './actors/chest.ts';
import type { Pet } from './actors/pet.ts';
import type { Turret } from './actors/turret.ts';
import type { PhantomClone } from './actors/phantom.ts';
import type { WeaponInstance } from './actors/weapon.ts';
import type { ActorView, EntityId, GameFrame, GameUiSnapshot, MazeView, PlayerSummary } from './views.ts';
import type { Rect } from './world/terrain.ts';
type PresentedActor = Player | EnemyBody | Chest | Pet | Turret | PhantomClone;
function weaponIdentity(weapon: WeaponInstance): number {
  if (weapon.instanceId === undefined) throw new TypeError('Weapon identity has not been assigned');
  return weapon.instanceId;
}
import { isCombatPhase } from './phases.ts';
import { getDifficultyChoice } from './catalog.ts';
import { WAVE_COUNT } from './content/waves.ts';
import { WORLD_SIZE } from './world/config.ts';
import { getItem, itemTier } from './content/items.ts';
import { projectWeather, projectComet } from './encounters/index.ts';
import { projectEffect } from './project-effects.ts';
import { PET_VACUUM_RADIUS } from './actors/pet.ts';
import { unlockedChallenges } from './save/meta.ts';
import { STAT_DEFS, fmtStat, statEntries } from './progression/stats.ts';
import { characterTip, itemTooltip, weaponDetails, offerDetails, upgradeDetails } from './ui-details.ts';
import { describeStat } from './progression/stat-detail.ts';
import { BOSS_SPRITE_IDS } from './content/enemies.ts';
import { MAX_WEAPONS } from './actors/player.ts';

function projectClock(engine: SessionEngine) {
  const battle = engine.battle;
  const clock = battle?.encounter?.readClock();
  const timer = clock?.timer;
  return { secondsLeft: timer?.left ?? Math.max(0, (battle?.waveDuration ?? 30) - (battle?.waveElapsed ?? 0)),
    timerTotal: timer?.total ?? battle?.waveDuration ?? 30,
    timerLabel: timer?.label ?? '', timerVisible: !clock?.overridden || timer !== null };

}

export function projectFrame(session:SessionEngine,buffer?:GameFrameBuffer):GameFrame { return projectFrameValues(session,buffer); }
export function projectDisplay(session:SessionEngine,buffer:GameDisplayBuffer):DisplayFrame {
 const {transients:_stream,...scene}=projectFrameValues(session,buffer.frame,buffer);
 return{scene,bodies:buffer.stream.finish(),transients:displayRawData(buffer),trails:buffer.stream.prepareTrails?buffer.stream.trails.finish():undefined};
}

function projectFrameValues(engine: SessionEngine, buffer?: GameFrameBuffer, display?: GameDisplayBuffer): GameFrame {
  buffer?.reset(); display?.reset();
  const battle = engine.battle;
  const world = battle?.world, player = battle?.player;
  const phase = engine.run.phase;
  const challengeBodyId = battle?.encounter?.readCombat().bodyId;
  const actors: GameFrame['actors'][number][] = [], projectiles: GameFrame['projectiles'][number][] = buffer?.projectiles ?? [], pickups: GameFrame['pickups'][number][] = buffer?.pickups ?? [], effects: GameFrame['effects'][number][] = [], telegraphs: GameFrame['telegraphs'][number][] = [], terrain: NonNullable<GameFrame['terrain']>[number][] = [], weapons: NonNullable<GameFrame['weapons']>[number][] = [];
  if (world) {
    const addActor = (entity: PresentedActor, kind: ActorView['kind'], definitionId: string, id: EntityId) => {
      const enemy = 'isEnemy' in entity && entity.isEnemy && !entity.isChest ? entity : undefined;
      const chest = 'isChest' in entity && entity.isChest ? entity : undefined;
      const pet = 'lineTimer' in entity ? entity : undefined;
      const turret = 'weapon' in entity ? entity : undefined;
      const player = 'char' in entity ? entity : undefined;
      const invuln = 'invuln' in entity ? entity.invuln : undefined;
      const actor: ActorView = {
        id, kind, definitionId, x: entity.x, y: entity.y,
        spriteId: kind === 'enemy' && enemy ? enemy.spriteId ?? (enemy.boss && !BOSS_SPRITE_IDS.has(definitionId) ? null : definitionId)
          : kind === 'chest' && chest ? chest.reward.kind === 'heal' ? 'chest_heal' : chest.tier === 2 ? 'chest_2' : 'chest_1' : undefined,
        silhouette: enemy?.shape, noEyes: !!enemy?.def.noCanvasEyes,
        radius: entity.radius, angle: 'angle' in entity ? entity.angle : 'facing' in entity ? entity.facing : 0,
        accent: 'accent' in entity ? entity.accent : pet?.def.accent,
        blinkPhase: 'blinkPhase' in entity ? entity.blinkPhase : undefined, age: entity.age,
        facePlayer: enemy?.def.facePlayer, faceRotate: enemy?.def.faceRotate,
        recoil: 'recoil' in entity ? entity.recoil : undefined,
        spawnProgress: 'spawnAnim' in entity ? entity.spawnAnim > 0 ? 1 - entity.spawnAnim / .3 : 1 : undefined,
        glowPhase: chest?.glowPhase,
        color: ('color' in entity ? entity.color : undefined) ?? turret?.def.color ?? player?.char.color ?? pet?.def.color ?? '#ffffff',
        hp: 'hp' in entity ? entity.hp : undefined, maxHp: 'maxHp' in entity ? entity.maxHp : undefined,
        shield: 'shield' in entity ? entity.shield : undefined, maxShield: 'maxShield' in entity ? entity.maxShield : undefined,
        hurtFlash: 'hurtFlash' in entity ? entity.hurtFlash : undefined, wallFlash: 'wallFlash' in entity ? entity.wallFlash : undefined,
        invulnerability: invuln, rescueProgress: player?.rescueProgress, rescueNeed: player?.rescueNeed, downCount: player?.downCount,
        moving: 'isMoving' in entity ? entity.isMoving : undefined, walkPhase: 'walkPhase' in entity ? entity.walkPhase : undefined,
        mutant: !!enemy?.mutant, downed: !!player?.downed, boss: !!enemy?.boss,
        scale: 'scale' in entity ? entity.scale : 1,
        alpha: entity.dead ? 0 : invuln !== undefined && invuln > 0 ? 0.65 : 1,
        facing: 'facing' in entity ? entity.facing : 0,
        label: kind === 'player' ? player?.char.name : 'def' in entity ? entity.def.name : undefined,
        elite: !!enemy?.elite, slot: kind === 'player' ? player?.id : undefined,
        bubble: kind === 'pet' && pet?.line && pet.lineTimer > 0 ? { text: pet.line, alpha: Math.min(1, pet.lineTimer / 0.35) } : undefined,
        emote: kind !== 'pet' || !pet ? undefined : pet.healAnim > 0 ? 'heal' : pet.stealAnim > 0 ? 'steal' : pet.attackAnim > 0 ? 'attack' : pet.vacuumAnim > 0 ? 'vacuum' : undefined,
        vacuum: kind === 'pet' && pet && pet.vacuumAnim > 0 ? { radius: PET_VACUUM_RADIUS, progress: 1 - pet.vacuumAnim / 0.5 } : undefined,
      };
      actors.push(actor);
    };
    for (const entity of world.players()) if (entity) addActor(entity, 'player', entity.characterId, entity.id);
    for (const entity of world.enemies.items) if (!entity.dead && (entity.isChest || !entity.flandreHidden) && entity.id !== challengeBodyId) addActor(entity, entity.isChest ? 'chest' : 'enemy', entity.isChest ? 'chest' : entity.def.id, entity.id);
    if (world.pet) addActor(world.pet, 'pet', 'kitten', 'pet');
    for (const entity of world.turrets.items ?? []) addActor(entity, 'turret', entity.weapon.def.id, `turret-${entity.id}`);
    for (let i = 0; i < world.phantoms.length; i++) addActor(world.phantoms[i], 'phantom', world.phantoms[i].characterId, (display||buffer?.stableActorIds)?engine.displayIdentity(world.phantoms[i]):`phantom-${i}`);
    for (const [list, hostile] of [[world.bullets.items, false], [world.enemyBullets.items, true]] as const) {
      for (const bullet of list) if (!bullet.dead) {
        if (display || buffer?.packed) {
          const sink = display?.stream ?? buffer!.packed!;
          if (bullet.isEnemyBullet) sink.enemy(bullet); else sink.player(bullet);
          continue;
        }
        const view = buffer?.projectile(hostile) ?? emptyProjectileView(hostile);
        const c = bullet.componentColumns, row = bullet.componentRow;
        view.hostile = hostile; view.width = undefined;
        view.id = bullet.id; view.x = c ? c.x[row] : bullet.x; view.y = c ? c.y[row] : bullet.y;
        view.radius = c ? c.radius[row] : bullet.radius ?? 4;
        view.angle = c ? c.angle[row] : bullet.angle ?? 0;
        view.color = bullet.color ?? '#ffaaaa'; view.age = c ? c.age[row] : bullet.age;
        if (!bullet.isEnemyBullet) {
          view.playerStyle = bullet.behavior === 'bounce' ? 'coin' : bullet.kind === 'element' ? 'orb' : bullet.kind === 'turret' ? 'tracer' : 'shot';
          if (buffer) buffer.writeTrail(view, bullet.trail);
          else view.trail = Array.from({ length: bullet.trail.length }, (_, i) => {
            const offset = bullet.trail.offset(i), values = bullet.trail.values;
            return { x: values[offset], y: values[offset + 1], alpha: values[offset + 2] };
          });
        }
        view.shape = 'laser' in bullet && bullet.laser ? 'laser' : 'hwKind' in bullet && bullet.hwKind === 'bead' ? 'bead'
          : 'shape' in bullet ? bullet.shape === 'longball' ? 'rice' : bullet.shape === 'crystal' ? 'shard' : bullet.shape : 'circle';
        view.hitRadius = 'hitRadius' in bullet ? bullet.hitRadius : undefined;
        view.anchor = 'laser' in bullet && bullet.laser ? 'head' : 'center';
        view.length = 'laserLength' in bullet ? bullet.laserLength : undefined;
        if (!buffer) projectiles.push(view);
      }
    }
    for (const entity of world.pickups.items) if (!entity.dead) {
      if (display || buffer?.packed) { (display?.stream ?? buffer!.packed!).pickup(entity); continue; }
      const view = buffer?.pickup() ?? { id: 0, x: 0, y: 0, kind: 'xp' as const, variant: 1 as const, bobPhase: 0 };
      const c = entity.componentColumns, row = entity.componentRow;
      view.id = entity.id; view.x = c ? c.x[row] : entity.x; view.y = c ? c.y[row] : entity.y;
      view.kind = entity.type; view.variant = entity.variant; view.bobPhase = c ? c.bobPhase[row] : entity.bobPhase;
      if (!buffer) pickups.push(view);
    }
    for (const effect of world.fx.items) effects.push(projectEffect(effect));
    for (const [index, obstacle] of (world.terrain.rects ?? []).entries()) terrain.push({
      id: `rect-${index}`, kind: 'rect', x: obstacle.x0, y: obstacle.y0,
      width: obstacle.x1 - obstacle.x0, height: obstacle.y1 - obstacle.y0,
      material: obstacle.maze ? 'ice' : 'wall',
    });
    for (const [index, obstacle] of (world.terrain.circles ?? []).entries()) terrain.push({
      id: `circle-${index}`, kind: 'circle', x: obstacle.cx, y: obstacle.cy,
      radius: obstacle.r, material: 'tree',
    });
    const armedActors = [...world.players(), ...world.phantoms];
    for (const [ownerIndex, actor] of armedActors.entries()) {
      for (const [weaponIndex, weapon] of actor.weapons.entries()) {
        if (weapon.def.behavior !== 'orbit' || !weapon.orbitPositions) continue;
        for (const [ballIndex, position] of weapon.orbitPositions.entries()) weapons.push({
          id: `orbit-${ownerIndex}-${weapon.instanceId ?? weaponIndex}-${ballIndex}`,
          ownerId: ('id' in actor ? actor.id : undefined) ?? ((display||buffer?.stableActorIds)?engine.displayIdentity(actor):`phantom-${ownerIndex - world.players().length}`),
          definitionId: weapon.def.id, x: position.x, y: position.y,
          trail: (weapon._trail?.[ballIndex] ?? []).map(point => ({ x: point.x, y: point.y })),
          orbitRadius: weapon.orbitRadius ?? 0, color: weapon.def.color, ballIndex,
          angle: weapon.angle, radius: (weapon.def.orbitBallRadius ?? 16) * 0.5625, alpha: 1,
        });
      }
    }
    for (const [index, blade] of (battle?.itemPassives.ultimate?.blades ?? []).entries()) telegraphs.push({
      id: `yamato-${index}`, kind: 'line', x: blade.x1, y: blade.y1,
      end: { x: blade.x2, y: blade.y2 }, color: '#d9faff', width: 5,
      alpha: Math.max(0, 1 - blade.t / blade.life),
    });
    for (let i = 0; i < world.waves.read().warnings.length; i++) {
      const warning = world.waves.read().warnings[i];
      telegraphs.push({ id: `spawn-${i}`, kind: 'circle', x: warning.x, y: warning.y,
        color: '#ff5678', alpha: 0.3, radius: 32 });
    }
  }
  const special = battle?.encounter ? battle.encounter.readFrame() : { actors: [], projectiles: [], effects: [], telegraphs: [], encounter: undefined };
  actors.push(...special.actors); projectiles.push(...special.projectiles);
  effects.push(...special.effects); telegraphs.push(...special.telegraphs);
  const ruleMaze = world?.terrain.maze;
  const plaza = world?.terrain.plaza;
  const rectangle = (value: Rect) => ({ x: value.x0, y: value.y0, width: value.x1 - value.x0, height: value.y1 - value.y0 });
  const maze: MazeView | undefined = ruleMaze && plaza ? {
    plaza: rectangle(plaza), bounds: rectangle(ruleMaze),
    entry: { x: ruleMaze.entrance.x, y: ruleMaze.entrance.y },
    exit: { x: ruleMaze.exit.x, y: ruleMaze.exit.y },
    walls: ruleMaze.walls.map((wall, id) => ({ id: `maze-wall-${id}`, kind: 'rect',
      ...rectangle(wall), material: 'ice' })),
  } : undefined;
  const weatherView = projectWeather(battle?.weather);
  const comet = battle?.comet;
  const cometView = projectComet(comet);
  return { tick: battle?.tick ?? 0, time: battle?.time ?? 0, phase, combat: isCombatPhase(phase),
    hud: player ? { hp: player.hp, maxHp: player.maxHp, shield: player.shield,
      xp: player.xp, xpNeeded: player.xpNeeded, level: player.level } : null,
    hudChrome: player ? { ...projectClock(engine), wave: (battle?.waveIndex ?? 0) + 1, materials: player.materials, flandre: battle?.encounter?.kind === 'flandre' } : null,
    camera: { x: battle?.encounter?.arena.cx ?? player?.x ?? 0, y: battle?.encounter?.arena.cy ?? player?.y ?? 0, zoom: 1, shake: Math.max(battle?.shakeStrength ?? 0, comet?.shake ?? 0) },
    backgroundId: battle?.backgroundId ?? 'plaza', worldHalfSize: world?.halfSize ?? WORLD_SIZE / 2,
    ...(buffer?.packed ? { transients: buffer.packed } : {}),
    actors, projectiles, pickups, effects, telegraphs, terrain, weapons, maze, weather: weatherView, encounter: special.encounter, comet: cometView };
}

export function projectUi(engine: SessionEngine): GameUiSnapshot {
  const battle = engine.battle;
  const world = battle?.world, shop = engine.economy.market;
  const run = engine.run.read(), phase = run.stage.phase;
  const players: PlayerSummary[] = world ? world.players().map(player => {
    if (!shop) throw new TypeError('A running world requires a shop');
    return ({
    id: player.id, name: player.char.name, characterId: player.characterId,
    glyph: player.char.glyph, color: player.char.color, characterTip: characterTip(player.char), maxWeapons: MAX_WEAPONS,
    waveIncome: engine.lastWaveIncome ?? null,
    hp: player.hp, maxHp: player.maxHp, shield: player.shield,
    damageDealt: player.damageDealt, damageTaken: player.damageTaken, timeAlive: player.timeAlive,
    level: player.level, xp: player.xp, xpNeeded: player.xpNeeded,
    materials: player.materials, kills: player.kills, downed: player.downed, rerollCost: shop.rerollCostFor((player.id - 1) * 4),
    weapons: player.weapons.map(weapon => ({
      instanceId: weaponIdentity(weapon),
      definitionId: weapon.def.id, name: weapon.def.name, tier: weapon.def.tier, level: weapon.level,
      ...weaponDetails(weapon, player, shop) })),
    statDetails: statEntries(player.stats.values).map(([statId, value]) => ({
      statId, name: STAT_DEFS[statId]?.name ?? statId, value,
      unit: STAT_DEFS[statId]?.kind === 'percent' ? 'percent' : 'flat',
      description: describeStat(statId, player.stats.values, player.stats.luckEffectMul), formatted: fmtStat(statId, value),
    })),
    items: [...player.items].map(([id, count]) => {
      const definition = getItem(id);
      if (!definition) throw new TypeError(`Unknown owned item: ${id}`);
      return { id, name: definition.name, count, color: definition.color, tooltip: itemTooltip(definition, count) };
    }),
  }); }) : [];
  // Reference UI.updateHud only replaces the wave clock for these two fights.
  // Remilia/Halloween's timeLeft belongs to their canvas performance, not HUD.
  return Object.freeze({ revision: engine.revision, phase, combat: isCombatPhase(phase),
    wave: world ? (battle?.waveIndex ?? 0) + 1 : 0,
    ...projectClock(engine), difficulty: engine.difficulty, difficultyInfo: getDifficultyChoice(engine.difficulty), maxWaves: WAVE_COUNT,
    challengeId: battle?.encounter?.kind, seed: engine.rng.seed,
    players,
    offers: (shop?.offers ?? []).map((offer, slot) => {
      if (!world || !shop) throw new TypeError('Shop offers require an active world');
      const owner = world.players()[Math.floor(slot / 4)];
      if (!owner) throw new TypeError('Shop offer has no owning player');
      return ({
      id: engine.economy.offerId(slot), ownerId: owner.id, name: offer.data.name, description: offer.data.desc ?? '',
      kind: offer.kind, definitionId: offer.data.id, price: offer.price,
      tier: offer.kind === 'weapon' ? offer.data.tier : itemTier(offer.data),
      sold: offer.sold, locked: shop.locked.has(slot),
      ...offerDetails(offer, owner),
    }); }),
    upgrades: run.upgrade.options.map(option => ({ id: option.id, name: option.name,
      description: option.desc ?? '', rarity: option.rarity, ...upgradeDetails(option),
      healAll: !!option.heal, shieldPercent: (option.shieldPct ?? 0) * 100 })),
    rewards: (world?.pendingItemRewards ?? []).map((reward, index) => ({
      id: engine.economy.rewardId(index), definitionId: reward.id, name: reward.name,
      description: getItem(reward.id)?.desc ?? '', sellValue: reward.sellValue,
      color: getItem(reward.id)?.color, glyph: getItem(reward.id)?.glyph, rare: !!reward.rare,
    })),
    retryStats: { wave: Math.max(0, run.retries.total - (engine.archive.checkpoint?.retries ?? 0)), total: run.retries.total, manual: run.retries.manual },
    rerollCost: engine.economy.market?.rerollCost ?? 0, pilot: engine.pilotEnabled,
    canRetry: !!engine.archive.checkpoint && !run.outcome.abandoned, won: run.outcome.won, endless: run.endless,
    autoUpgrade: run.autoUpgrade, unlockedChallenges: unlockedChallenges(engine.meta),
    challengeName: battle?.encounter ? ({ flandre: '芙兰朵露', vergil: '维吉尔', remilia: '蕾米莉亚', halloween: '万圣节双猫' })[battle.encounter.kind] : undefined,
  });
}
