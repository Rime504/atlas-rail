// Minimal copy of the Codama instruction file, taken from the payment-channels IDL published
// on Devnet for CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX. Only the parts
// scripts/recover-funded-channel.mjs reads: the discriminator and the account metas.
export const REQUEST_CLOSE_DISCRIMINATOR = 5;

export function getRequestCloseInstruction(input) {
  const originalAccounts = {
    payer: { value: input.payer ?? null, isWritable: false },
    channel: { value: input.channel ?? null, isWritable: true },
  };
  const accounts = originalAccounts;
  return accounts;
}
