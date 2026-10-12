
export function localDeadline({expiresAt,serverTime,receivedAt,roundTrip}){
 if(![expiresAt,serverTime,receivedAt,roundTrip].every(Number.isFinite)||roundTrip<0)return 0;
 return receivedAt+Math.max(0,Math.min(600000,expiresAt-serverTime)-roundTrip);
}
