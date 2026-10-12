import {getAddress} from 'ethers';

const HASH=/^0x[0-9a-f]{64}$/i;
const QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const ZERO='0x0000000000000000000000000000000000000000';
const quantity=value=>{if(typeof value!=='string'||!QUANTITY.test(value)||value.length>66)throw Error('Invalid chain quantity');return BigInt(value);};
const address=value=>getAddress(value).toLowerCase();
const sameHash=(a,b)=>typeof a==='string'&&typeof b==='string'&&HASH.test(a)&&a.toLowerCase()===b.toLowerCase();

function transactionUsesTestnet(tx){
 // Legacy JSON-RPC transactions can omit chainId. EIP-155 puts it in v:
 // v = chainId * 2 + 35 + yParity. Unprotected v=27/28 must never qualify.
 if(tx.type===undefined||quantity(tx.type)===0n){
  if(tx.v===undefined)return false;
  const v=quantity(tx.v);if(v<35n)return false;
  const signedChain=(v-35n)/2n;
  return signedChain===97n&&(tx.chainId===undefined||quantity(tx.chainId)===signedChain);
 }
 // A typed transaction carries its own chainId; never infer it from parity.
 return tx.chainId!==undefined&&quantity(tx.chainId)===97n;
}

async function readBoundedJSON(response){
 const limit=2*1024*1024,declared=response.headers.get('content-length');
 if(declared&&/^\d+$/.test(declared)&&Number(declared)>limit){await response.body?.cancel();throw Error('Oversized RPC response');}
 if(!response.body?.getReader)throw Error('Missing RPC response body');
 const reader=response.body.getReader(),parts=[];let length=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw Error('Oversized RPC response');}parts.push(value);}
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

// Public, deterministic transaction memo. It binds a native-token transfer to
// one accepted task intent without putting task text or wallet secrets on-chain.
export function buildTaskPaymentData(id,digest){
 if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||typeof digest!=='string'||!/^(?:0x)?[a-f0-9]{64}$/i.test(digest))throw Error('Invalid task payment memo');
 return '0x'+Buffer.from('YBZ-TASK-PAYMENT:v1:'+id.toLowerCase()+':'+digest.replace(/^0x/i,'').toLowerCase(),'utf8').toString('hex');
}

function checkedIntent(intent){
 if(!intent||intent.chainId!==97||typeof intent.id!=='string'||!intent.id||!Number.isSafeInteger(intent.createdAt)||intent.createdAt<=0||typeof intent.valueWei!=='string'||!/^[1-9][0-9]{0,77}$/.test(intent.valueWei)||BigInt(intent.valueWei)>=2n**256n||typeof intent.data!=='string'||!/^0x(?:[0-9a-f]{2}){1,256}$/i.test(intent.data))throw Error('Invalid intent');
 const from=address(intent.from),to=address(intent.to);
 if(from===to||from===ZERO||to===ZERO)throw Error('Invalid recipient');
 const memo=Buffer.from(intent.data.slice(2),'hex').toString('utf8');
 if(!memo.startsWith('YBZ-TASK-PAYMENT:v1:'+intent.id.toLowerCase()+':')||!/[a-f0-9]{64}$/.test(memo)||buildTaskPaymentData(intent.id,memo.slice(-64))!==intent.data.toLowerCase())throw Error('Invalid intent memo');
 return {...intent,from,to,value:BigInt(intent.valueWei),data:intent.data.toLowerCase()};
}

export function createTaskPaymentVerifier({rpcUrls=[],fetchImpl=globalThis.fetch,minConfirmations=3}={}){
 if(!Number.isSafeInteger(minConfirmations)||minConfirmations<3||minConfirmations>30)throw Error('Task payments require 3–30 confirmations');
 if(!Array.isArray(rpcUrls)||rpcUrls.length>4)throw Error('Invalid testnet RPC configuration');
 const urls=rpcUrls.map(value=>{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid testnet RPC URL');return url.href;});
 let sequence=0;
 async function rpc(url,method,params=[]){
  const id=++sequence,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:controller.signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
   if(!response.ok)throw Error('RPC unavailable');
   const body=await readBoundedJSON(response);
   if(body.jsonrpc!=='2.0'||body.id!==id||body.error||!Object.hasOwn(body,'result'))throw Error('Invalid RPC response');
   return body.result;
  }finally{clearTimeout(timer);}
 }
 const base=hash=>({hash,chainId:97,confirmations:0,blockNumber:null,blockHash:null,feeWei:null});
 async function atURL(url,intent,hash){
  const empty=base(hash);
  if(quantity(await rpc(url,'eth_chainId'))!==97n)return {...empty,state:'mismatch',reason:'TESTNET_ONLY'};
  const [tx,receipt]=await Promise.all([rpc(url,'eth_getTransactionByHash',[hash]),rpc(url,'eth_getTransactionReceipt',[hash])]);
  if(!tx)return {...empty,state:'unknown',reason:receipt?'TRANSACTION_MISSING':'NOT_YET_VISIBLE'};
  if(!sameHash(tx.hash,hash)||!transactionUsesTestnet(tx)||address(tx.from)!==intent.from||address(tx.to)!==intent.to||quantity(tx.value)!==intent.value||typeof tx.input!=='string'||tx.input.toLowerCase()!==intent.data)return {...empty,state:'mismatch',reason:'TRANSACTION_MISMATCH'};
  if(!receipt)return {...empty,state:'pending',reason:'AWAITING_RECEIPT'};
  if(!sameHash(receipt.transactionHash,hash)||!['0x0','0x1'].includes(receipt.status)||!HASH.test(receipt.blockHash||'')||address(receipt.from)!==intent.from||address(receipt.to)!==intent.to||!sameHash(tx.blockHash,receipt.blockHash)||quantity(tx.blockNumber)!==quantity(receipt.blockNumber))return {...empty,state:'mismatch',reason:'RECEIPT_MISMATCH'};
  const blockNumber=quantity(receipt.blockNumber);
  const [latestRaw,canonical]=await Promise.all([rpc(url,'eth_blockNumber'),rpc(url,'eth_getBlockByNumber',[receipt.blockNumber,false])]);
  const latest=quantity(latestRaw);
  if(latest>BigInt(Number.MAX_SAFE_INTEGER)||blockNumber>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid block height');
  if(!canonical||!sameHash(canonical.hash,receipt.blockHash)||quantity(canonical.number)!==blockNumber||latest<blockNumber)return {...empty,state:'unknown',reason:'CHAIN_REORGANIZED'};
  const confirmations=Number(latest-blockNumber+1n),gasUsed=quantity(receipt.gasUsed),gasPrice=quantity(receipt.effectiveGasPrice);
  if(gasUsed<=0n||gasPrice<=0n||gasUsed*gasPrice>=2n**256n)throw Error('Invalid receipt fee');
  return {...empty,state:confirmations<minConfirmations?'pending':receipt.status==='0x1'?'confirmed':'failed',reason:confirmations<minConfirmations?'AWAITING_CONFIRMATIONS':receipt.status==='0x1'?'VERIFIED':'EXECUTION_FAILED',confirmations,blockNumber:Number(blockNumber),blockHash:receipt.blockHash.toLowerCase(),feeWei:(gasUsed*gasPrice).toString(),receiptStatus:receipt.status==='0x1'?'success':'failed'};
 }
 return Object.freeze({configured:urls.length>0,minConfirmations,async verify(rawIntent,hash){
  if(typeof hash!=='string'||!HASH.test(hash))return {...base(null),state:'mismatch',reason:'HASH_INVALID'};
  hash=hash.toLowerCase();let intent;try{intent=checkedIntent(rawIntent);}catch{return {...base(hash),state:'mismatch',reason:'INTENT_INVALID'};}
  if(!urls.length)return {...base(hash),state:'unknown',reason:'TESTNET_RPC_UNCONFIGURED'};
  for(const url of urls){try{return await atURL(url,intent,hash);}catch{/* Provider errors are untrusted; never expose endpoint, response or input. */}}
  return {...base(hash),state:'unknown',reason:'RPC_UNAVAILABLE'};
 }});
}
