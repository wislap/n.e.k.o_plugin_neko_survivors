/** Shared analytic coverage and ordered additive/normal output. */
export const analyticFragment = { header: 'in float vAdditive; in vec2 vLocal; in vec4 vShape;', main: `
    if(vShape.x>.5){
      float d=dot(vLocal,vLocal);
      if(vShape.x>6.5){vec2 q=max(abs(vLocal)-(vec2(1.)-vShape.yz),vec2(0.))/max(vShape.yz,vec2(.000001));if(dot(q,q)>1.)discard;}
      else if(vShape.x<3.5){ if(d>1.) discard; if(vShape.x>1.5&&d<vShape.y*vShape.y) discard;
        if(vShape.x>2.5){float a=mod(atan(vLocal.y,vLocal.x)-vShape.z+6.28318530718,6.28318530718);if(a>vShape.w)discard;}
      }else if(vShape.x>5.5){if(abs(vLocal.y)>(1.-vLocal.x)*.5)discard;}else if(vShape.x>4.5){
        vec2 a=vec2(0.,-1.),b=vec2(1.,1.),c=vec2(-1.,.888888889);
        vec2 ab=b-a,bc=c-b,ca=a-c,pa=vLocal-a,pb=vLocal-b,pc=vLocal-c;
        if(ab.x*pa.y-ab.y*pa.x<0.||bc.x*pb.y-bc.y*pb.x<0.||ca.x*pc.y-ca.y*pc.x<0.)discard;
      }
      outColor=vec4(1.);
    }
  `, end: 'finalColor.a*=1.-vAdditive;' };
