import { NextRequest, NextResponse } from 'next/server';
import {
  OnchainAnchor,
  SettleFn,
  attack,
  humanDecision,
  initWorld,
  payAfterRevoke,
  payNormal,
  priceSpikeModerate,
  priceSpikeSevere,
  proveReceipt,
  revokeMandate,
  signMandateStep,
} from '@/lib/scenario';
import { anchorRootOnchain, rateLimited, registerMandateOnchain, resolveDevnetCoreKeys, revokeMandateOnchain, settlePaymentOnchain, withTimeout } from '@/lib/devnet';
import { StepRequest, StepResponse, World } from '@/lib/types';
import { merkleRoot } from '@atlas-rail/receipt';
import { publishReceipt, storeConfigured } from '@/lib/receipt-store';

// Node runtime, not Edge: packages/mandate, packages/receipt and packages/solana use Node's
// `crypto` and `@solana/web3.js`, neither of which runs on the Edge runtime.
export const runtime = 'nodejs';

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: NextRequest) {
  let body: StepRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const { action } = body;
  // Each step's devnet fallback notice describes THIS step's own on-chain attempt, never a previous
  // one's — without this, a step-3 RPC hiccup would keep showing on top of a fully-passing step 7.
  const world: World | null = body.world ? { ...body.world, devnetFallbackReason: null } : body.world;

  try {
    switch (action.type) {
      case 'init': {
        const wantsDevnet = Boolean((action as { useDevnet?: boolean }).useDevnet);
        if (!wantsDevnet) {
          return respond(initWorld('instant', null).world);
        }
        const core = resolveDevnetCoreKeys();
        if (!core) {
          const w = initWorld('instant', null).world;
          return respond({ ...w, devnetFallbackReason: 'Devnet mode is not configured on this deployment yet.' });
        }
        // Decided once per run, here, and reused for every on-chain action this session attempts
        // below (register, two settlements, an anchor, revoke) — so one full walkthrough counts as
        // one run against the hourly limit, not five.
        if (rateLimited(clientIp(req))) {
          return respond({ ...initWorld('devnet', core, false).world, devnetFallbackReason: 'Devnet rate limit reached (5 runs/hour) — continuing without real on-chain actions.' });
        }
        return respond(initWorld('devnet', core).world);
      }

      case 'sign-mandate': {
        requireWorld(world);
        let next = await signMandateStep(world);
        if (next.mode === 'devnet' && next.mandate) {
          const core = resolveDevnetCoreKeys();
          if (!core) {
            next = { ...next, devnetFallbackReason: 'Devnet mode is not configured on this deployment.' };
          } else if (!next.devnetAllowed) {
            next = { ...next, devnetFallbackReason: 'Devnet rate limit reached (5 runs/hour) — showing the signed mandate without an on-chain registration.' };
          } else {
            try {
              const onchain = await withTimeout(registerMandateOnchain(next.mandate, core));
              next = { ...next, mandateOnchain: onchain };
            } catch (err) {
              next = { ...next, devnetFallbackReason: `Devnet registration failed (${messageOf(err)}) — continuing with the signed mandate.` };
            }
          }
        }
        return respond(next);
      }

      case 'pay-normal': {
        requireWorld(world);
        const { world: next, outcome } = await payNormal(world, settleFor(world));
        return respond(next, outcome);
      }

      case 'attack': {
        requireWorld(world);
        const { world: next, outcome } = await attack(world);
        return respond(next, outcome);
      }

      case 'price-spike-moderate': {
        requireWorld(world);
        const { world: next, outcome } = await priceSpikeModerate(world);
        return respond(next, outcome);
      }

      case 'price-spike-severe': {
        requireWorld(world);
        const { world: next, outcome } = await priceSpikeSevere(world);
        return respond(next, outcome);
      }

      case 'human-decision': {
        requireWorld(world);
        const approve = Boolean(action.approve);
        const { world: next, outcome } = await humanDecision(world, approve, approve ? settleFor(world) : undefined);
        return respond(next, outcome);
      }

      case 'prove': {
        requireWorld(world);
        const receiptId = world.receipts[world.receipts.length - 1]?.id;
        if (!receiptId) return NextResponse.json({ error: 'No receipt to prove yet' }, { status: 400 });
        let next = world;
        let onchainAnchor: OnchainAnchor | null = null;
        if (world.mode === 'devnet' && world.devnetAllowed && world.mandate && world.mandateOnchain) {
          const core = resolveDevnetCoreKeys();
          if (core) {
            try {
              const receipt = world.receipts.find((r) => r.id === receiptId);
              if (!receipt) throw new Error('Receipt not found');
              // Must be the actual Merkle root over the leaf (merkleRoot([receiptHash])), not the raw
              // receipt hash itself — proveReceipt computes the same root independently below, and the
              // two have to match exactly for ANCHOR_ONCHAIN to verify against what's really on-chain.
              const root = merkleRoot([receipt.receiptHash]);
              onchainAnchor = await withTimeout(anchorRootOnchain(world.mandate, root, 1, core));
            } catch (err) {
              next = { ...next, devnetFallbackReason: `Devnet anchoring failed (${messageOf(err)}) — this receipt is shown with a synthetic anchor instead.` };
            }
          }
        }
        const { receipt, verification } = await proveReceipt(world, receiptId, onchainAnchor);
        next = { ...next, receipts: next.receipts.map((r) => (r.id === receipt.id ? receipt : r)) };
        let publication: StepResponse['publication'];
        if (onchainAnchor && verification.pass && storeConfigured()) {
          try {
            const result = await withTimeout(publishReceipt(receipt, { chain: onchainAnchor.chain }));
            publication = { ...result, txSignature: receipt.settlement.txSignature };
          } catch (err) {
            publication = { stored: false, reason: `Publishing failed (${messageOf(err)})`, txSignature: receipt.settlement.txSignature };
          }
        }
        return respond(next, undefined, verification, publication);
      }

      case 'revoke': {
        requireWorld(world);
        let next = revokeMandate(world, 'Playground: visitor revoked the mandate');
        if (next.mode === 'devnet' && next.mandate) {
          const core = resolveDevnetCoreKeys();
          if (!core) {
            next = { ...next, devnetFallbackReason: 'Devnet mode is not configured on this deployment.' };
          } else if (!next.devnetAllowed) {
            next = { ...next, devnetFallbackReason: 'Devnet rate limit reached (5 runs/hour) — the mandate is revoked locally but not on-chain.' };
          } else {
            try {
              const onchain = await withTimeout(revokeMandateOnchain(next.mandate, core));
              next = { ...next, revokeOnchain: onchain };
            } catch (err) {
              next = { ...next, devnetFallbackReason: `Devnet revocation failed (${messageOf(err)}) — the mandate is revoked locally.` };
            }
          }
        }
        return respond(next);
      }

      case 'pay-after-revoke': {
        requireWorld(world);
        const { world: next, outcome } = await payAfterRevoke(world);
        return respond(next, outcome);
      }

      default:
        return NextResponse.json({ error: `Unknown action ${(action as { type: string }).type}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: messageOf(err) }, { status: 400 });
  }
}

function requireWorld(world: World | null): asserts world is World {
  if (!world) throw new Error('No session — start from the beginning');
}

/** A real settlement attempt for this world, if devnet mode is on and this run hasn't hit the
 * hourly rate limit — undefined (synthetic settlement) otherwise. `evaluateAndMaybeReceipt` already
 * falls back to synthetic with a visible reason if the attempt itself throws, so this only needs to
 * decide whether to try at all. */
function settleFor(world: World): SettleFn | undefined {
  if (world.mode !== 'devnet' || !world.devnetAllowed) return undefined;
  const core = resolveDevnetCoreKeys();
  if (!core) return undefined;
  return (offer, receiptId) => withTimeout(settlePaymentOnchain(offer, core, receiptId));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function respond(
  world: World,
  payment?: StepResponse['payment'],
  verification?: StepResponse['verification'],
  publication?: StepResponse['publication'],
): NextResponse {
  const response: StepResponse = { world, payment, verification, publication };
  return NextResponse.json(response);
}
