import { Filter, GlProgram, UniformGroup } from 'pixi.js';
// Normalized distortion, tint and peripheral fog in the WebGL2 scene.
import { filterVertex } from './filter-vertex';
export const atmosphereGLSL = `
in vec2 vTextureCoord; in vec2 vScreenCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform vec4 uInputClamp;
uniform float uTime; uniform float uHeat; uniform float uFog; uniform float uVeil;
uniform vec4 uTint; uniform vec4 uVision; uniform float uDanger;
void main(){
  vec2 uv = vTextureCoord;
  uv.x += sin(vScreenCoord.y * 85.0 + uTime * 3.0) * 0.0017 * uHeat;
  vec4 c = texture(uTexture, clamp(uv,uInputClamp.xy,uInputClamp.zw));
  float radial = smoothstep(0.10,0.58,length(vScreenCoord-vec2(0.5)));
  float distance = length((vScreenCoord-uVision.xy)*uVision.zw);
  float mist = clamp(uFog * smoothstep(200.0,400.0,distance),0.0,0.94);
  c.rgb = mix(c.rgb, vec3(0.73,0.79,0.86)*c.a, mist);
  c.rgb = mix(c.rgb,uTint.rgb*c.a,uTint.a);
  c.rgb *= 1.0-uVeil*radial;
  c.rgb = mix(c.rgb,vec3(1.0,0.0,0.157)*c.a,uDanger*radial);
  finalColor=c;
}`;
export class AtmosphereFilter extends Filter {
  private readonly settings: UniformGroup;
  constructor() {
    const settings = new UniformGroup({
      uTime: { value: 0, type: 'f32' }, uHeat: { value: 0, type: 'f32' },
      uFog: { value: 0, type: 'f32' }, uVeil: { value: 0, type: 'f32' },
      uTint: { value: [0, 0, 0, 0], type: 'vec4<f32>' },
      uVision: { value: [.5, .5, 800, 600], type: 'vec4<f32>' },
      uDanger: { value: 0, type: 'f32' },
    });
    super({ glProgram: GlProgram.from({ name: 'survivors-atmosphere', vertex:filterVertex, fragment: atmosphereGLSL }),
      resources: { atmosphereUniforms: settings } });
    this.settings = settings;
  }
  update(time: number, heat: number, fog: number, veil: number, tint: readonly number[], vision = [.5, .5, 800, 600], danger = 0): void {
    const u = this.settings.uniforms;
    u.uTime = time; u.uHeat = heat; u.uFog = fog; u.uVeil = veil; u.uTint = [...tint]; u.uVision = vision; u.uDanger = danger;
    this.settings.update();
  }
}
