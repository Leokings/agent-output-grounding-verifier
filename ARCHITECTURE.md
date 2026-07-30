# Architecture

## Contract boundary

The contract owns only the state transition that needs decentralized semantic
judgment:

```text
claim + public citations
        ↓
deterministic input validation
        ↓
leader classification + independent validator semantic audit
        ↓
source-grounded non-comparative equivalence validation
        ↓
deterministic aggregation
        ↓
append-only verification record
```

Calling applications own claim extraction, authentication, interfaces, indexing,
retry scheduling, and any downstream action. External publishers own the raw
documents; supplying a URL does not make that publisher authoritative.
Claim atomicity is a caller responsibility; the contract does not enforce it
deterministically.

## Deterministic layer

Ordinary contract execution handles:

- Claim and source-count limits.
- URL canonicalization, rejected query strings, and the required nonempty
  initial-host domain policy.
- Request and claim digests.
- Exact-excerpt membership checks.
- Final verdict aggregation.
- Sequential ID allocation.
- Persistent append-only records after successful execution and consensus
  acceptance.
- View methods.

There are no storage writes before nondeterministic evaluation finishes.

## Nondeterministic layer

The leader's `_evaluate_grounding` path performs the variable operations needed
to propose a result:

1. Fetch each submitted URL.
2. Classify stable versus transient retrieval failures.
3. Interpret status, media type, `Content-Range`, `Content-Length`, and
   body-length signals.
4. Normalize a bounded textual evidence window using media-aware parsing,
   preserving XML CDATA while removing non-text C0/C1 controls.
5. Mark every truncated source `TRUNCATED` and skip classification for the
   entire request if any source is truncated.
6. Otherwise ask one structured LLM call to classify complete available
   sources.
7. Parse enums defensively and require exact source excerpts.
8. Derive the final result.

The validator independently retrieves and normalizes the initial URLs, validates
the fixed leader schema and deterministic aggregation, and calls
`GROUNDING_AUDIT_V1`. That bounded audit returns booleans assessing whether the
leader's proposed relations and excerpts are semantically justified by the
validator's evidence.

The LLM does not select URLs, make additional requests, calculate IDs, change
policy, or write storage.

The contract sends a `Range` header as a best-effort request hint. The current
pinned `web.get` API exposes no streaming, response-size limit, redirect
controls, or final response URL. Contract-side byte limits are therefore
post-response processing limits, not network download caps.

The body-processing bound is 48,000 bytes. Normalized evidence is limited to
12,000 characters and 48,000 UTF-8 bytes per source. The final prompt hard bound
is 96,000 UTF-8 bytes; leader evaluation reserves 16,000 bytes of that budget for
the validator's audit prompt. A `206` response and `Content-Range` metadata are
handled conservatively. A range response is considered complete only when it
proves `bytes 0-(total-1)/total`, the body length equals `total`, and `total` is
at most 48,000 bytes. Partial, malformed, or ambiguous range information becomes
truncation rather than complete evidence. On a successful `200` or `206`, a
present `Content-Length` must be decimal and equal the returned body length;
otherwise the source is also treated as truncated.

## Per-source classifications

```text
SUPPORTS
PARTIAL
CONTRADICTS
MIXED
NO_RELEVANT_EVIDENCE
NOT_EVALUATED
```

The first five apply only when the request has no truncation and the individual
source is readable and complete. `NOT_EVALUATED` applies to unavailable sources.
If any source is truncated, every source relation is `NOT_EVALUATED`; truncated
sources retain fetch status `TRUNCATED`, while complete peers retain their own
fetch status. No content from that request is sent to semantic classification.

## Deterministic aggregation

Aggregation is intentionally conservative:

| Source relationship set | Final verdict |
| --- | --- |
| Every source stably unavailable | `SOURCE_UNAVAILABLE` |
| Any truncated evidence window | `INSUFFICIENT_EVIDENCE` with `SOURCE_CONTENT_LIMIT_REACHED` |
| Any `MIXED` | `INSUFFICIENT_EVIDENCE` |
| Support/partial plus contradiction | `INSUFFICIENT_EVIDENCE` |
| Contradiction only | `CONTRADICTED` |
| At least one full support, no contradiction | `SUPPORTED` |
| Partial support only | `PARTIALLY_SUPPORTED` |
| No relevant evidence | `INSUFFICIENT_EVIDENCE` |

Unavailable or irrelevant additional sources do not erase a direct supporting
source. Conflicting evidence always prevents a supported verdict.

## Equivalence principle

The contract uses `gl.vm.run_nondet_unsafe` with a custom validator.

The leader proposes:

```json
{
  "verdict": "SUPPORTED",
  "reason_code": "CITED_EVIDENCE_ENTAILS_CLAIM",
  "sources": [
    {
      "index": 0,
      "fetch_status": "AVAILABLE",
      "relation": "SUPPORTS",
      "evidence_excerpt": "Exact source text",
      "counter_excerpt": "",
      "content_truncated": false
    }
  ]
}
```

Each participating validator independently retrieves and normalizes the same
initial URLs. It rejects the leader result unless:

- The result has one correctly ordered item per submitted URL.
- Top-level and per-source key sets match the fixed schema exactly.
- Every enum and excerpt shape is valid.
- Every leader excerpt appears in the validator's independently fetched text.
- The final verdict and reason are deterministically derivable.
- Fetch and truncation states are compatible with the validator's independent
  retrieval.
- `GROUNDING_AUDIT_V1` returns the fixed boolean schema and affirms that each
  proposed relation and excerpt is semantically justified by the independently
  retrieved evidence.

The audit schema is deliberately smaller than the leader result:

```json
{"sources":[{"index":0,"accept":true}]}
```

It must contain exactly one strict boolean decision for every available source.
Any `false`, missing/duplicate index, extra field, or malformed value makes that
validator disagree.

Validators audit the leader's exact excerpts in context; they do not generate a
second candidate result or require identical excerpt selection. This avoids
turning harmless quote-selection variance into automatic disagreement while
still requiring a source-grounded semantic check. Network acceptance requires a
majority of the participating validator set, not unanimity across all network
validators.

Reasoning prose is intentionally absent from storage. It would create consensus
variance and could be mistaken for an authoritative explanation.
After consensus, deterministic code reconstructs the fixed source-result shape
before serializing it to storage.

## Error model

| Prefix or result | Meaning | Effect |
| --- | --- | --- |
| `[EXPECTED]` | Invalid deterministic caller input | Revert before nondeterministic execution |
| `[TRANSIENT]` | Rate limit, timeout-like status, or server failure | Successful matching error consensus still has no record; retry later |
| `[LLM_ERROR]` | Malformed classification/audit, invalid enum, missing source, or fabricated excerpt | Reject/rotate; no durable record |
| `SOURCE_UNAVAILABLE` | Every source had a stable unusable response | Durable bounded verdict |

## State layout

```text
allowed_domains_json: str
next_verification_id: u256
verifications: TreeMap[u256, Verification]
```

Each `Verification` stores:

```text
verification_id
submitter
claim
claim_digest
sources_json
request_digest
source_count
verdict
reason_code
source_results_json
policy_version
scope
transaction_timestamp
```

The contract exposes no record update/delete method and no policy mutator. A
record exists only when execution finishes successfully. An accepted record is
still provisional and appealable at the protocol level; only finalized state is
permanent.

## Request identity

The request digest is Keccak-256 over a length-prefixed encoding of:

```text
policy_version || trimmed_claim || canonical_sources_json
```

The digest identifies an input request. It does not identify the retrieved page
version and is not an evidence archive.

## Integration model

A consuming application should:

1. Extract atomic factual claims off-chain.
2. Submit each claim with its citations and retain the transaction hash.
3. Wait for `ACCEPTED` or `FINALIZED`, as appropriate.
4. Confirm `FINISHED_WITH_RETURN`; status alone does not prove that execution
   succeeded.
5. Decode the `u256` verification ID from the receipt or execution trace.
6. Read the record from the matching accepted/finalized state variant.
7. Act only on the stable verdict and reason code.

External SDK writes return a transaction hash, not the verification ID
synchronously. IC-to-IC writes are also asynchronous, so a calling IC cannot
consume the return value directly. Shared-service use needs off-chain
receipt/indexing correlation, or a fork that accepts a caller reference and
emits an idempotent `on="finalized"` callback. An accepted callback can be
repeated or become inconsistent with the eventual final state.
