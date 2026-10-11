import { AbiCoder, getAddress, keccak256, concat, id, ZeroAddress } from 'ethers';
const abi = AbiCoder.defaultAbiCoder();
export const tags = {
  leaf: id('YUBENZHE_DISTRIBUTION_LEAF_V1'),
  commit: id('YUBENZHE_DISTRIBUTION_COMMIT_V1'),
};
export function leaf({ chainId, sender, campaignId, index, account, salt }) {
  return keccak256(keccak256(abi.encode(
    ['bytes32', 'uint256', 'address', 'bytes32', 'uint256', 'address', 'bytes32'],
    [tags.leaf, chainId, sender, campaignId, index, account, salt],
  )));
}
export function commitment({ domain, index, account, secret }) {
  return keccak256(abi.encode(['bytes32','bytes32','uint256','address','bytes32'], [tags.commit, domain, index, account, secret]));
}
const pair = (a, b) => keccak256(concat(BigInt(a) < BigInt(b) ? [a, b] : [b, a]));

// Ordered fixed slot manifest; Merkle sibling pairs are sorted, as required by OZ MerkleProof.
// Keep invitation salts confidential until commit. This does not hide transactions on chain.
export function invitations({ chainId, sender, campaignId, members }) {
  if (members.length < 2 || members.length > 200) throw new Error('Need 2..200 fixed recipients');
  const normalized = members.map(m => ({ account: getAddress(m.account), salt: m.salt }));
  if (normalized.some(m => m.account === ZeroAddress)) throw new Error('Zero address cannot be a recipient');
  if (normalized.some(m => m.account === getAddress(sender))) throw new Error('Sender cannot be a recipient');
  if (new Set(normalized.map(m => m.account)).size !== members.length) throw new Error('Duplicate recipient');
  const leaves = normalized.map((m, index) => leaf({ chainId, sender, campaignId, index, ...m }));
  const layers = [leaves];
  while (layers.at(-1).length > 1) {
    const prev = layers.at(-1), next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  return {
    root: layers.at(-1)[0],
    entries: normalized.map((member, index) => {
      let pos = index;
      const proof = [];
      for (let level = 0; level < layers.length - 1; level++) {
        const sibling = pos ^ 1;
        if (sibling < layers[level].length) proof.push(layers[level][sibling]);
        pos = Math.floor(pos / 2);
      }
      return { index, ...member, proof, leaf: leaves[index] };
    }),
  };
}
