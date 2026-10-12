import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'ethers';
import { compile, root } from './compile.mjs';

export async function exportAbi() {
  const {contracts} = await compile();
  await fs.mkdir(path.join(root, 'exports'), {recursive:true});
  for (const name of ['EqualDistribution','InternalTestToken','SingleDistribution']) {
    const artifact=contracts['src/'+name+'.sol'][name];
    await fs.writeFile(path.join(root,'exports',name+'.json'),JSON.stringify({
      schemaVersion:1,contractName:name,chainId:97,mode:name==='SingleDistribution'?'commit-reveal-experimental':name==='EqualDistribution'?'equal':'test-token',
      ...(name==='SingleDistribution'?{}:{allowedChainIds:[97]}),
      deploymentStatus:'not-deployed',compiler:{version:'0.8.20',optimizer:{enabled:true,runs:200},evmVersion:'paris'},
      creationCodeHash:keccak256('0x'+artifact.evm.bytecode.object),abi:artifact.abi,
    },null,2)+'\n');
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await exportAbi();console.log('Exported three ABI interfaces. No network request or deployment performed.');
}
