import {randomUUID} from 'node:crypto';
export function createDisabledMailAdapter(){return {mode:'disabled',async send(){throw new Error('Email delivery is not configured.')}};}
export function createSimulationMailAdapter({origin}={}){
 const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Simulation mail requires an explicit loopback origin.');
 const outbox=[];return {mode:'simulation',origin:url.origin,async send(message){outbox.push({...message,id:randomUUID()});if(outbox.length>100)outbox.shift();},readOutbox:()=>outbox.map(m=>({...m})),clear:()=>{outbox.length=0}};
}
// A delivery provider implements {mode:'provider',send({to,kind,code,expiresAt,locale})}.
// A production provider and OTP HMAC secret must be explicitly injected; no network is used by default.
