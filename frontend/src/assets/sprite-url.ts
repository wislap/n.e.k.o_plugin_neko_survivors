export const SPRITE_KINDS = {
  character: { directory: 'characters', prefix: 'char_', extension: 'png' },
  enemy: { directory: 'enemies', prefix: 'enemy_', extension: 'png' },
  background: { directory: 'backgrounds', prefix: 'bg_', extension: 'jpg' },
  weapon: { directory: 'weapons', prefix: 'weapon_', extension: 'png' },
  item: { directory: 'items', prefix: 'item_', extension: 'png' },
  pickup: { directory: 'pickup', prefix: '', extension: 'png' },
  chest: { directory: 'chest', prefix: '', extension: 'png' },
  pet: { directory: 'pet', prefix: 'pet_', extension: 'png' },
  fx: { directory: 'fx', prefix: '', extension: 'png' },
} as const;
export type SpriteKind = keyof typeof SPRITE_KINDS;
const itemAliases: Record<string, string> = {
  ap_round: 'armor_piercer', dried_fish: '!小鱼干', lobster_pillow: '!龙虾抱枕',
  smart_wand: '!智慧型魔棒', dr_m_notes: '!M博士心得', lucky_cat_paw: '!幸运猫脚',
  black_cape: '!黑色披风', cat_taffy: '!猫娘奶糖', overload_chip: '!超载芯片',
};
export function spriteUrl(base: string, kind: SpriteKind, id: string): string {
  if (!id || /[\\/]|\.\./.test(id)) throw new Error(`Invalid sprite id: ${id}`);
  const spec = SPRITE_KINDS[kind];
  const alias = kind === 'item' ? itemAliases[id] ?? id : id;
  const filename = alias.startsWith('!') ? alias.slice(1) : spec.prefix + alias;
  return `${base.replace(/\/$/, '')}/${spec.directory}/${encodeURIComponent(filename)}.${spec.extension}`;
}
