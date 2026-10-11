import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Contract,ContractFactory,JsonRpcProvider,Wallet,getAddress,getCreateAddress,isHexString,keccak256,ZeroAddress,ZeroHash} from 'ethers';
import {compile,root} from './compile.mjs';

export const CHAIN_ID=97;
export class PreviewError extends Error {constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new PreviewError(code,message);};
const integer=(value,label,min,max)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail('INVALID_PLAN',label+' is outside the supported range');return value;};
const uint=(value,label,max=(1n<<128n)-1n)=>{if(typeof value!=='string'||!/^\d{1,39}$/.test(value)||BigInt(value)<=0n||BigInt(value)>max)fail('INVALID_PLAN',label+' must be a positive integer string');return BigInt(value).toString();};
const address=(value,label)=>{try{const result=getAddress(value);if(result===ZeroAddress)throw Error();return result;}catch{fail('INVALID_PLAN',label+' must be a nonzero Ethereum address');}};
export function normalizePlan(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.schemaVersion!==1||raw.chainId!==97)fail('TESTNET_ONLY','Plan must explicitly select schemaVersion 1 and BSC testnet chainId 97');
 if(!['token-only','equal'].includes(raw.mode))fail('MODE_DISABLED','Only the test token and equal distribution can be deployed; experimental random mode is disabled');
 const known=new Set(['schemaVersion','chainId','mode','sender','tokenAddress','campaignId','amount','recipients','claimStart','expiresAt','confirmations','maxFeePerTxWei']);
 if(Object.keys(raw).some(key=>!known.has(key)))fail('INVALID_PLAN','Unexpected plan field; keys and secrets must never be included');
 const plan={schemaVersion:1,chainId:97,mode:raw.mode,sender:address(raw.sender,'sender'),confirmations:integer(raw.confirmations??3,'confirmations',3,30),maxFeePerTxWei:uint(raw.maxFeePerTxWei,'maxFeePerTxWei',10n**18n)};
 if(raw.mode==='token-only')return plan;
 if(!isHexString(raw.campaignId,32)||raw.campaignId===ZeroHash)fail('INVALID_PLAN','campaignId must be a nonzero bytes32');
 if(!Array.isArray(raw.recipients)||raw.recipients.length<1||raw.recipients.length>200)fail('INVALID_PLAN','Equal distribution needs 1..200 recipients');
 const recipients=raw.recipients.map(value=>address(value,'recipient'));
 if(new Set(recipients).size!==recipients.length||recipients.includes(plan.sender))fail('INVALID_PLAN','Recipients must be unique and cannot include the sender');
 const amount=uint(raw.amount,'amount');if(BigInt(amount)<BigInt(recipients.length))fail('INVALID_PLAN','amount must provide at least one smallest unit to every recipient');
 const claimStart=integer(raw.claimStart,'claimStart',1,Number.MAX_SAFE_INTEGER),expiresAt=integer(raw.expiresAt,'expiresAt',claimStart+60,Number.MAX_SAFE_INTEGER);
 return {...plan,tokenAddress:raw.tokenAddress?address(raw.tokenAddress,'tokenAddress'):null,campaignId:raw.campaignId,amount,recipients,claimStart,expiresAt};
}
export async function loadPlan(filename){let value;try{value=JSON.parse(await fs.readFile(filename,'utf8'));}catch{fail('PLAN_READ_FAILED','Cannot read a valid JSON deployment plan');}return normalizePlan(value);}
export async function compiledArtifacts(){const result=await compile();const artifacts=Object.fromEntries(['EqualDistribution','InternalTestToken'].map(name=>[name,result.contracts['src/'+name+'.sol'][name]]));Object.defineProperty(artifacts,'verification',{value:{compilerVersion:'v0.8.20+commit.a1b79de6',standardInput:result.standardInput}});return artifacts;}
const artifactHash=a=>keccak256('0x'+a.evm.bytecode.object);
export function offlinePreparation(plan,artifacts){return {schemaVersion:1,status:'prepared-not-deployed',chainId:97,mode:plan.mode,plan,contracts:Object.fromEntries(Object.entries(artifacts).map(([name,a])=>[name,{creationCodeHash:artifactHash(a),abi:a.abi}])),sourceVerification:artifacts.verification,notice:'No network request, key read, funding, approval or transaction broadcast. Test tokens have no economic value.'};}
export async function assertTestnet(provider){let value;try{value=await provider.send('eth_chainId',[]);}catch{fail('RPC_UNAVAILABLE','Could not verify the RPC chain');}if(BigInt(value)!==97n)fail('TESTNET_ONLY','RPC is not BSC testnet chainId 97');return 97;}
export function rpcProvider(value){let url;try{url=new URL(value);}catch{fail('INVALID_RPC','RPC URL is required');}if(url.username||url.password||url.protocol!=='https:')fail('INVALID_RPC','Use an explicit HTTPS RPC URL without URL credentials');return new JsonRpcProvider(value,undefined,{cacheTimeout:-1,batchMaxCount:1});}
export async function readTestKey(filename,expectedAddress){
 if(!path.isAbsolute(filename))fail('INVALID_KEY_FILE','Dedicated key file must use an absolute path');
 const repository=path.dirname(root),relative=path.relative(repository,path.resolve(filename));
 if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))fail('INVALID_KEY_FILE','Keep the dedicated test key outside the Git repository');
 let stat,raw;try{stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error();if(process.platform!=='win32'&&(stat.mode&0o077))throw Error();raw=JSON.parse(await fs.readFile(filename,'utf8'));}catch{fail('INVALID_KEY_FILE','Cannot read a restricted regular JSON test-key file');}
 if(raw.purpose!=='ybz-bsc-testnet-only'||raw.chainId!==97||!isHexString(raw.privateKey,32))fail('INVALID_KEY_FILE','Key file must explicitly identify a dedicated YBZ BSC testnet key');
 let wallet;try{wallet=new Wallet(raw.privateKey);}catch{fail('INVALID_KEY_FILE','Invalid test key');}
 if(wallet.address!==getAddress(expectedAddress)||raw.expectedAddress&&getAddress(raw.expectedAddress)!==wallet.address)fail('SENDER_MISMATCH','Dedicated key does not match the reviewed sender');return wallet;
}
const configFor=(plan,token)=>({token,campaignId:plan.campaignId,amount:plan.amount,claimStart:plan.claimStart,expiresAt:plan.expiresAt});
export async function verifyTestToken(provider,tokenAddress,artifact){
 const code=await provider.getCode(tokenAddress);if(code==='0x'||keccak256(code)!==keccak256('0x'+artifact.evm.deployedBytecode.object))fail('UNSUPPORTED_TOKEN','Token bytecode is not the compiled fixed-supply internal test token');
 const token=new Contract(tokenAddress,artifact.abi,provider);
 if(await token.totalSupply()!==1000000n*10n**18n||await token.decimals()!==18n||await token.symbol()!=='YBZt')fail('UNSUPPORTED_TOKEN','Internal test token identity does not match');
 return {address:getAddress(tokenAddress),runtimeHash:keccak256(code),symbol:'YBZt',decimals:18,noEconomicValue:true};
}
export async function checkPlan(provider,plan,artifacts){
 await assertTestnet(provider);const block=await provider.getBlock('latest');if(!block)fail('RPC_UNAVAILABLE','Latest block is unavailable');
 if(plan.mode==='equal'&&plan.claimStart<block.timestamp+300)fail('WINDOW_TOO_CLOSE','claimStart must leave at least 300 seconds for deployment, funding and review');
 const token=plan.tokenAddress?await verifyTestToken(provider,plan.tokenAddress,artifacts.InternalTestToken):null;
 const balance=await provider.getBalance(plan.sender);return {status:balance===0n?'needs-testnet-gas':'chain-checked',chainId:97,blockNumber:block.number,blockTimestamp:block.timestamp,sender:plan.sender,testBNBWei:balance.toString(),token,nextStep:token?'Deploy the reviewed equal activity':'Deploy fixed-supply internal test token; activity deployment follows only after confirmation',funding:'No token approval or activity funding is automatic'};
}
async function saveJson(filename,value,exclusive=false){
 const destination=path.resolve(filename),temporary=exclusive?destination:path.join(path.dirname(destination),'.'+path.basename(destination)+'.'+randomUUID()+'.tmp');
 const handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 if(!exclusive)await fs.rename(temporary,destination);
}
export async function verifyRecord(provider,record,plan,artifacts){
 await assertTestnet(provider);
 if(!['InternalTestToken','EqualDistribution'].includes(record.contractName))fail('INVALID_JOURNAL','Unknown deployment contract');
 const artifact=artifacts[record.contractName];if(record.creationCodeHash!==artifactHash(artifact))fail('BUILD_MISMATCH','Local compiled bytecode changed since the reviewed deployment');
 const expectedArgs=record.contractName==='EqualDistribution'?[configFor(plan,record.tokenAddress),plan.recipients]:[];
 const expectedData=(await new ContractFactory(artifact.abi,artifact.evm.bytecode.object).getDeployTransaction(...expectedArgs)).data;
 if(record.data!==expectedData)fail('DEPLOYMENT_MISMATCH','Journal does not contain the exact compiled creation bytecode and reviewed constructor arguments');
 const receipt=await provider.getTransactionReceipt(record.transactionHash);if(!receipt)return {...record,status:'pending-or-unknown'};
 if(receipt.status!==1) return {...record,status:'reverted',blockNumber:receipt.blockNumber};
 const block=await provider.getBlock(receipt.blockNumber),latest=await provider.getBlockNumber();if(!block||block.hash!==receipt.blockHash)fail('REORG_PENDING','Deployment block is not canonical; verify again later');
 const confirmations=latest-receipt.blockNumber+1;if(confirmations<plan.confirmations)return {...record,status:'awaiting-confirmations',confirmations};
 const transaction=await provider.getTransaction(record.transactionHash);
 if(!transaction||transaction.chainId!==97n||getAddress(transaction.from)!==plan.sender||transaction.to!==null||transaction.value!==0n||transaction.data!==record.data||transaction.nonce!==record.nonce)fail('DEPLOYMENT_MISMATCH','Deployment transaction does not match the reviewed creation transaction');
 const deployed=getCreateAddress({from:plan.sender,nonce:record.nonce});if(getAddress(receipt.contractAddress)!==deployed||record.expectedAddress!==deployed)fail('DEPLOYMENT_MISMATCH','Deployment address is not the expected CREATE address');
 const code=await provider.getCode(deployed);if(code==='0x')fail('DEPLOYMENT_MISMATCH','Deployment code is missing');
 if(record.contractName==='InternalTestToken')await verifyTestToken(provider,deployed,artifact);
 else{
  if(plan.tokenAddress&&getAddress(record.tokenAddress)!==plan.tokenAddress)fail('DEPLOYMENT_MISMATCH','Activity token differs from the reviewed plan');
  await verifyTestToken(provider,record.tokenAddress,artifacts.InternalTestToken);
  const contract=new Contract(deployed,artifact.abi,provider),expected=configFor(plan,record.tokenAddress);
  if(await contract.sender()!==plan.sender||await contract.token()!==getAddress(expected.token)||await contract.campaignId()!==plan.campaignId||await contract.totalAmount()!==BigInt(plan.amount)||await contract.claimStart()!==BigInt(plan.claimStart)||await contract.expiresAt()!==BigInt(plan.expiresAt)||await contract.recipientCount()!==BigInt(plan.recipients.length))fail('DEPLOYMENT_MISMATCH','Immutable activity configuration does not match');
  for(let i=0;i<plan.recipients.length;i++){const participant=await contract.participants(i);if(participant.account!==plan.recipients[i]||await contract.recipientIndex(plan.recipients[i])!==BigInt(i+1))fail('DEPLOYMENT_MISMATCH','Fixed recipient list does not match');}
 }
 return {...record,status:'confirmed',address:deployed,runtimeHash:keccak256(code),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,confirmations,gasUsed:receipt.gasUsed.toString(),feeWei:(receipt.gasUsed*receipt.gasPrice).toString()};
}
export async function deployPlan({provider,plan,artifacts,wallet,outDir}){
 const checked=await checkPlan(provider,plan,artifacts);if(checked.testBNBWei==='0')fail('NEEDS_TESTNET_GAS','Dedicated sender has no testnet BNB; nothing was signed or broadcast');if(wallet.address!==plan.sender)fail('SENDER_MISMATCH','Signer does not match the reviewed sender');
 await fs.mkdir(outDir,{recursive:true,mode:0o700});const journalFile=path.join(outDir,'deployment.json');
 const journal={schemaVersion:1,chainId:97,plan,status:'in-progress',transactions:[],createdAt:new Date().toISOString()};
 try{await saveJson(journalFile,journal,true);}catch{fail('OUTPUT_EXISTS','Deployment journal already exists; use receipt verification, never blindly deploy again');}
 await saveJson(path.join(outDir,'verification-input.json'),artifacts.verification,true);
 async function send(name,args=[],extra={}){
  await assertTestnet(provider);const factory=new ContractFactory(artifacts[name].abi,artifacts[name].evm.bytecode.object);
  const unsigned=await factory.getDeployTransaction(...args),estimate=await provider.estimateGas({...unsigned,from:plan.sender}),gasLimit=(estimate*120n+99n)/100n;
  const fee=await provider.getFeeData();if(!fee.gasPrice||fee.gasPrice<=0n)fail('FEE_UNAVAILABLE','A valid testnet gas price is required');
  const maximum=gasLimit*fee.gasPrice;if(maximum>BigInt(plan.maxFeePerTxWei))fail('FEE_LIMIT','Estimated maximum deployment fee exceeds the reviewed per-transaction limit');
  if(await provider.getBalance(plan.sender)<maximum)fail('NEEDS_TESTNET_GAS','Dedicated sender does not have enough testnet BNB');
  const nonce=await provider.getTransactionCount(plan.sender,'pending');const signed=await wallet.signTransaction({...unsigned,chainId:97,type:0,gasPrice:fee.gasPrice,gasLimit,nonce,value:0});
  const record={contractName:name,creationCodeHash:artifactHash(artifacts[name]),transactionHash:keccak256(signed),nonce,expectedAddress:getCreateAddress({from:plan.sender,nonce}),data:unsigned.data,status:'signed-not-yet-confirmed',maxFeeWei:maximum.toString(),...extra};
  journal.transactions.push(record);await saveJson(journalFile,journal);await assertTestnet(provider);
  try{const transaction=await provider.broadcastTransaction(signed);await transaction.wait(plan.confirmations,180000);}catch{record.status='broadcast-result-unknown';await saveJson(journalFile,journal);fail('VERIFY_EXISTING_TRANSACTION','Transaction result is not confirmed. Use receipt with the existing journal; do not deploy again');}
  const verified=await verifyRecord(provider,record,plan,artifacts);Object.assign(record,verified);await saveJson(journalFile,journal);
  if(record.status!=='confirmed')fail('VERIFY_EXISTING_TRANSACTION','Deployment still needs receipt verification; use the existing journal');return record;
 }
 let token=plan.tokenAddress?await verifyTestToken(provider,plan.tokenAddress,artifacts.InternalTestToken):null;
 if(!token){const record=await send('InternalTestToken');token={address:record.address,runtimeHash:record.runtimeHash};}
 if(plan.mode==='equal'){
  await checkPlan(provider,{...plan,tokenAddress:token.address},artifacts);
  await send('EqualDistribution',[configFor(plan,token.address),plan.recipients],{tokenAddress:token.address});
 }
 journal.status='confirmed';journal.token=token;await saveJson(journalFile,journal);await saveJson(path.join(outDir,'chain-preview.json'),publicConfiguration(journal));return journal;
}
export function publicConfiguration(journal){
 const distribution=journal.transactions.find(t=>t.contractName==='EqualDistribution'&&t.status==='confirmed');
 const token=journal.token||journal.transactions.find(t=>t.contractName==='InternalTestToken'&&t.status==='confirmed');
 const enabled=journal.status==='confirmed'&&!!distribution&&!!token?.runtimeHash&&token.address===distribution.tokenAddress;
 return {enabled,mode:'equal',chainId:97,distributionAddress:distribution?.address??null,tokenAddress:token?.address??journal.plan.tokenAddress??null,campaignId:distribution?journal.plan.campaignId:null,runtimeHash:distribution?.runtimeHash??null,tokenRuntimeHash:token?.runtimeHash??null,testToken:true,tokenSymbol:'YBZt',tokenDecimals:18,noEconomicValue:true,deploymentStatus:enabled?'confirmed-not-automatically-funded':'token-only-or-unconfirmed'};
}
export async function verifyJournal({provider,journalFile,artifacts}){
 let journal;try{journal=JSON.parse(await fs.readFile(journalFile,'utf8'));}catch{fail('INVALID_JOURNAL','Cannot read deployment journal');}
 const plan=normalizePlan(journal.plan);if(journal.chainId!==97||!Array.isArray(journal.transactions))fail('INVALID_JOURNAL','Invalid testnet deployment journal');
 for(const record of journal.transactions)Object.assign(record,await verifyRecord(provider,record,plan,artifacts));
 journal.token=plan.tokenAddress?await verifyTestToken(provider,plan.tokenAddress,artifacts.InternalTestToken):journal.transactions.find(t=>t.contractName==='InternalTestToken'&&t.status==='confirmed')??null;
 const expected=plan.mode==='equal'?(plan.tokenAddress?1:2):1;
 journal.status=journal.transactions.length===expected&&journal.transactions.every(r=>r.status==='confirmed')?'confirmed':'incomplete-review-required';
 await saveJson(journalFile,journal);await saveJson(path.join(path.dirname(journalFile),'chain-preview.json'),publicConfiguration(journal));return journal;
}
async function main(){
 const [action,...input]=process.argv.slice(2),args={};for(let i=0;i<input.length;i++){const key=input[i];if(key==='--confirm-testnet'){args.confirm=true;continue;}if(!['--plan','--out','--rpc','--key-file','--journal'].includes(key)||!input[i+1]||input[i+1].startsWith('--'))fail('USAGE','Use prepare/check/deploy/receipt with explicit plan, RPC and output paths');args[key.slice(2)]=input[++i];}
 if(!['prepare','check','deploy','receipt'].includes(action))fail('USAGE','Choose prepare, check, deploy or receipt');
 const artifacts=await compiledArtifacts();
 if(action==='prepare'){const plan=await loadPlan(args.plan);if(!args.out)fail('USAGE','prepare requires --out file');await fs.mkdir(path.dirname(path.resolve(args.out)),{recursive:true});await saveJson(args.out,offlinePreparation(plan,artifacts),true);console.log(JSON.stringify({status:'prepared-not-deployed',chainId:97}));return;}
 const provider=rpcProvider(args.rpc);try{
  if(action==='receipt'){const journal=await verifyJournal({provider,journalFile:args.journal,artifacts});console.log(JSON.stringify({status:journal.status,transactions:journal.transactions.map(r=>({hash:r.transactionHash,status:r.status,address:r.address??null}))}));return;}
  const plan=await loadPlan(args.plan);if(action==='check'){console.log(JSON.stringify(await checkPlan(provider,plan,artifacts)));return;}
  if(!args.confirm||!args['key-file']||!args.out)fail('USAGE','deploy requires --confirm-testnet, --key-file and --out directory');
  await assertTestnet(provider);const wallet=await readTestKey(args['key-file'],plan.sender);const journal=await deployPlan({provider,plan,artifacts,wallet,outDir:args.out});console.log(JSON.stringify({status:journal.status,configuration:publicConfiguration(journal)}));
 }finally{provider.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:error instanceof PreviewError?error.code:'OPERATION_FAILED',message:error instanceof PreviewError?error.message:'Operation failed; review the existing journal before retrying. Provider or key details are intentionally omitted.'}));process.exitCode=1;});
