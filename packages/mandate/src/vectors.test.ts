/**
 * Conformance vectors for spec/agent-mandate-v0.1.md. The file is generated from this implementation
 * (`UPDATE_VECTORS=1 pnpm vitest run packages/mandate/src/vectors.test.ts`) and, in every normal run,
 * checked byte-for-byte so the spec's numbers can never drift from the code. Keys are seeded test keys
 * with no value; never use them elsewhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './jcs';
import { GateContext, evaluateGate } from './gate';
import { hashMandate, linkHash, verifyMandateChain } from './mandate';
import { hashOffer } from './offer';
import { matchesAnyResourcePattern } from './resource';
import { signers, signedTestMandate, testApproval, testContext, testOffer, unsignedTestMandate, NOW, TEST_ORIGIN } from './testing';
import { X402Offer } from './offer';

const FILE = path.resolve(__dirname, '../../../spec/test-vectors/agent-mandate-v0.1.json');

// Built from char codes: U+20AC (euro sign) and U+000D (carriage return) sort by UTF-16 code unit under RFC 8785.
const unicodeKeys: Record<string, string> = {
  [String.fromCharCode(0x20ac)]: 'euro',
  [String.fromCharCode(0x0d)]: 'cr',
  '1': 'one',
};

async function build() {
  const unsigned = unsignedTestMandate();
  const signed = await signedTestMandate();
  const mandateHash = hashMandate(signed);
  const { delegationChain: _chain, ...body } = signed;
  void _chain;

  let previous: string | null = null;
  const links = signed.delegationChain.map((link, index) => {
    const hash = linkHash(mandateHash, index, link.role, link.publicKey, previous);
    previous = link.signature;
    return { index, role: link.role, publicKey: link.publicKey, linkHash: hash, signature: link.signature };
  });

  const gateCase = (name: string, offer: X402Offer, context: GateContext) => {
    const result = evaluateGate(signed, offer, context);
    return {
      name,
      offer,
      offerHash: hashOffer(offer),
      context,
      expected: {
        decision: result.decision,
        kind: result.kind,
        failedRule: result.failedRule,
        escalationRules: result.escalationRules,
        rules: result.rulesEvaluated.map((r) => `${r.id}:${r.status}`),
      },
    };
  };

  const heavy = testOffer({ resourceUrl: `${TEST_ORIGIN}/inference/heavy`, amount: '40000000' });
  const mid = testOffer({ amount: '2000000' });

  // Rule 15 (price limits): expected 1,000,000 · 10% tolerance -> ceiling 1,100,000 · hard max 2,000,000.
  // expectedPriceBaseUnits is fixed at signing time and never updated from past payments -- see the
  // "price creep" case below, which is the attack this rule exists to stop.
  const priceLimits = [
    { resource: `${TEST_ORIGIN}/research/*`, expectedPriceBaseUnits: '1000000', tolerancePct: 10, hardMaxBaseUnits: '2000000' },
  ];
  // threshold == maxPerPayment so ESCALATION_THRESHOLD never fires here; every result below comes
  // from PRICE_LIMIT alone.
  const pricedMandate = await signedTestMandate({ priceLimits, threshold: '50000000' });
  const pricedGateCase = (name: string, offer: X402Offer, context: GateContext) => {
    const result = evaluateGate(pricedMandate, offer, context);
    return {
      name,
      offer,
      offerHash: hashOffer(offer),
      context,
      expected: {
        decision: result.decision,
        kind: result.kind,
        failedRule: result.failedRule,
        escalationRules: result.escalationRules,
        rules: result.rulesEvaluated.map((r) => `${r.id}:${r.status}`),
      },
    };
  };

  const resourceCases: Array<[string, string[], string]> = [
    ['http://localhost:4402/research/summary', ['http://localhost:4402/research/*'], 'trailing /* is a prefix match on a segment boundary'],
    ['http://localhost:4402/research/a/b', ['http://localhost:4402/research/*'], 'deeper paths under the prefix match'],
    ['http://localhost:4402/researcher/summary', ['http://localhost:4402/research/*'], 'prefix must end on a path-segment boundary'],
    ['http://localhost:4402/research/../inference/heavy', ['http://localhost:4402/research/*'], 'dot-segments are resolved before matching'],
    ['http://localhost:4402/research/%2e%2e/inference/heavy', ['http://localhost:4402/research/*'], 'percent-encoded dot-segments too'],
    ['http://localhost:4402@evil.example/research/summary', ['http://localhost:4402/research/*'], 'userinfo cannot spoof the origin'],
  ];

  return {
    spec: 'atlasrail/agent-mandate/v0.1',
    note: 'Seeded test keys. Signatures are deterministic Ed25519. now = 1800000000.',
    keys: Object.fromEntries(Object.entries(signers).map(([name, s]) => [name, s.publicKey])),
    jcs: [
      { input: { b: 1, a: [true, null, 'x'] }, canonical: canonicalize({ b: 1, a: [true, null, 'x'] }) },
      { input: unicodeKeys, canonical: canonicalize(unicodeKeys) },
    ],
    mandate: {
      unsignedCanonicalBody: canonicalize(body as never),
      mandateHash,
      unsignedMandateHash: hashMandate(unsigned),
      links,
      signed,
      verification: verifyMandateChain(signed),
    },
    pricedMandate: { priceLimits, signed: pricedMandate },
    resources: resourceCases.map(([url, patterns, why]) => ({ url, patterns, why, matches: matchesAnyResourcePattern(url, patterns) })),
    gate: [
      gateCase('autonomous allow', testOffer(), testContext()),
      gateCase('escalate above threshold', mid, testContext()),
      gateCase('escalate then human approval releases it', mid, testContext({ approval: testApproval(mid) })),
      gateCase('deny: resource outside scope', testOffer({ resourceUrl: 'http://127.0.0.1:59725/invoice', amount: '500000000' }), testContext()),
      gateCase('deny: recipient not allowed', testOffer({ payTo: signers.attacker.publicKey }), testContext()),
      gateCase('deny: hard per-payment ceiling', testOffer({ amount: '60000000' }), testContext()),
      gateCase('deny: revoked', testOffer(), testContext({ revoked: { revokedAt: NOW - 10, reason: 'compromised' } })),
      gateCase('escalate: inference endpoint always needs a human', heavy, testContext()),
      pricedGateCase('price limit: at the expected price allows', testOffer({ amount: '1000000' }), testContext()),
      pricedGateCase('price limit: within the 10% tolerance still allows', testOffer({ amount: '1050000' }), testContext()),
      pricedGateCase('price limit: above tolerance escalates to a human', testOffer({ amount: '1500000' }), testContext()),
      pricedGateCase(
        'price limit: above tolerance, human approval releases it',
        testOffer({ amount: '1500000' }),
        testContext({ approval: testApproval(testOffer({ amount: '1500000' })) }),
      ),
      pricedGateCase('price limit: above the hard max denies, no approval can release it', testOffer({ amount: '2500000' }), testContext()),
      pricedGateCase(
        'price creep attack: five rising-but-individually-small payments are each checked against the one fixed expected price, not the last payment',
        testOffer({ amount: '1095000' }),
        testContext(),
      ),
    ],
  };
}

describe('spec/agent-mandate-v0.1 test vectors', () => {
  it('match the implementation exactly', async () => {
    const generated = JSON.stringify(await build(), null, 2) + '\n';
    if (process.env.UPDATE_VECTORS === '1') {
      mkdirSync(path.dirname(FILE), { recursive: true });
      writeFileSync(FILE, generated);
    }
    expect(existsSync(FILE)).toBe(true);
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(generated);
  });

  it('are self-consistent: the signed mandate verifies and every gate vector replays', async () => {
    const vectors = await build();
    expect(vectors.mandate.verification.valid).toBe(true);
    expect(vectors.gate.map((g) => g.expected.decision)).toEqual([
      'ALLOW',
      'ESCALATE',
      'ALLOW',
      'DENY',
      'DENY',
      'DENY',
      'DENY',
      'ESCALATE',
      'ALLOW',
      'ALLOW',
      'ESCALATE',
      'ALLOW',
      'DENY',
      'ALLOW',
    ]);
    expect(vectors.resources.map((r) => r.matches)).toEqual([true, true, false, false, false, false]);
  });
});
