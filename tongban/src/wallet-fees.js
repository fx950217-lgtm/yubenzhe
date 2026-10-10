const amount = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/.test(value);

// Never invent a USD conversion for a testnet asset. Older records retain their quote.
export function walletFeeText(record = {}) {
  if (amount(record.actualGasFee)) return `手续费 ${record.actualGasFee} tBNB · 实际`;
  if (amount(record.gasFee)) return `手续费 ${record.gasFee} tBNB · 预估`;
  return '手续费待核实 · 查看链上回执';
}
