# Policy Language Specification

Atlas Rail spend policies are defined as JSON structures validated against a Zod schema (`policyRulesSchema`).

```json
{
  "version": 1,
  "approval": {
    "requiredApprovals": 2,
    "eligibleRoles": ["OWNER", "ADMIN", "APPROVER"],
    "preventCreatorApproval": true
  },
  "limits": {
    "maxSinglePayoutBaseUnits": "5000000000",
    "dailyLimitBaseUnits": "25000000000",
    "monthlyLimitBaseUnits": "100000000000"
  },
  "recipients": {
    "requireVerifiedRecipient": true,
    "allowedRecipientIds": [],
    "blockedRecipientIds": []
  },
  "assets": {
    "allowedMintAddresses": ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"]
  },
  "transaction": {
    "requireSuccessfulSimulation": true,
    "blockUnknownProgramIds": true,
    "allowProgramIds": [
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "ComputeBudget111111111111111111111111111111",
      "MemoSsq6gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcY"
    ],
    "blockMemoRequired": false,
    "minimumConfirmations": "confirmed"
  },
  "risk": {
    "blockHighRiskRecipients": true,
    "manualReviewAboveRiskLevel": "HIGH"
  }
}
```
