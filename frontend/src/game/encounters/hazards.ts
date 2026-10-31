/** Physical hazard rules shared by damage, observation and display projection. */
export const FLANDRE_LASER = Object.freeze({
  length: 1010, halfWidth: 22, warning: .85, sweep: 1.9, fade: .5, growth: .35, damageFadeThreshold: .2,
});
export const HALLOWEEN_LASER = Object.freeze({ halfWidth: 20, warning: .7, duration: 2.2 });
export const PUMPKIN_CROSS = Object.freeze({ warning: 1.1, duration: .35, halfWidth: 30, radius: 210, afterglow: .9 });
