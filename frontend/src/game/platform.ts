/** Environment is supplied by the application; simulation never detects a browser. */
export type GamePlatform = 'desktop' | 'mobile';
const desktop = Object.freeze({ enemyLimit: Infinity, effectLimit: 240, flandreBullets: 1200,
  flandreBulletMinimum: 800, typhoons: 4, fogClouds: 8 });
const mobile = Object.freeze({ enemyLimit: 50, effectLimit: 80, flandreBullets: 750,
  flandreBulletMinimum: 500, typhoons: 2, fogClouds: 5 });
export function ruleBudget(platform: GamePlatform = 'desktop') {
  if (platform !== 'desktop' && platform !== 'mobile') throw new TypeError('Unknown game platform');
  return platform === 'mobile' ? mobile : desktop;
}
