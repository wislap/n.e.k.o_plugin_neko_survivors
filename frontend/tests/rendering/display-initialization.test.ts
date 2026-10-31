import {afterEach,expect,it,vi} from 'vitest';
import {createGameDisplay} from '../../src/display/display';
import type {GameRenderer} from '../../src/rendering';
afterEach(()=>vi.unstubAllGlobals());
for(const fault of['worker','channel'])it(`cleans the canvas and falls back when ${fault} construction throws`,async()=>{
 const remove=vi.fn(),terminate=vi.fn();
 class Canvas {style={};setAttribute(){}remove=remove;transferControlToOffscreen(){return{};}}
 vi.stubGlobal('HTMLCanvasElement',Canvas);vi.stubGlobal('OffscreenCanvas',class{});
 vi.stubGlobal('document',{createElement:()=>new Canvas()});
 vi.stubGlobal('Worker',class{constructor(){if(fault==='worker')throw new DOMException('Denied','SecurityError');}terminate=terminate;});
 vi.stubGlobal('MessageChannel',class{constructor(){throw new Error('Channel unavailable');}});
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const renderer={canvas:document.createElement('canvas')} as GameRenderer;
 const factory=vi.fn(async()=>renderer),container={appendChild:vi.fn(),clientWidth:100,clientHeight:100} as unknown as HTMLElement;
 const display=await createGameDisplay({container,presentation:{mobile:false,resolution:1}},factory);
 expect(display.thread).toBeUndefined();expect(factory).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledOnce();expect(terminate).toHaveBeenCalledTimes(fault==='worker'?0:1);warning.mockRestore();
});
