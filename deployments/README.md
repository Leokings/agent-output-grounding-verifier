# Deployment records

## Current Bradbury testnet deployment

The current public testnet record is
[`bradbury-2026-07-30.json`](bradbury-2026-07-30.json).

At publication time, both the deployment and smoke-test transactions were
`ACCEPTED` by GenLayer consensus and still inside their appeal windows. The
record is therefore explicitly marked `"provisional": true`. Re-check both
GenLayer transaction statuses before relying on the deployment as finalized,
then publish a new record or an auditable status update.

Do not trust an address merely because it is mentioned in an issue, pull
request, or third-party interface. A release deployment record should include:

- Network name, chain ID, and exact RPC URL.
- Contract address.
- Deployment transaction hash.
- Verification smoke-test transaction hash.
- Clean-tree `source_commit` (not merely `git_commit` when `git_dirty` is true).
- SHA-256 of the exact deployed contract source.
- Contract and policy versions.
- Exact domain allowlist.
- Explorer links.
- Transaction status, successful execution result, and whether finality has
  actually been reached.

The bundled deployment script can write its machine-readable result to an
ignored file by setting:

```powershell
$env:GROUNDING_DEPLOYMENT_OUTPUT='artifacts/bradbury-deployment.json'
genlayer.cmd deploy
```

The script only writes `.json` files under `artifacts/` or `deployments/` and
uses exclusive creation, so it never overwrites an existing record.

After independently checking the receipt, source code, schema, and on-chain
state, copy the non-secret fields into a versioned JSON file in this directory.
Do not label an accepted transaction as finalized until its appeal window has
elapsed and the network reports the final status.
