import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildJsonSchema } from './json-schema';

describe('published JSON Schema', () => {
  it('matches the committed schema/agent-mandate-v0.1.schema.json (run `pnpm --filter @atlas-rail/mandate schema:generate` if this fails)', () => {
    const committed = JSON.parse(readFileSync(join(__dirname, '..', 'schema', 'agent-mandate-v0.1.schema.json'), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildJsonSchema())));
  });

  it('describes the required top-level members', () => {
    const schema = buildJsonSchema() as { definitions: { AgentMandate: { required: string[] } } };
    expect(schema.definitions.AgentMandate.required).toEqual(
      expect.arrayContaining(['type', 'version', 'id', 'issuer', 'agent', 'scope', 'escalation', 'notBefore', 'expiresAt', 'nonce', 'delegationChain']),
    );
  });
});
