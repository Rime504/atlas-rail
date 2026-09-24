import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildJsonSchema } from '../src/json-schema';

const target = join(__dirname, '..', 'schema', 'agent-mandate-v0.1.schema.json');
writeFileSync(target, `${JSON.stringify(buildJsonSchema(), null, 2)}\n`);
console.log(`Wrote ${target}`);
