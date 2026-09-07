import { z } from 'zod';

export * from './queues';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('debug'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),

  API_PORT: z.coerce.number().default(3001),
  WEB_PORT: z.coerce.number().default(3000),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3001'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  ENCRYPTION_KEY_BASE64: z.string().min(16),

  SOLANA_CLUSTER: z.enum(['devnet']).default('devnet'),
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_USDC_MINT: z.string().min(32),
  SOLANA_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
  SOLANA_EXPLORER_CLUSTER: z.string().default('devnet'),

  ATLAS_ALLOW_MOCK_SIGNER: z.coerce.boolean().default(true),
  ATLAS_EXTERNAL_SIGNER_ENABLED: z.coerce.boolean().default(false),
  ATLAS_MAINNET_ENABLED: z.boolean().refine((val) => val === false, {
    message: 'CRITICAL SAFETY ERROR: ATLAS_MAINNET_ENABLED must remain false in v1.',
  }),

  WEBHOOK_ALLOW_PRIVATE_NETWORKS: z.coerce.boolean().default(true),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().default(6),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().default(10000),

  RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().default(5),
  RATE_LIMIT_API_PER_MINUTE: z.coerce.number().default(120),
  RATE_LIMIT_PAYOUT_CREATE_PER_MINUTE: z.coerce.number().default(20),

  SEED_DEMO_DATA: z.coerce.boolean().default(true),
  DEMO_ADMIN_EMAIL: z.string().email().default('admin@atlasrail.local'),
  DEMO_ADMIN_PASSWORD: z.string().default('ChangeMe_AtlasRail_DevOnly'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown> = process.env): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Environment validation failed:\n${JSON.stringify(formatted, null, 2)}`);
  }

  const parsed = result.data;

  // Startup safety assertions
  if (parsed.NODE_ENV === 'production' && parsed.ATLAS_ALLOW_MOCK_SIGNER) {
    throw new Error('CRITICAL SAFETY FATAL: Mock signer adapter cannot be enabled in production!');
  }

  if (parsed.SOLANA_RPC_URL.includes('mainnet')) {
    throw new Error('CRITICAL SAFETY FATAL: SOLANA_RPC_URL points to mainnet, which is strictly prohibited in v1!');
  }

  return parsed;
}

export const DEVNET_WARNING_BANNER = 'DEVNET ONLY — Simulation environment. Do not use real funds.';

export const ALLOWED_SOLANA_PROGRAM_IDS = {
  SYSTEM_PROGRAM: '11111111111111111111111111111111',
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ASSOCIATED_TOKEN_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  COMPUTE_BUDGET_PROGRAM: 'ComputeBudget111111111111111111111111111111',
  MEMO_PROGRAM: 'MemoSsq6gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcY',
} as const;

export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  BAD_REQUEST = 'BAD_REQUEST',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  POLICY_VIOLATION = 'POLICY_VIOLATION',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  SOLANA_SIMULATION_FAILED = 'SOLANA_SIMULATION_FAILED',
  TREASURY_FROZEN = 'TREASURY_FROZEN',
  RECIPIENT_NOT_VERIFIED = 'RECIPIENT_NOT_VERIFIED',
  MAINNET_PROHIBITED = 'MAINNET_PROHIBITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
