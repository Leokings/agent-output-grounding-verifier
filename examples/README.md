# Example calls

## Deployment

Constructor input:

```json
"[\"docs.example.com\",\"status.example.com\"]"
```

The allowlist must contain at least one hostname. There is no unrestricted
deployment mode. Use the smallest practical set of domains and redeploy to
change it.

Accepted source hostnames include:

```text
docs.example.com
api.docs.example.com
status.example.com
```

Rejected lookalikes include:

```text
docs.example.com.evil.org
example.com
localhost
127.0.0.1
docs.example.com:8443
docs.example.com/fees?token=secret
```

The contract validates the initial request URL and rejects query strings. The
current GenLayer web-response API does not expose the final URL after redirects,
so the contract cannot prove that a permitted host did not redirect elsewhere.
Use allowlisted publishers and endpoints whose redirect behavior you trust.

## Verification call

```json
{
  "claim": "The protocol charges a 0.3% transaction fee.",
  "source_urls_json": "[\"https://docs.example.com/fees\"]"
}
```

An external SDK write returns a transaction hash, not the verification ID
directly. Wait for the required status, verify that execution finished with a
return value, and decode the method's `u256` return from the receipt or execution
trace. For irreversible actions, wait for `FINALIZED` and read finalized state.

## Multi-source verification

```json
{
  "claim": "Version 2.0 was released on 30 July 2026.",
  "source_urls_json": "[\"https://docs.example.com/releases\",\"https://status.example.com/changelog\"]"
}
```

The contract evaluates each URL separately and then derives one final verdict.
Support plus contradiction becomes `INSUFFICIENT_EVIDENCE` rather than allowing
the leader to choose whichever source it prefers.

## Intelligent Contract callers

IC-to-IC write messages are asynchronous, so a calling Intelligent Contract
cannot synchronously receive `verify_claim()`'s return value. A shared-service
integration needs off-chain receipt/indexing correlation, or a fork that stores
a caller reference and emits an idempotent callback on `finalized`.
