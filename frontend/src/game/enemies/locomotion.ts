import type { EnemyBody } from '../actors/enemy.ts';
import type { World } from '../world/world.ts';
import { resolveTerrain } from '../world/terrain.ts';

const STUCK_MOVE_RATIO = 0.35;
const STUCK_TIME = 0.35;
const STUCK_ESCAPE_TIME = 1.2;

/** Movement and charge timing are shared by ordinary enemies and ordinary Bosses. */
export class EnemyLocomotion {
  private readonly body: EnemyBody;
  state: 'idle' | 'windup' | 'charge' | 'recover' = 'idle';
  chargeSpeed: number | undefined;
  private stateTimer = 0;
  private _stuckTimer = 0;
  private _escapeTimer = 0;
  private _escapeX = 0;
  private _escapeY = 0;
  private _chargeDuration: number | undefined;
  private chargeDirX: number | undefined;
  private chargeDirY: number | undefined;
  constructor(body: EnemyBody) { this.body = body; }
  beginStep(dt: number) { if (this._escapeTimer > 0) this._escapeTimer -= dt; }
  resolveTerrain(world: World) {
    if (world.terrain) {
      if (resolveTerrain(world.terrain, this.body)) {
        this.body.vx *= 0.2;
        this.body.vy *= 0.2;
      }
    }
  }

  move(dt: number, dirX: number, dirY: number, speedOverride?: number) {

    const mag = Math.hypot(dirX, dirY);
    if (mag < 1e-9) return;

    let spd = (speedOverride ?? this.body.speed) * this.body.curseSpeedMul * mag
      * (this.body.world?.weather?.moveMul ?? 1);

    this.body.x += (dirX / mag) * spd * dt;
    this.body.y += (dirY / mag) * spd * dt;
  }

  checkStuck(dt: number, startX: number, startY: number) {

    const wanted = this.body.speed * this.body.curseSpeedMul * dt;
    if (wanted < 1e-4) return;

    const moved = Math.hypot(this.body.x - startX, this.body.y - startY);
    if (moved / wanted >= STUCK_MOVE_RATIO) {

      this._stuckTimer = 0;
      return;
    }

    this._stuckTimer += dt;
    if (this._stuckTimer < STUCK_TIME) return;

    this._stuckTimer = 0;
    this._escapeTimer = STUCK_ESCAPE_TIME;
    const side = this.body.rng.next() < 0.5 ? 1 : -1;

    this._escapeX = -Math.sin(this.body.facing) * side;
    this._escapeY = Math.cos(this.body.facing) * side;

    const len = Math.hypot(this._escapeX, this._escapeY) || 1;
    this._escapeX /= len;
    this._escapeY /= len;
  }

  escapeDir() {
    if (this._escapeTimer <= 0) return null;
    return { x: this._escapeX, y: this._escapeY };
  }

  beginCharge(nx: number, ny: number, windup: number) {
    this.state = 'windup';
    this.stateTimer = windup;
    this.chargeDirX = nx;
    this.chargeDirY = ny;

    const duration = (this.body.def.chargeDuration ?? 0.55) * (this.body.def.chargeDistanceMul ?? 1);
    this._chargeDuration = duration;
  }

  runChargeStates(dt: number, nx: number, ny: number, track = true) {
    const duration = this._chargeDuration ?? this.body.def.chargeDuration ?? 0.55;

    if (this.state === 'windup') {
      if (this.chargeDirX === undefined || this.chargeDirY === undefined) throw new TypeError('Charge direction is not initialized');
      this.stateTimer -= dt;
      if (track) {

        this.chargeDirX += (nx - this.chargeDirX) * dt * 1.5;
        this.chargeDirY += (ny - this.chargeDirY) * dt * 1.5;
        const len = Math.hypot(this.chargeDirX, this.chargeDirY) || 1;
        this.chargeDirX /= len; this.chargeDirY /= len;
      }

      if (this.stateTimer <= 0) {
        this.state = 'charge';
        this.stateTimer = duration;
        this.chargeSpeed = this.body.def.chargeSpeed ?? 260;

        if (track) {
          this.chargeDirX = nx;
          this.chargeDirY = ny;
        }
      }
    } else if (this.state === 'charge') {
      if (this.chargeDirX === undefined || this.chargeDirY === undefined || this.chargeSpeed === undefined) throw new TypeError('Charge movement is not initialized');
      this.stateTimer -= dt;
      this.body.x += this.chargeDirX * this.chargeSpeed * dt;
      this.body.y += this.chargeDirY * this.chargeSpeed * dt;
      if (this.stateTimer <= 0) {
        this.state = 'recover';
        this.stateTimer = 0.5;
      }
    } else {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'idle';
    }
  }

}
