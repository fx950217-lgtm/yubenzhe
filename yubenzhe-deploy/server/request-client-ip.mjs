import {isIP} from 'node:net';

export const DEFAULT_TRUSTED_PROXY_IPS=Object.freeze(['127.0.0.1','::1','::ffff:127.0.0.1']);
const normalizedIP=value=>value.toLowerCase().replace(/^::ffff:(?=\d+\.)/,'');

export function parseTrustedProxyIPs(value){
 if(value===undefined||value==='')return [...DEFAULT_TRUSTED_PROXY_IPS];
 if(typeof value!=='string'||value.length>2048)throw new Error('TRUSTED_PROXY_IPS must list at most 32 exact IP addresses.');
 const ips=value.split(',').map(ip=>ip.trim());if(ips.length>32||ips.some(ip=>!isIP(ip)))throw new Error('TRUSTED_PROXY_IPS must list at most 32 exact IP addresses.');
 return [...new Set(ips.map(normalizedIP))];
}

// The final hop is supplied by the explicitly trusted reverse proxy. Never use
// the first client-supplied hop or forwarding headers from an untrusted socket.
export function requestClientIP(request,trustedProxyIPs=DEFAULT_TRUSTED_PROXY_IPS){
 const peer=request.socket.remoteAddress||'unknown';
 if(trustedProxyIPs.some(trusted=>normalizedIP(trusted)===normalizedIP(peer))){
  const forwarded=String(request.headers['x-forwarded-for']||'').split(',').at(-1).trim();
  if(isIP(forwarded))return normalizedIP(forwarded);
 }
 return peer;
}
