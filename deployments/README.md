# Deployment records

There is no canonical public deployment recorded yet.

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
- Final transaction status and successful execution result.

The bundled deployment script can write its machine-readable result to an
ignored file by setting:

```powershell
$env:GROUNDING_DEPLOYMENT_OUTPUT='artifacts/bradbury-deployment.json'
genlayer.cmd deploy
```

The script only writes `.json` files under `artifacts/` or `deployments/` and
uses exclusive creation, so it never overwrites an existing record.

After independently checking the receipt, source code, schema, and finalized
state, copy the non-secret fields into a versioned JSON file in this directory.
