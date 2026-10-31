import type { ChallengeKind, EncounterContext, ChallengeSession } from './types.ts';
import { createController } from './controllers.ts';
import { createChallengeSession } from './challenge-session.ts';
export { WeatherSystem } from './weather.ts';
export { CometDisaster } from './comet.ts';
export { projectWeather, projectComet } from './projection.ts';

export function createEncounter(kind: ChallengeKind, context: EncounterContext): ChallengeSession {
  const session = createChallengeSession(createController(kind, context), context.world);
  context.world.challenge = session;
  context.world.noSpawn = true;
  return session;
}
