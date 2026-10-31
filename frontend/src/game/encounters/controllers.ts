import type { ChallengeKind, EncounterContext, ChallengeOutcome, ChallengeController } from './types.ts';
import type { RuleEffect } from '../world/effects-port.ts';
import { FlandreFight } from './flandre.ts';
import { VergilFight } from './vergil.ts';
import { RemiliaFight } from './remilia.ts';
import { HalloweenFight } from './halloween.ts';
import { ENCOUNTER_ARENAS } from './arenas.ts';

const controllers = Object.freeze({
  flandre: FlandreFight,
  vergil: VergilFight,
  remilia: RemiliaFight,
  halloween: HalloweenFight,
});
/** Internal construction seam, also used by concrete mechanism tests. */
export function createController(kind: ChallengeKind, { world, player, rng = world.rng, effects = world.effects,
  onDone = () => {}, viewport, chain = false, platform = 'desktop' }: EncounterContext): ChallengeController {
  if (!Object.hasOwn(controllers, kind)) throw new TypeError('Unknown encounter kind');
  const Controller = controllers[kind], arena = ENCOUNTER_ARENAS[kind];
  const emit = (event: RuleEffect) => effects.emit(event);
  const shake = (strength: number, duration: number) => emit({ type: 'camera-shake', strength, duration });
  return new Controller({ world, player, rng, effects, platform,
    viewport: { cx: arena.cx, cy: arena.cy, viewW: arena.hw * 2, viewH: arena.hh * 2, ...viewport, shake },
    shake, notice: (text: string, tone: 'info' | 'good' | 'bad' = 'info') => emit({ type: 'notice', text, tone }),
    speak: (text: string, options: { key?: string } = {}) => emit({ type: 'speech', text, key: options.key ?? `${kind}:${text.slice(0, 16)}` }),
  }, { chain, onDone: (outcome: ChallengeOutcome) => onDone({ kind, outcome }) });
}
