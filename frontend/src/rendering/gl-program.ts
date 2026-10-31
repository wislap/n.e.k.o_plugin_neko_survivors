import { GlProgram, compileHighShaderGl, globalUniformsBitGl, vertexGlTemplate, fragmentGlTemplate } from 'pixi.js';
/** Pixi's convenience compiler defaults to GLSL ES 1.00 even on a GL2 context.
 * Explicitly select ES 3.00 for integer material fetch and dynamic trail indexing. */
export function gl2Program(name: string, bits: Parameters<typeof compileHighShaderGl>[0]['bits']): GlProgram {
  return GlProgram.from({ name, preferredFragmentPrecision: 'highp', ...compileHighShaderGl({
    template: { vertex: '#version 300 es\n' + vertexGlTemplate, fragment: '#version 300 es\n' + fragmentGlTemplate },
    bits: [globalUniformsBitGl, ...bits],
  }) });
}
