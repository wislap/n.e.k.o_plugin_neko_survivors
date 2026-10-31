// 曲库使用 ASCII 文件名，避免跨平台 URL 与打包编码差异。
// 原素材：stage_1_[1–5] 对应 1-10（1–5），stage_2_[1–3] 对应 11-20（1–3）；
// boss_[1–4] 对应 boss(1–4)，open/end/shop 保持原文件名。

/** BGM 目录（相对页面）。NEKO 部署后结构与本地一致。 */
export const BGM_DIR = './assets/bgm';

/** 东方音效来自 touhou-flandre/flandre-se/nc；映射依据 SE-MAPPING.md，增益含 70% 调整。 */
export const SE_DIR = './assets/sfx';
export const SE_LIB = {
  tan00: 0.098, power0: 0.392, lazer00: 0.252,
  enep01: 0.35, cat00: 0.252, fault: 0.441, timeout: 0.392,
  // 自制音效统一 70% 增益。
  start00: 0.7, purge00: 0.7, level00: 0.7, hurt00: 0.7, heal00: 0.7,
  // 普通 Boss 齐射与开背虾水柱。
  shoot1: 0.7, shoot2: 0.7,
  // 耳鸣增益独立，其余天彗龙语音为 70%。
  comet_tinnitus: 0.5, comet_roar: 0.7, comet_takeoff: 0.7,
};

/** 每文件最小间隔（秒）；间隔内也标记同帧已处理，避免补偿合成音叠加。 */
export const SE_MIN_GAP = {
  tan00: 0.25,
  lazer00: 1.2,
  // 齐射额外限制，防止极端难度叠加破音。
  shoot1: 0.5,
};
export const SE_GAP_DEFAULT = 0.15;

/** 关卡曲池分段，无尽模式合并两池。 */
export const BGM_POOLS = {
  open: ['open.ogg'],
  end: ['end.ogg'],
  shop: ['shop.ogg'],
  stage1: ['stage_1_1.ogg', 'stage_1_2.ogg', 'stage_1_3.ogg', 'stage_1_4.ogg', 'stage_1_5.ogg'],
  stage2: ['stage_2_1.ogg', 'stage_2_2.ogg', 'stage_2_3.ogg'],
  boss: ['boss_1.ogg', 'boss_2.ogg', 'boss_3.ogg', 'boss_4.ogg'],
  // 芙兰来自 touhou-flandre/bgm-out 的 15（U.N. Owen）与 16（Extra Phantom）音轨。
  flandre: ['boss_flandre.ogg'],
  // Rabi-Ribi 万圣节 DLC 的 Mischievous Masquerade：bgm13.ogg。
  halloween: ['halloween.ogg'],
  // 蕾米莉亚来自 bgm-out/nc-bgm-13.ogg；参考版更名为 boss_remilia_b 避免旧缓存。
  remilia: ['boss_remilia_b.ogg'],
  flandre_ex: ['boss_flandre_ex.ogg'],
};

/** 每类武器最小间隔（毫秒），另受每帧最多三个武器音的全局配额限制。 */
export const WEAPON_SFX_GAP = {
  melee: 58,
  ranged: 66,
  element: 95,
  turret: 80,
};

/** 武器音增益保持参考值，使高频攻击仍能从背景音乐中分辨。 */
export const WEAPON_SFX_GAIN = 2.0;

/** 输入为 1-based 波次：1–10 用 stage1，11–20 用 stage2，21 起合并。 */
export function stagePoolForWave(wave1: number) {
  const w = Number.isFinite(wave1) ? Math.floor(wave1) : 1;
  if (w >= 21) return [...BGM_POOLS.stage1, ...BGM_POOLS.stage2];   // 无尽模式：1-20 全部曲目
  if (w >= 11) return [...BGM_POOLS.stage2];
  return [...BGM_POOLS.stage1];
}

/** 场景与分段曲池共同决定 key；跨曲池必须重新选择，未知场景返回 null。 */
export function resolveScene(scene: string, opts?: SceneOptions | null) {
  // null 与 undefined 都按缺省波次处理。
  const o = opts && typeof opts === 'object' ? opts : {};
  if (scene === 'stage') {
    const raw = o['wave'];
    const w = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 1;
    const pool = stagePoolForWave(w);
    const band = w >= 21 ? 'endless' : w >= 11 ? 'stage2' : 'stage1';
    return { key: `stage:${band}`, pool };
  }
  const pool = lookupCatalog(BGM_POOLS, scene);
  if (!Array.isArray(pool) || pool.length === 0) return null;
  return { key: scene, pool };
}

/** 多首曲目时避开上一首；返回原曲池中的文件名，不改变曲池。 */
export function pickTrack(pool: readonly string[], last: string | null = null, rand = Math.random) {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];          // 只有一首就没得避
  // last 可能已经不在池里（换池了），filter 不会删掉任何东西，仍然可挑
  const rest = last == null ? pool : pool.filter((t) => t !== last);
  const list = rest.length ? rest : pool;
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)));
  return list[i];
}


/** Files used by challenge controllers outside the ordinary synthesized SFX. */
export const CHALLENGE_SOUND_FILES = {
  vergil_atk: './assets/sfx/vergil_atk.ogg',
  vergil_aoe: './assets/sfx/vergil_aoe.ogg',
  vergil_shutou: './assets/sfx/vergil_shutou.ogg',
  vergil_ult: './assets/sfx/vergil_ult.ogg',
  halloween_etc13: './assets/boss/halloween/se/etc13.wav',
  halloween_hit13: './assets/boss/halloween/se/hit13.wav',
  halloween_laser13: './assets/boss/halloween/se/laser13.wav',
};
export const CHALLENGE_MUSIC_FILES = {
  halloween: './assets/boss/halloween/mischievous.wav',
  bury_the_light: './assets/bgm/bury_the_light.ogg',
};

export interface SceneOptions { wave?: number }

/** A dynamic cue name may select only an own catalog entry. */
export function lookupCatalog<T extends object>(catalog: T, key: string): T[keyof T] | undefined {
  return Object.hasOwn(catalog, key) ? catalog[key as keyof T] : undefined;
}
