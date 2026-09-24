import { zodToJsonSchema } from 'zod-to-json-schema';
import { agentMandateSchema } from './schema';

// zod-to-json-schema's generic signature makes TypeScript instantiate the whole (large) mandate
// schema type; a structural signature keeps the compiler fast and the output identical.
const convert = zodToJsonSchema as unknown as (
  schema: unknown,
  options: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * The published JSON Schema for AgentMandate v0.1, generated from the same zod definition the
 * runtime validates with so the two cannot drift. Cross-field rules (limits vs. ceiling, expiry after
 * notBefore, limits.mint in allowedAssets, resource pattern grammar, signature validity) cannot be
 * expressed in JSON Schema and are normatively specified in spec/agent-mandate-v0.1.md.
 */
export function buildJsonSchema(): Record<string, unknown> {
  const schema = convert(agentMandateSchema, {
    name: 'AgentMandate',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });
  return {
    ...schema,
    $id: 'https://atlasrail.dev/schema/agent-mandate-v0.1.schema.json',
    title: 'Atlas Rail Agent Mandate v0.1',
  };
}
