import type { VisualScene } from './visual-fixtures';
const BASELINE = '5ade0bb30726dc6207e616f1560af42cb99b6fb4';
/** Acceptance notes are display-only; real controller tests remain independent. */
export function visualExpectation(scene: VisualScene) {
  const rules = {
    'battle-overlay': { source: 'renderer.js:_drawMinimap/_drawPartnersOffscreen/_drawScreenOverlay/_drawPetOverlays', expected: 'Four independent ordinary boss bars, offscreen P2 arrow, three player minimap markers, pet bubble, emote and 220-world-unit expanding vacuum ring.' },
    weapons: { source: 'renderer.js:_drawFX/_drawDamageText; fx.js:FX_TYPE', expected: 'Fourteen separate effects: slash/thrust/spin/beam/nova/explosion/chain/sparkle/text/ring/hit/impact/shockwave/shard. Thrust and chain must extend across targets; critical text grows; nova carries notes.' },
    ordinary: { source: 'renderer.js:_drawPlayer/_drawPlayerBullet/_drawTurret/_drawOrbit/_drawPickups', expected: 'Procedural character bob/blink, source turret gradient and glow, two actual coin variants, four friendly projectile styles with recorded trails, and rule-sampled orbit rope/yarn. Explicit desktop/mobile blend profile; no gameplay simulation.' },
    flandre: { source: 'flandre-render.js:CARD_THEME/drawSigil/drawDeclare; renderer.js:_drawFlandreLasers', expected: 'Original Flandre sprite, crystal wings, rotating magic-circle artwork, all thirteen star topologies, declaration wave, white-hot laser and readable purge cooldown.' },
    vergil: { source: 'vergil.js:renderWorld/renderScreen; vergil-fx.js', expected: 'Original square chair/silhouette/arena art retains aspect ratio; cyan guard ring, crescents, portal/rift, lightning blade, intro fade and charged veil.' },
    remilia: { source: 'remilia-render.js:drawBg/drawRemilia/drawScreen', expected: 'All twenty-four original frames, red moon and tower, bats and rotating sigil. No resurrected full-screen cut-in: reference round 205 removed it.' },
    halloween: { source: 'halloween-render.js:drawCats/drawWorldFx/drawHud', expected: 'Both thirty-frame cats retain nearest-neighbour four-times pixel scale, graveyard/moon, small solid pumpkin and four-direction 215-unit explosion; amber/violet projectile palettes.' },
    comet: { source: 'comet.js:drawWorld/_drawDragon/_drawRoar/_drawTakeoff/drawScreen', expected: 'All ten phases: warning banner, two black translucent flyovers, coloured dive, multi-layer fire/smoke/rings, original roar pose, upward takeoff. Ring progress includes original delay.' },
  };
  const weather = {
    fog: 'Fog is centered on the player, fully clear inside 200 world units and ramps to cover outside 400; HUD remains clear.',
    bloodMoon: 'Red moon, warm red tint and readable hostile bullet cores.',
    meteor: 'Closing warning ring, diagonal fireball in final 0.55 s, warm trail and persistent burning area.',
    rain: 'Angled blue-white rain lines with steady density; HUD text remains untouched.',
    breeze: 'Small drifting pink/green petals; visual entropy does not advance game RNG.',
    typhoon: 'Layered cyclone at its projected collision position, rain and translucent spiral layers.',
    clear: 'Warm sun and light tint with clear actors and projectiles.',
    scorch: 'Animated heat distortion uses the GLSL program and a warm sun.',
    calm: 'Drifting natural particles without obstructing hit geometry.',
    riverFog: 'Local cloud geometry appears at actual projected pushing regions; peripheral fog and cold mist remain translucent.',
  };
  const value = scene in rules ? rules[scene as keyof typeof rules] : { source: 'renderer.js:_drawWeatherWorld/_drawWeatherScreen; weather-fx.js', expected: weather[scene as keyof typeof weather] };
  return { baseline: BASELINE, ...value, limitation: 'Synthetic display snapshots only. Does not verify rule execution, collision, victory/reward flow or real-game performance.' };
}
