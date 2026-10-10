import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function compile() {
  const sources = {};
  async function add(name) {
    if (sources[name]) return;
    const filename = name.startsWith('@') ? path.join(root, 'node_modules', name) : path.join(root, name);
    const content = await fs.readFile(filename, 'utf8');
    sources[name] = { content };
    for (const match of content.matchAll(/import\s+(?:[^;]*?from\s*)?["']([^"']+)["']\s*;/g)) {
      const dependency = match[1].startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])) : match[1];
      await add(dependency);
    }
  }
  await add('src/SingleDistribution.sol');
  await add('test/MockToken.sol');
  const input = JSON.stringify({ language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  } });
  let output;
  if (process.env.SOLC_BINARY) {
    const raw = await new Promise((resolve, reject) => {
      const child = spawn(process.env.SOLC_BINARY, ['--standard-json'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || 'solc exited ' + code)));
      child.stdin.end(input);
    });
    output = JSON.parse(raw);
  } else {
    const { default: solc } = await import('solc');
    output = JSON.parse(solc.compile(input));
  }
  const errors = (output.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  return { contracts: output.contracts, warnings: (output.errors ?? []).filter(e => e.severity !== 'error') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await compile();
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  for (const [source, contracts] of Object.entries(result.contracts)) {
    if (!source.startsWith('src/')) continue;
    for (const [name, artifact] of Object.entries(contracts)) {
      await fs.writeFile(path.join(root, 'artifacts', name + '.json'), JSON.stringify(artifact, null, 2) + '\n');
      console.log(name + ': compiled, deployed bytecode ' + artifact.evm.deployedBytecode.object.length / 2 + ' bytes');
    }
  }
  for (const warning of result.warnings) console.warn(warning.formattedMessage);
}
