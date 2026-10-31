import { createGameSession, type GameFrame, type GameUiSnapshot, type PlayerSummary, type OfferSummary, type WeaponSummary } from '../../src/game';

// Build complete fixtures from the same public projection consumed by production.
// Tests override facts relevant to their scenario, without weakening UI contracts.
const title = createGameSession().readUi();
const session = createGameSession();
session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1 } });
const playing = session.readUi();
export function playerSummary(overrides: Partial<PlayerSummary> = {}): PlayerSummary {
  return { ...playing.players[0]!, ...overrides };
}
export function weaponSummary(overrides: Partial<WeaponSummary> = {}): WeaponSummary {
  return { ...playing.players[0]!.weapons[0]!, ...overrides };
}
export function uiSnapshot(overrides: Partial<GameUiSnapshot> = {}): GameUiSnapshot { return { ...title, ...overrides }; }
export function gameFrame(overrides: Partial<GameFrame> = {}): GameFrame { return { ...session.readFrame(), ...overrides }; }

export function offerSummary(overrides: Partial<OfferSummary> = {}): OfferSummary {
  return { id: 'offer', name: 'Fixture item', description: '', kind: 'item', definitionId: 'fixture-item',
    price: 10, tier: 1, sold: false, locked: false, ownerId: 1, color: '#ffffff', glyph: '',
    tierName: '普通', tierColor: '#ffffff', behaviorLabel: '', ownedCount: 0, pawMark: false, tooltip: '', statRows: [], ...overrides };
}
