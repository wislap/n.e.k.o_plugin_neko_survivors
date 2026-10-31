export type AiSkillId = 'pro' | 'normal' | 'rookie';
export interface AiSkill { id: AiSkillId; label: string; period: number; scan: number; skip: number; angErr: number; taus: number[]; dirs: number; safeSkip: number; scoreNoise: number; stumbleEvery: number; stumbleDur: number }
export const AI_SKILLS: Record<AiSkillId, AiSkill> = {
  pro:    { id: 'pro',    label: '高手', period: 4, scan: 1.0,  skip: 0,    angErr: 0,   taus: [0.10, 0.22, 0.36, 0.52], dirs: 16, safeSkip: 0,    scoreNoise: 0,  stumbleEvery: 0,  stumbleDur: 0 },
  normal: { id: 'normal', label: '普通', period: 5, scan: 0.82, skip: 0.26, angErr: 0.45, taus: [0.10, 0.22, 0.36],       dirs: 12, safeSkip: 0.26, scoreNoise: 8,  stumbleEvery: 15, stumbleDur: 0.32 },
  rookie: { id: 'rookie', label: '菜鸟', period: 8, scan: 0.65, skip: 0.45, angErr: 0.9, taus: [0.10, 0.22],              dirs: 8,  safeSkip: 0.45, scoreNoise: 16, stumbleEvery: 6,  stumbleDur: 0.45 },
};

/** Inject the session-owned AI RNG; no globals or real time. */
export function rollSkill(rnd: () => number): AiSkillId {
  const value = rnd();
  return value < 1 / 3 ? 'pro' : value < 2 / 3 ? 'normal' : 'rookie';
}
