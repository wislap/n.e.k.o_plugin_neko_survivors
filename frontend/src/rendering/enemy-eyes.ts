/** Face row bounds carried from the reference sprite measurements. */
export interface EyeAnchor { u: number; v: number; wf: number; l: number; r: number }
export const EYE_ANCHORS: Record<string, EyeAnchor> = {
  "bat": { u: 0.5, v: 0.5781, wf: 0.64, l: 0.0547, r: 0.9414 },
  "blade_cat": { u: 0.5, v: 0.5117, wf: 0.64, l: 0.0742, r: 0.9219 },
  "bomber": { u: 0.5, v: 0.5508, wf: 0.8, l: 0.0469, r: 0.9531 },
  "chaos_egg": { u: 0.5, v: 0.5586, wf: 0.84, l: 0.0703, r: 0.9375 },
  "charger": { u: 0.5, v: 0.6211, wf: 0.64, l: 0.0938, r: 0.8594 },
  "crab": { u: 0.5, v: 0.5508, wf: 0.7, l: 0.0898, r: 0.9609 },
  "elite_crab": { u: 0.5, v: 0.5508, wf: 0.84, l: 0.0703, r: 0.9297 },
  "elite_spitter": { u: 0.5, v: 0.6094, wf: 0.7, l: 0.1211, r: 0.8789 },
  "ghost": { u: 0.5, v: 0.5, wf: 0.6, l: 0.1914, r: 0.8086 },
  "healer_bunny": { u: 0.5, v: 0.6211, wf: 0.44, l: 0.2773, r: 0.7227 },
  "mouse": { u: 0.45, v: 0.5586, wf: 0.7, l: 0.0547, r: 0.9609 },
  "slime": { u: 0.5, v: 0.5703, wf: 0.7, l: 0.0742, r: 0.9297 },
  "spiral_cat": { u: 0.5, v: 0.5195, wf: 0.64, l: 0.082, r: 0.9219 },
  "spitter": { u: 0.5, v: 0.6211, wf: 0.8, l: 0.0938, r: 0.9023 },
  "splitter": { u: 0.4851, v: 0.6016, wf: 0.56, l: 0.168, r: 0.7578 },
  "stalker": { u: 0.61, v: 0.5586, wf: 0.53, l: 0.0625, r: 0.9414 },
  "tank": { u: 0.5, v: 0.5586, wf: 0.84, l: 0.0469, r: 0.9531 },
  "treasure_mimic": { u: 0.5, v: 0.5898, wf: 0.64, l: 0.1328, r: 0.9609 },
  "treasure_mimic_elite": { u: 0.4506, v: 0.5117, wf: 0.64, l: 0.0781, r: 0.7617 },
};

export function enemyEyePlacement(id: string, radius: number, facing: number) {
  const a = EYE_ANCHORS[id];
  if (!a) return undefined; // Complete boss illustrations already contain faces.
  const size = 2.6 * radius, faceWidth = a.wf * size;
  const eyeRadius = Math.max(radius * .06, faceWidth * .13);
  const left = -size / 2 + a.l * size, right = -size / 2 + a.r * size;
  const lo = left + faceWidth * .12 + eyeRadius, hi = right - faceWidth * .12 - eyeRadius;
  let half = faceWidth * .46 / 2;
  let x = -size / 2 + a.u * size + Math.cos(facing) * faceWidth * .06;
  if (hi > lo) { half = Math.min(half, (hi - lo) / 2); x = Math.max(lo + half, Math.min(hi - half, x)); }
  else { half = 0; x = (left + right) / 2; }
  const y = (-.6 + a.v) * size + Math.sin(facing) * faceWidth * .06 * .6;
  return { eyeRadius, left, right, eyes: [{ x: x - half, y }, { x: x + half, y }] };
}
