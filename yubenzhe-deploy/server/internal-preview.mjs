import {fail} from './social-validation.mjs';

// This process-local capability is attached only after the outer login succeeds.
// A JSON body, cookie value, forwarded address, or identity header cannot supply it.
export const INTERNAL_PREVIEW_SESSION=Symbol('authenticated-internal-preview-session');
export function requireInternalPreviewSession(request){
 if(request.internalPreviewSession!==INTERNAL_PREVIEW_SESSION)fail(401,'INTERNAL_PREVIEW_REQUIRED','请先登录内部预览，再使用产品账号。');
}
export function validateInternalPreview({internalPreview=false,role,origin,publicFrontend=false,simulation=false}={}){
 if(!internalPreview)return;
 if(role!=='frontend')throw Error('INTERNAL_PREVIEW is only supported by the frontend role.');
 if(publicFrontend)throw Error('INTERNAL_PREVIEW requires PUBLIC_FRONTEND=false.');
 if(simulation)throw Error('INTERNAL_PREVIEW and M0_SIMULATION are separate modes.');
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw Error('INTERNAL_PREVIEW requires an explicit HTTPS origin.');
}
