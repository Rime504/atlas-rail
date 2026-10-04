import { NextRequest, NextResponse } from 'next/server';
import { attack, humanDecision, initWorld, payAfterRevoke, payNormal, priceSpikeModerate, priceSpikeSevere, proveReceipt, revokeMandate, signMandateStep } from '@/lib/scenario';
import { rateLimited, registerMandateOnchain, resolveDevnetCoreKeys, revokeMandateOnchain, withTimeout } from '@/lib/devnet';
import { StepRequest, StepResponse, World } from '@/lib/types';

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

  const { world, action } = body;

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
        return respond(initWorld('devnet', core).world);
      }

      case 'sign-mandate': {
        requireWorld(world);
        let next = await signMandateStep(world);
        if (next.mode === 'devnet' && next.mandate) {
          const core = resolveDevnetCoreKeys();
          const ip = clientIp(req);
          if (!core) {
            next = { ...next, devnetFallbackReason: 'Devnet mode is not configured on this deployment.' };
          } else if (rateLimited(ip)) {
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
        const { world: next, outcome } = await payNormal(world);
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
        const { world: next, outcome } = await humanDecision(world, Boolean(action.approve));
        return respond(next, outcome);
      }

      case 'prove': {
        requireWorld(world);
        const receiptId = world.receipts[world.receipts.length - 1]?.id;
        if (!receiptId) return NextResponse.json({ error: 'No receipt to prove yet' }, { status: 400 });
        const { receipt, verification } = await proveReceipt(world, receiptId);
        const next: World = { ...world, receipts: world.receipts.map((r) => (r.id === receipt.id ? receipt : r)) };
        return respond(next, undefined, verification);
      }

      case 'revoke': {
        requireWorld(world);
        let next = revokeMandate(world, 'Playground: visitor revoked the mandate');
        if (next.mode === 'devnet' && next.mandate) {
          const core = resolveDevnetCoreKeys();
          const ip = clientIp(req);
          if (!core) {
            next = { ...next, devnetFallbackReason: 'Devnet mode is not configured on this deployment.' };
          } else if (rateLimited(ip)) {
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function respond(world: World, payment?: StepResponse['payment'], verification?: StepResponse['verification']): NextResponse {
  const response: StepResponse = { world, payment, verification };
  return NextResponse.json(response);
}
