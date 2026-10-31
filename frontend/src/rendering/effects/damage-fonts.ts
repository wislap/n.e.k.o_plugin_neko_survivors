import { BitmapFont, Cache, CanvasSource, CanvasTextGenerator, CanvasTextMetrics, DOMAdapter, TextStyle, Texture, type BitmapFontData } from 'pixi.js';
const UNITS = 1024;
const characters = '0123456789!';
let owner = 0;
interface Font { name:string; font:BitmapFont; advances:Map<string,number>; pairs:Map<string,number> }
export interface DamageFont { name:string; offsetX:number }
/** Native-size Canvas glyphs, copied once into renderer-owned atlases. Large font
 * units avoid BitmapText's integer-position rounding changing fractional advances. */
export class DamageFonts {
  private readonly prefix = `damage-digits-${++owner}`;
  private generation = 0;
  private readonly fonts = new Map<number,Font>();
  constructor(private readonly resolution:number) {}
  warm():void{for(const size of[14,19])if(!this.fonts.has(size))this.fonts.set(size,this.create(size));}
  accepts(text:string|undefined):boolean{return !!text&&/^[0-9]{1,15}!?$/.test(text);}
  font(text:string,critical:boolean|undefined):DamageFont {
    const size=critical?19:14;
    let row=this.fonts.get(size);
    if(!row){row=this.create(size);this.fonts.set(size,row);}
    let width=0,previous='';
    for(const char of text){width+=row.advances.get(char)!+(row.pairs.get(previous+char)??0);previous=char;}
    return{name:row.name,offsetX:(width+3-Math.ceil(width+3))*.5};
  }
  private create(size:number):Font {
    const name=`${this.prefix}-${this.generation}-${size}`,unit=this.resolution*UNITS;
    const style=new TextStyle({fontFamily:'Arial',fontSize:size,fontWeight:'bold',fill:0xffffff,stroke:{color:0,width:3}});
    const measured=CanvasTextMetrics.measureText('0',style),height=Math.ceil(measured.height),line=height-3;
    const canvas=DOMAdapter.get().createCanvas(1024,128),context=canvas.getContext('2d') as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;
    const data:BitmapFontData={fontFamily:name,fontSize:size*unit,lineHeight:line*unit,baseLineOffset:0,pages:[{id:0,file:''}],chars:{}};
    const advances=new Map<string,number>(),pairs=new Map<string,number>();let x=0;
    for(const char of characters){
      const metrics=CanvasTextMetrics.measureText(char,style),glyph=CanvasTextGenerator.getCanvasAndContext({text:char,style,resolution:this.resolution}),frame=glyph.frame;
      context.drawImage(glyph.canvasAndContext.canvas as CanvasImageSource,0,0,frame.width,frame.height,x,0,frame.width,frame.height);
      const advance=metrics.lineWidths[0];advances.set(char,advance);
      data.chars[char]={id:char.codePointAt(0)!,page:0,x:x*UNITS,y:0,width:frame.width*UNITS,height:frame.height*UNITS,xOffset:0,yOffset:-Math.max(0,line-size)*unit*.5,xAdvance:advance*unit,kerning:{},letter:char};
      x+=frame.width+4;CanvasTextGenerator.returnCanvasAndContext(glyph.canvasAndContext);
    }
    for(const a of characters)for(const b of characters){const k=CanvasTextMetrics.measureText(a+b,style).lineWidths[0]-advances.get(a)!-advances.get(b)!;pairs.set(a+b,k);data.chars[b].kerning![a]=k*unit;}
    const source=new CanvasSource({resource:canvas,resolution:1/UNITS,autoGarbageCollect:false}),texture=new Texture({source});
    const font=new BitmapFont({data,textures:[texture]});Cache.set(name+'-bitmap',font);font.once('destroy',()=>Cache.remove(name+'-bitmap'));style.destroy();
    return{name,font,advances,pairs};
  }
  get diagnostics(){return{fonts:this.fonts.size,glyphs:this.fonts.size*11};}
  clear():void{for(const row of this.fonts.values())row.font.destroy();this.fonts.clear();this.generation++;}
}
