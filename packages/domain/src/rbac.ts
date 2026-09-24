export type UserRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'APPROVER' | 'AUDITOR' | 'DEVELOPER';

export type PermissionAction =
  | 'organization:read'
  | 'organization:write'
  | 'treasury:read'
  | 'treasury:write'
  | 'treasury:freeze'
  | 'recipient:read'
  | 'recipient:write'
  | 'recipient:verify'
  | 'recipient:block'
  | 'policy:read'
  | 'policy:write'
  | 'policy:activate'
  | 'payout:read'
  | 'payout:create'
  | 'payout:approve'
  | 'payout:reject'
  | 'payout:cancel'
  | 'payout:execute'
  | 'ledger:read'
  | 'reconciliation:export'
  | 'apikey:manage'
  | 'webhook:manage'
  | 'mandate:read'
  | 'mandate:create'
  | 'mandate:sign'
  | 'mandate:revoke'
  | 'approval:read'
  | 'approval:decide'
  | 'agent:gate'
  | 'receipt:read'
  | 'receipt:anchor';

export const ROLE_PERMISSIONS: Record<UserRole, PermissionAction[]> = {
  OWNER: [
    'organization:read', 'organization:write',
    'treasury:read', 'treasury:write', 'treasury:freeze',
    'recipient:read', 'recipient:write', 'recipient:verify', 'recipient:block',
    'policy:read', 'policy:write', 'policy:activate',
    'payout:read', 'payout:create', 'payout:approve', 'payout:reject', 'payout:cancel', 'payout:execute',
    'ledger:read', 'reconciliation:export',
    'apikey:manage', 'webhook:manage',
    'mandate:read', 'mandate:create', 'mandate:sign', 'mandate:revoke', 'approval:read', 'approval:decide', 'agent:gate', 'receipt:read', 'receipt:anchor'
  ],
  ADMIN: [
    'organization:read',
    'treasury:read', 'treasury:write', 'treasury:freeze',
    'recipient:read', 'recipient:write', 'recipient:verify', 'recipient:block',
    'policy:read', 'policy:write', 'policy:activate',
    'payout:read', 'payout:create', 'payout:approve', 'payout:reject', 'payout:cancel', 'payout:execute',
    'ledger:read', 'reconciliation:export',
    'apikey:manage', 'webhook:manage',
    'mandate:read', 'mandate:create', 'mandate:sign', 'mandate:revoke', 'approval:read', 'approval:decide', 'agent:gate', 'receipt:read', 'receipt:anchor'
  ],
  OPERATOR: [
    'organization:read',
    'treasury:read',
    'recipient:read', 'recipient:write',
    'policy:read',
    'payout:read', 'payout:create', 'payout:cancel',
    'ledger:read', 'reconciliation:export',
    'mandate:read', 'mandate:create', 'approval:read', 'receipt:read'
  ],
  APPROVER: [
    'organization:read',
    'treasury:read',
    'recipient:read',
    'policy:read',
    'payout:read', 'payout:approve', 'payout:reject',
    'ledger:read',
    'mandate:read', 'mandate:sign', 'approval:read', 'approval:decide', 'receipt:read'
  ],
  AUDITOR: [
    'organization:read',
    'treasury:read',
    'recipient:read',
    'policy:read',
    'payout:read',
    'ledger:read', 'reconciliation:export',
    'mandate:read', 'approval:read', 'receipt:read'
  ],
  DEVELOPER: [
    'organization:read',
    'treasury:read',
    'recipient:read',
    'policy:read',
    'payout:read',
    'apikey:manage', 'webhook:manage',
    'mandate:read', 'agent:gate', 'receipt:read'
  ]
};

export function hasPermission(role: UserRole, action: PermissionAction): boolean {
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes(action);
}
