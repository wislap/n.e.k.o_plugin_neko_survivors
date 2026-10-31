import type { RNG } from '../math/random.ts';
import type { DamageDefense, PlayerDamageOptions } from '../combat/player-health.ts';
import { CONTACT_INVULN, PROJECTILE_INVULN } from '../combat/player-health.ts';
import { defenseEquipment, type ItemInventory } from './equipment.ts';

interface DefenseValues {
  inventory: ItemInventory;
  random: Pick<RNG, 'next'>;
  weather: { miss: number; rng: Pick<RNG, 'next'>; invulnMin: number } | null | undefined;
  dodge: number;
  armorMultiplier: number;
  characterTakenMultiplier: number;
  equipmentTakenMultiplier: number;
  pilotBuff: boolean | undefined;
  pilotLite: boolean | undefined;
  pilotTough: boolean | undefined;
  pilotEarly: boolean | undefined;
  pilotInvulnerability: number | undefined;
  luckyGuard(): number;
}
/** Defensive modifiers own their order; health owns shield and life-state commits. */
export function playerDefense(values: DefenseValues): DamageDefense {
  return {
    avoids(options: PlayerDamageOptions) {
      const ignoreI = options.ignoreIFrames === true;
      const weather = values.weather;
      if (!ignoreI && weather && weather.miss > 0 && !options.noMiss && options.weatherChecked !== true
          && weather.rng.next() * 100 < weather.miss) return true;
      const dodge = values.dodge;
      if (!ignoreI && dodge > 0 && values.random.next() * 100 < dodge) return true;
      return !ignoreI && !options.noMiss && defenseEquipment.evades(values.inventory, values.random);
    },
    modify(amount: number, options: PlayerDamageOptions) {
      let final = Math.max(1, amount * (options.pierceArmor ? 1 : values.armorMultiplier));
      const character = options.noTaken ? 1 : values.characterTakenMultiplier;
      if (character !== 1) final *= character;
      if (values.equipmentTakenMultiplier !== 1) final *= values.equipmentTakenMultiplier;
      if (values.pilotBuff) final = Math.min(final, 1);
      if (values.pilotLite && values.pilotEarly) final *= 0.6;
      if (values.pilotTough && values.pilotEarly) final *= 0.5;
      const guard = values.luckyGuard();
      if (guard !== 1) final *= guard;
      const trueBonus = options.trueBonus ?? 0;
      if (trueBonus > 0) final += trueBonus;
      return final;
    },
    invulnerability(options: PlayerDamageOptions) {
      return Math.max(options.invuln ?? (options.projectile ? PROJECTILE_INVULN : CONTACT_INVULN),
        values.weather?.invulnMin ?? 0, values.pilotInvulnerability ?? 0);
    },
  };
}
