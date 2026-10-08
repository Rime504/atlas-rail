# Live playground, devnet mode: publish → /verify → PROVEN (2026-10-08)

Three full runs of https://atlas-rail-playground.vercel.app/demo with "Use real Solana devnet" on (phone viewport, Playwright), against the production deployment using a dedicated devnet RPC. Each run: register the mandate on-chain, pay, block the attack, escalate the price spike and approve it, verify the receipt (anchored on-chain), publish it to the public store, then open "Verify this payment from the chain".

Every transaction below was re-read independently from the public devnet RPC (`getTransaction`, finalized, `err: null`); each payment's memo names the receipt the store returns for it.

| Run | Payment (memo) | Anchor (`anchor_root`) | /verify |
|---|---|---|---|
| 1 | [2d6vgssg…](https://explorer.solana.com/tx/2d6vgssgmvkY8BHaaU9dSFYp5a2ypqyEz1HoiJXL5g8F99u6JjV8PkLa3GBKdmXDET87peAueGVS4RfAdwHjh2xM?cluster=devnet) `rcp_56ddd76302eb6c08b3d4703869618bf3` | [2Mm61SEs…](https://explorer.solana.com/tx/2Mm61SEsjV1EUvvHMC16LWJXJ2fiBFfU8tyQweUp6TSCkDp7ix5e9dfNSzkSugfUJyEdqjazS7bq3oZKEQNN6cjf?cluster=devnet) | [PROVEN](https://atlas-rail-playground.vercel.app/verify?tx=2d6vgssgmvkY8BHaaU9dSFYp5a2ypqyEz1HoiJXL5g8F99u6JjV8PkLa3GBKdmXDET87peAueGVS4RfAdwHjh2xM) |
| 2 | [5XvRFdHG…](https://explorer.solana.com/tx/5XvRFdHG7wZFScqV64acyhpcPHBeGLmVyCoeWSMJu9LeRPLW3NHXXBWohAwRkhJizM3am2SLCPAuGskruDG9nrhd?cluster=devnet) `rcp_3dc54c398f8bd97de8583f7331d0a356` | [ULmpLq8Y…](https://explorer.solana.com/tx/ULmpLq8YFz19hAPjbYSXWVksvtHyGqPm5sjNPWFMuwL43PBL5fZC1pF4YfNQWjAi9eiRaA1FXQUuEGxrf9Txd4F?cluster=devnet) | [PROVEN](https://atlas-rail-playground.vercel.app/verify?tx=5XvRFdHG7wZFScqV64acyhpcPHBeGLmVyCoeWSMJu9LeRPLW3NHXXBWohAwRkhJizM3am2SLCPAuGskruDG9nrhd) |
| 3 | [UW3cfBJs…](https://explorer.solana.com/tx/UW3cfBJsDSL12yJAPJ95thMQejLkC7bfjWbsfNHFaUom3JkWKLKpbDFJmaGky56sUBsrHn26re2dagcuQg7y4sF?cluster=devnet) `rcp_61cd6d5de8f72cf517b9aaa7b4668885` | [4SePbE8n…](https://explorer.solana.com/tx/4SePbE8nZt9a4FFQSxKPJxYiGxcwYna8mWc9uU6DzxAgUbtepNU4EaXTnAgMrdNZCYtLGY3EifngW3WBdZWXmVmz?cluster=devnet) | [PROVEN](https://atlas-rail-playground.vercel.app/verify?tx=UW3cfBJsDSL12yJAPJ95thMQejLkC7bfjWbsfNHFaUom3JkWKLKpbDFJmaGky56sUBsrHn26re2dagcuQg7y4sF) |

Payments: $0.02 devnet test token each (the approved price spike), fee 10,001 lamports. Anchors: fee 5,000 lamports.

Note: before this run the RPC variable briefly held a mainnet endpoint; the mainnet guard refused every call (nothing signed, nothing sent) until it was replaced with the devnet endpoint.
