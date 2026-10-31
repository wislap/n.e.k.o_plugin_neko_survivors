import { DOMAdapter, WebWorkerAdapter, extensions, DOMPipe, HTMLTextPipe, HTMLTextSystem, loadTextures } from 'pixi.js';
/** Configure only this worker realm. DOM-only pipes must be removed before Pixi
 * constructs them; texture loading uses fetch/createImageBitmap, never Image. */
export function configureWorkerRendering():void {
 DOMAdapter.set(WebWorkerAdapter);
 extensions.remove(DOMPipe,HTMLTextPipe,HTMLTextSystem);
 loadTextures.config={...loadTextures.config,preferWorkers:false,preferCreateImageBitmap:true,crossOrigin:loadTextures.config?.crossOrigin??'anonymous'};
}
