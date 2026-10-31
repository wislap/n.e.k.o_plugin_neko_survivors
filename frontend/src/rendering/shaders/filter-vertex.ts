export const filterVertex = `
in vec2 aPosition; out vec2 vTextureCoord; out vec2 vScreenCoord;
uniform vec4 uInputSize; uniform vec4 uOutputFrame; uniform vec4 uOutputTexture;
void main(){
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(p,0.0,1.0); vScreenCoord=aPosition; vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;
