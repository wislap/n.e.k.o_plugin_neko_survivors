import type { GameEvent } from './events';

export type NarrativeEvent = 'run_start' | 'wave_start' | 'wave_clear' | 'level_up' | 'low_hp'
  | 'boss_spawn' | 'boss_phase' | 'boss_kill' | 'weapon_combo' | 'death' | 'win'
  | 'pilot_wave' | 'pilot_win' | 'pilot_lose';
export interface NarrativeContext {
  wave?: number; hpRatio?: number; level?: number; kills?: number;
  characterName?: string; difficultyName?: string; weaponName?: string;
  bossName?: string; upgradeName?: string; phase?: number;
}
interface RandomStream { next(): number }
const COOLDOWNS: Partial<Record<NarrativeEvent, number>> = {
  wave_start: 12, level_up: 6, low_hp: 20, boss_phase: 10, pilot_wave: 14,
};
const EMOTIONS: Partial<Record<NarrativeEvent, Extract<GameEvent, { type: 'avatar-emotion' }>['emotion']>> = {
  low_hp: 'surprised', boss_kill: 'happy', boss_phase: 'surprised', level_up: 'happy',
  weapon_combo: 'happy', win: 'happy', death: 'sad',
};
const PILOT_REMAP: Partial<Record<NarrativeEvent, NarrativeEvent | null>> = {
  run_start: 'pilot_wave', wave_start: 'pilot_wave', boss_spawn: 'pilot_wave', boss_kill: 'pilot_wave',
  level_up: null, low_hp: null, boss_phase: null, weapon_combo: null,
  death: 'pilot_lose', win: 'pilot_win',
};
const LABELS: Record<NarrativeEvent, string> = {
  run_start: '新一轮围攻开始了', wave_start: '进入了新的一波', wave_clear: '完成了这一波围攻',
  level_up: '升了一级', low_hp: '血量见底了', boss_spawn: 'Boss 登场了',
  boss_phase: 'Boss 进入了更强的阶段', boss_kill: '把 Boss 打倒了', weapon_combo: '武器合成了更高品质',
  death: '这一轮没能撑住', win: '撑过了全部围攻，通关了',
  pilot_wave: '正在替主人打这一波', pilot_win: '替主人通关了全部围攻', pilot_lose: '替主人打这一波时输了',
};
const TAKEOVER_LINES = ['要人家帮你玩了吗～', '把键盘交给我吧喵！', '看好了，人家的走位～', '放心交给我，喵！', '嘿嘿，轮到我上场啦～'];
const HANDOVER_LINES = ['诶，要你亲自出马了吗？', '好吧好吧，键盘还你喵～', '那你要加油哦！', '人家打得不好吗…喵', '主人的手痒了吧～'];

/** Scene policy from v0.4.18; text is context for the host, never an LLM call here. */
export function formatNarrative(event: NarrativeEvent, context: Readonly<NarrativeContext>): string {
  const bits: string[] = [];
  if (context.wave) bits.push(`第 ${context.wave} 波`);
  if (context.difficultyName) bits.push(context.difficultyName);
  if (context.characterName) bits.push(`操纵${context.characterName}`);
  if (context.bossName) bits.push(`对手是 ${context.bossName}`);
  if (event !== 'wave_start' && context.hpRatio != null) bits.push(`血量 ${Math.round(context.hpRatio * 100)}%`);
  if (context.level != null) bits.push(`已到 Lv ${context.level}`);
  if (context.kills != null) bits.push(`击杀 ${context.kills}`);
  if (context.weaponName) bits.push(`主武器 ${context.weaponName}`);
  if (context.upgradeName) bits.push(`选择强化 ${context.upgradeName}`);
  if (context.phase != null) bits.push(`第 ${context.phase} 阶段`);
  return `${LABELS[event]}（${bits.join('，')}）`;
}

/** Pure elapsed-time event policy, independent of game simulation pause and host I/O. */
export class GameNarration {
  private output: (event: GameEvent) => void;
  private random: RandomStream;
  private seconds = 0;
  private lastReport = new Map<NarrativeEvent, number>();
  private once = new Set<string>();
  private onceWave: number | undefined;
  private lastPetVoice = -Infinity;
  private previousHpRatio = 1;
  constructor(output: (event: GameEvent) => void, random: RandomStream) { this.output = output; this.random = random; }
  advance(seconds: number): void { this.seconds += seconds; }
  beginAttempt(random: RandomStream): void {
    this.random = random; this.once.clear(); this.onceWave = undefined; this.previousHpRatio = 1;
  }
  report(event: NarrativeEvent, context: NarrativeContext, pilot = false, onceKey?: string): boolean {
    // Endless runs retain only the current wave's identities; scene cooldowns span waves.
    if (context.wave != null && context.wave !== this.onceWave) {
      this.once.clear(); this.onceWave = context.wave;
    }
    if (onceKey) { if (this.once.has(onceKey)) return false; this.once.add(onceKey); }
    const mapped = pilot && Object.hasOwn(PILOT_REMAP, event) ? PILOT_REMAP[event] : event;
    let reported = false;
    if (mapped != null && this.seconds - (this.lastReport.get(mapped) ?? -Infinity) >= (COOLDOWNS[mapped] ?? 0)) {
      this.lastReport.set(mapped, this.seconds);
      this.output({ type: 'report', event: mapped, text: formatNarrative(mapped, context) });
      reported = true;
    }
    // Baseline calls setEmotion after each gameplay trigger, even when its LLM
    // comment is cooled down or suppressed/remapped during pilot control.
    const emotion = EMOTIONS[event];
    if (emotion) this.output({ type: 'avatar-emotion', emotion });
    return reported;
  }
  health(context: NarrativeContext, pilot: boolean): void {
    const ratio = context.hpRatio ?? 1;
    if (ratio < 0.3 && this.previousHpRatio >= 0.3) this.report('low_hp', context, pilot);
    this.previousHpRatio = ratio;
  }
  speak(text: string, key: string): void { if (text.trim()) this.output({ type: 'speech', text, key }); }
  pet(text: string, kind: string): void {
    if (kind === 'pickup') return;
    if (kind !== 'weather') {
      if (this.seconds - this.lastPetVoice < 1) return;
      this.lastPetVoice = this.seconds;
    }
    this.speak(text, `pet:${kind}:${text.slice(0, 8)}`);
  }
  pilot(enabled: boolean): void {
    const lines = enabled ? TAKEOVER_LINES : HANDOVER_LINES;
    const text = lines[Math.min(lines.length - 1, Math.floor(this.random.next() * lines.length))] ?? lines[0];
    this.speak(text, enabled ? 'pilot:takeover' : 'pilot:handover');
  }
}
