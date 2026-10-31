import type { CharacterChoice, DifficultyChoice } from './views';
import type { DifficultyId } from './commands';
import { CHARACTERS } from './content/characters.ts';
import { difficultyList, getDifficulty } from './content/difficulty.ts';
import { getWeapon } from './content/weapons.ts';
import { getCharSkill } from './content/char-skills.ts';
import { STAT_DEFS, statEntries } from './progression/stats.ts';

export function getCharacterChoices(): readonly CharacterChoice[] {
  return CHARACTERS.map(character => {
    const weapon = getWeapon(character.startWeapon), skill = getCharSkill(character.id);
    if (!weapon) throw new Error(`Missing starting weapon for ${character.id}`);
    return { id: character.id, name: character.name, glyph: character.glyph,
      role: character.role, description: character.desc, color: character.color, portraitId: character.id,
      statModifiers: ([[character.mods ?? {}, false], [character.pct ?? {}, true]] as const).flatMap(([values, percent]) =>
        statEntries(values).map(([statId, value]) => ({ statId,
          name: STAT_DEFS[statId].name, value, percent }))),
      startWeapon: { id: weapon.id, name: weapon.name, color: weapon.color },
      ability: skill ? { name: skill.ability.name, text: skill.ability.text } : undefined,
      skill: skill ? { name: skill.skill.name, text: skill.skill.text } : undefined };
  });
}
export function getDifficultyChoice(id: DifficultyId): DifficultyChoice {
  const value = getDifficulty(id);
  return { id: value.id, name: value.name, color: value.color, description: value.desc };
}
export function getDifficultyChoices(): readonly DifficultyChoice[] { return difficultyList().map(value => getDifficultyChoice(value.id)); }
