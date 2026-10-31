import type { PresentationProfile } from '../presentation/profile';
import { Container, Filter, GlProgram, Graphics, Rectangle, UniformGroup } from 'pixi.js';

// HTML Canvas gradients use the latest intersecting circle in the two-circle
// family and interpolate RGBA before premultiplication, unlike CSS gradients.
// https://html.spec.whatwg.org/multipage/canvas.html#fill-and-stroke-styles
const vertex = `
in vec2 aPosition; out vec2 vScreenCoord;
uniform vec4 uOutputFrame; uniform vec4 uOutputTexture;
void main(){
  vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;
  p.x=p.x*(2.0/uOutputTexture.x)-1.0;
  p.y=p.y*(2.0*uOutputTexture.z/uOutputTexture.y)-uOutputTexture.z;
  gl_Position=vec4(p,0.0,1.0);vScreenCoord=aPosition;
}`;
export const idleBackgroundGLSL = `
in vec2 vScreenCoord; out vec4 finalColor;
uniform vec2 uSize; uniform float uVignette;
float radial(vec2 p,vec2 c0,float r0,vec2 c1,float r1){
  vec2 d=c1-c0;vec2 q=p-c0;float dr=r1-r0;
  float a=dot(d,d)-dr*dr;float b=-2.0*(dot(q,d)+r0*dr);float c=dot(q,q)-r0*r0;
  if(abs(a)<0.00001)return clamp(abs(b)>0.00001?-c/b:0.0,0.0,1.0);
  float root=sqrt(max(0.0,b*b-4.0*a*c));
  return clamp(max((-b-root)/(2.0*a),(-b+root)/(2.0*a)),0.0,1.0);
}
void main(){
  vec2 p=vScreenCoord*uSize;float longest=max(uSize.x,uSize.y);
  if(uVignette>0.5){
    float t=radial(p,uSize*0.5,min(uSize.x,uSize.y)*0.42,uSize*0.5,longest*0.74);
    float alpha=0.16*t;vec3 rgb=mix(vec3(1.0),vec3(120.0,170.0,220.0)/255.0,t);
    finalColor=vec4(rgb*alpha,alpha);
  }else{
    float t=radial(p,vec2(uSize.x*0.5,uSize.y*0.36),30.0,vec2(uSize.x*0.5,uSize.y*0.52),longest*0.78);
    vec3 a=vec3(242.0,249.0,255.0)/255.0;vec3 b=vec3(220.0,236.0,255.0)/255.0;vec3 c=vec3(207.0,228.0,250.0)/255.0;
    finalColor=vec4(t<=0.55?mix(a,b,t/0.55):mix(b,c,(t-0.55)/0.45),1.0);
  }
}`;
class IdleGradient extends Filter {
  private readonly settings: UniformGroup;
  constructor(vignette: boolean) {
    const settings = new UniformGroup({ uSize: { value: [1, 1], type: 'vec2<f32>' }, uVignette: { value: vignette ? 1 : 0, type: 'f32' } });
    super({ glProgram: GlProgram.from({ name: 'survivors-idle-gradient', vertex, fragment: idleBackgroundGLSL, preferredFragmentPrecision: 'highp' }),
      resources: { idle: settings }, resolution: 'inherit', padding: 0 });
    this.settings = settings;
  }
  resize(width: number, height: number): void { this.settings.uniforms.uSize = [width, height]; this.settings.update(); }
}
/** Exact reference idle formulas, driven exclusively by the application's existing frame timestamp. */
export class IdleBackground extends Container {
  private readonly base = new Graphics({ label: 'idle-sky' });
  private readonly stars = new Container({ label: 'idle-stars' });
  private readonly dust = new Container({ label: 'idle-dust' });
  private readonly vignette = new Graphics({ label: 'idle-vignette' });
  private skyFilter?: IdleGradient;
  private vignetteFilter?: IdleGradient;
  private size = '';
  constructor({ mobile }: Readonly<PresentationProfile>) {
    super({ label: 'idle-background' });
    this.addChild(this.base, this.stars, this.dust, this.vignette);
    for (let i = 0; i < (mobile ? 23 : 46); i++) this.stars.addChild(new Graphics().circle(0, 0, .7 + (i % 3) * .4).fill(0x7fa6cf));
    for (let i = 0; i < (mobile ? 20 : 40); i++) {
      const r = 1.1 + i % 3, glow = .10 + (i % 5) * .05, color = [0xff5d9e, 0x2aa8d0, 0x8a6bf0][i % 3];
      this.dust.addChild(new Graphics().circle(0, 0, r * 3.2).fill({ color, alpha: glow * .85 }).circle(0, 0, r).fill({ color, alpha: Math.min(.9, glow + .5) }));
    }
  }
  sync(width: number, height: number, nowMs: number): void {
    const signature = `${width}:${height}`;
    if (signature !== this.size) {
      this.size = signature;
      this.skyFilter ??= new IdleGradient(false); this.vignetteFilter ??= new IdleGradient(true);
      this.skyFilter.resize(width, height); this.vignetteFilter.resize(width, height);
      this.base.clear().rect(0, 0, width, height).fill(0xffffff); this.base.filters = [this.skyFilter];
      this.vignette.clear().rect(0, 0, width, height).fill(0xffffff); this.vignette.filters = [this.vignetteFilter];
      this.base.filterArea = new Rectangle(0, 0, width, height); this.vignette.filterArea = new Rectangle(0, 0, width, height);
    }
    const t = nowMs / 1000;
    this.stars.children.forEach((star, i) => {
      const seed = i * 97.13;
      star.position.set((seed * 5.31) % width, (seed * 3.77) % height);
      star.alpha = (.12 + .5 * Math.abs(Math.sin(t * .7 + i * 1.71))) * .45;
    });
    this.dust.children.forEach((particle, i) => {
      const seed = i * 137.508, speed = 9 + i % 5 * 7;
      particle.position.set((((seed * 7.3 + Math.sin(t * .35 + i) * 42) % (width + 60)) + width + 60) % (width + 60) - 30,
        (((seed * 3.7 - t * speed) % (height + 90)) + height + 90) % (height + 90) - 45);
    });
  }
  override destroy(): void {
    if (this.destroyed) return;
    this.base.filters = []; this.vignette.filters = [];
    this.skyFilter?.destroy(); this.vignetteFilter?.destroy();
    super.destroy({ children: true, context: true });
  }
}
