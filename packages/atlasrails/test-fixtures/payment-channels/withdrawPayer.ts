// Minimal copy of the Codama instruction file, taken from the payment-channels IDL published
// on Devnet for CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX. Only the parts
// scripts/recover-funded-channel.mjs reads: the discriminator and the account metas.
export const WITHDRAW_PAYER_DISCRIMINATOR = 8;

export function getWithdrawPayerInstruction(input) {
  const originalAccounts = {
    payer: { value: input.payer ?? null, isWritable: false },
    channel: { value: input.channel ?? null, isWritable: true },
    channelTokenAccount: { value: input.channelTokenAccount ?? null, isWritable: true },
    payerTokenAccount: { value: input.payerTokenAccount ?? null, isWritable: true },
    mint: { value: input.mint ?? null, isWritable: false },
    tokenProgram: { value: input.tokenProgram ?? null, isWritable: false },
  };
  const accounts = originalAccounts;
  return accounts;
}
