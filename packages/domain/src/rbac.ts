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
  | 'webhook:manage';

export const ROLE_PERMISSIONS: Record<UserRole, PermissionAction[]> = {
  OWNER: [
    'organization:read', 'organization:write',
    'treasury:read', 'treasury:write', 'treasury:freeze',
    'recipient:read', 'recipient:write', 'recipient:verify', 'recipient:block',
    'policy:read', 'policy:write', 'policy:activate',
    'payout:read', 'payout:create', 'payout:approve', 'payout:reject', 'payout:cancel', 'payout:execute',
    'ledger:read', 'reconciliation:export',
    'apikey:manage', 'webhook:manage'
  ],
  ADMIN: [
    'organization:read',
    'treasury:read', 'treasury:write', 'treasury:freeze',
    'recipient:read', 'recipient:write', 'recipient:verify', 'recipient:block',
    'policy:read', 'policy:write', 'policy:activate',
    'payout:read', 'payout:create', 'payout:approve', 'payout:reject', 'payout:cancel', 'payout:execute',
    'ledger:read', 'reconciliation:export',
    'apikey:manage', 'webhook:manage'
  ],
  OPERATOR: [
    'organization:read',
    'treasury:read',
    'recipient:read', 'recipient:write',
    'policy:read',
    'payout:read', 'payout:create', 'payout:cancel',
    'ledger:read', 'reconciliation:export'
  ],
  APPROVER: [
    'organization:read',
    'treasury:read',
    'recipient:read',
    'policy:read',
    'payout:read', 'payout:approve', 'payout:reject',
    'ledger:read'
  ],
  AUDITOR: [
    'organization:read',
    'treasury:read',
    'recipient:read',
    'policy:read',
    'payout:read',
    'ledger:read', 'reconciliation:export'
  ],
  DEVELOPER: [
    'organization:read',
    'treasury:read',
    'recipient:read',
    'policy:read',
    'payout:read',
    'apikey:manage', 'webhook:manage'
  ]
};

export function hasPermission(role: UserRole, action: PermissionAction): boolean {
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes(action);
}
