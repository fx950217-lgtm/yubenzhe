// These capabilities must be enabled separately from simulation and the shared
// reviewer gate. Validate before opening persistent databases in start.mjs.
export function validatePublicAccountMode({role='frontend',origin,publicFrontend=false,internalPreview=false,simulation=false,publicPasswordRegistration=false,workbenchRulesEnabled=false,groupWorkflowsEnabled=false,publicTestMail=false}={}){
 if(publicTestMail)throw new Error('PUBLIC_TEST_MAIL is not supported: public authentication must prove account ownership.');
 if(!publicPasswordRegistration&&!workbenchRulesEnabled&&!groupWorkflowsEnabled)return;
 if(role!=='frontend'||!publicFrontend||internalPreview||simulation)throw new Error('Public account and workflow features require frontend PUBLIC_FRONTEND=true without INTERNAL_PREVIEW or M0_SIMULATION.');
 let url;try{url=new URL(origin);}catch{throw new Error('Public account and workflow features require an explicit HTTPS origin.');}
 if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw new Error('Public account and workflow features require an explicit HTTPS origin.');
 if(groupWorkflowsEnabled&&!workbenchRulesEnabled)throw new Error('GROUP_WORKFLOWS_ENABLED requires WORKBENCH_RULES_ENABLED.');
}
