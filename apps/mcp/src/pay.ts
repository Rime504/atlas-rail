import { AtlasDenied, AtlasFetch } from '@atlas-rail/agent';

const BODY_LIMIT = 4000;

/** The `pay` tool's whole behaviour, kept apart from the MCP plumbing so it can be tested directly. */
export async function payTool(pay: AtlasFetch, url: string): Promise<string> {
  try {
    const res = await pay(url);
    const body = await res.text();
    const lines = [`HTTP ${res.status}`];
    if (res.atlas?.txSignature) lines.push(`Paid on Solana devnet: https://explorer.solana.com/tx/${res.atlas.txSignature}?cluster=devnet`);
    if (res.atlas?.receipt) lines.push(`Receipt: ${res.atlas.receipt.id} (anyone can check it at https://atlas-rail-playground.vercel.app/verify?tx=${res.atlas.txSignature})`);
    lines.push('', body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT)}\n[truncated]` : body);
    return lines.join('\n');
  } catch (error) {
    if (error instanceof AtlasDenied) {
      return `REFUSED by the Atlas Rail mandate. Nothing was signed or paid.\nRules: ${error.reasons.join(', ')}\nReason: ${error.decision.record.reason}`;
    }
    return `Payment failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
