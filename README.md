# Agent Output Grounding Verifier

[![CI](https://github.com/Leokings/agent-output-grounding-verifier/actions/workflows/ci.yml/badge.svg)](https://github.com/Leokings/agent-output-grounding-verifier/actions/workflows/ci.yml)

A standalone GenLayer Intelligent Contract that verifies whether cited public
sources support one caller-supplied factual claim made by an AI agent. Callers
are responsible for splitting compound outputs into atomic claims.

The contract answers a deliberately narrow question:

> What relationship does the cited material, as retrieved during consensus,
> have to this claim?

It does **not** certify that the claim is universally true or that the publisher
is trustworthy. Its stored scope is always `CITATION_GROUNDING_ONLY`.

## Why this belongs on GenLayer

Citation grounding is semantic: wording may differ while meaning stays the same,
and a material date, quantity, unit, or scope qualifier can change the result.
A conventional deterministic contract cannot reliably classify those
relationships.

This contract gives GenLayer one bounded judgment to make:

1. Fetch one to three caller-supplied public sources.
2. Classify each source against one claim.
3. Require exact excerpts for support or contradiction.
4. Derive the final verdict with deterministic code.
5. Have participating validators independently retrieve the evidence and
   semantically audit the leader's relations and excerpts. A record becomes
   visible only if the transaction executes successfully and a validator
   majority accepts it. Accepted state remains provisional until finality.

It contains no frontend, payment logic, callback router, mutable prompt, owner,
or privileged override.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `SUPPORTED` | At least one source supports every material part of the claim, with no material conflict. |
| `PARTIALLY_SUPPORTED` | Evidence supports part of the claim but omits or weakens a material part or qualifier. |
| `CONTRADICTED` | Available evidence directly conflicts with the claim and no supplied source supports it. |
| `INSUFFICIENT_EVIDENCE` | Evidence is irrelevant, truncated before a conclusion, internally mixed, or conflicting across sources. |
| `SOURCE_UNAVAILABLE` | Every submitted source had a stable unavailable response; no source was merely truncated. |

Each available source is classified as `SUPPORTS`, `PARTIAL`, `CONTRADICTS`,
`MIXED`, or `NO_RELEVANT_EVIDENCE`. Unavailable sources are marked
`NOT_EVALUATED`. Any source with a truncation signal uses fetch status
`TRUNCATED`. For safety, one truncated source skips semantic classification for
the entire request: all source relations are then `NOT_EVALUATED`, including
otherwise complete sources.

## Quick start

Requirements:

- Python 3.12 or newer
- Node.js 18 or newer for the deployment helper
- `genlayer-test==0.29.2`
- `genvm-linter==0.11.0`

```powershell
python -m pip install -r requirements.txt
genvm-lint check contracts\AgentOutputGroundingVerifier.py --json
genvm-lint typecheck contracts\AgentOutputGroundingVerifier.py --json
python -m pytest tests\direct -v -p no:cacheprovider
npm run test:deploy
```

The contract pins this deployable GenVM runner on its first line:

```text
py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6
```

## Deployment

Deploy `contracts/AgentOutputGroundingVerifier.py` with one constructor
argument containing at least one permitted hostname:

```json
"[\"docs.example.com\",\"status.example.com\"]"
```

An allowlisted hostname also permits its subdomains. The contract exposes no
unrestricted deployment mode and no policy mutator. After the deployment
transaction finalizes, fork or redeploy the contract to change its
configuration.

The allowlist validates only the hostname in the caller's initial URL. The
current pinned GenLayer web-response API exposes status, headers, and body, but
not redirect controls or the final response URL. The contract therefore cannot
prove where the transport ultimately retrieved a redirected request. Use
publishers and focused endpoints whose redirect behavior you trust.

`get_policy()` exposes these limitations explicitly through
`allowlist_required`, `allowlist_scope`,
`redirect_destination_observable`, `redirect_destination_enforced`, and
`source_url_queries_allowed`. It also reports
`content_length_mismatch_status` as `TRUNCATED`.

For StudioNet and Bradbury, use the bundled
[`deploy/001_deploy_and_smoke.js`](deploy/001_deploy_and_smoke.js) workflow.
It preserves the constructor's JSON-as-string ABI value, verifies deployment
execution and positive consensus, requires an explicit chain ID, compares the
deployed source and schema with the local release, submits a known grounded
claim, and checks the request-bound stored record. See
[`docs/ONCHAIN_DEPLOYMENT.md`](docs/ONCHAIN_DEPLOYMENT.md) for the complete
PowerShell procedure.

## Usage

The contract method is:

```python
verify_claim(
    "The protocol charges a 0.3% transaction fee.",
    "[\"https://docs.example.com/fees\"]"
)
```

Its ABI result is a sequential `u256` verification ID. An external SDK write
returns a transaction hash immediately, not that ID synchronously:

1. Submit the write and retain its transaction hash.
2. Wait for `ACCEPTED` for a provisional result or `FINALIZED` for a permanent
   result.
3. Check that execution finished with a return value; transaction status alone
   does not prove successful contract execution.
4. Require a positive consensus result such as `MAJORITY_AGREE`.
   `tx_execution_succeeded` alone is insufficient: `UNDETERMINED` with
   `MAJORITY_DISAGREE` is a rejected proposal, not an authoritative verdict.
5. Decode the method return from the receipt or execution trace.
6. Read the record from the same accepted or finalized state variant.

After decoding the ID, read it with:

```python
get_verification(1)
```

Example record:

```json
{
  "verification_id": 1,
  "claim": "The protocol charges a 0.3% transaction fee.",
  "sources_json": "[\"https://docs.example.com/fees\"]",
  "source_count": 1,
  "verdict": "SUPPORTED",
  "reason_code": "CITED_EVIDENCE_ENTAILS_CLAIM",
  "policy_version": "GROUNDING_V1",
  "scope": "CITATION_GROUNDING_ONLY",
  "transaction_timestamp": "2026-07-30T10:00:00Z"
}
```

`get_source_results(id)` returns a compact canonical JSON string. Parsed and
pretty-printed, it has this shape:

```json
[
  {
    "index": 0,
    "fetch_status": "AVAILABLE",
    "relation": "SUPPORTS",
    "evidence_excerpt": "The protocol charges a 0.3% transaction fee.",
    "counter_excerpt": "",
    "content_truncated": false
  }
]
```

The record also stores:

- A Keccak-256 claim digest.
- A request digest binding the policy version, trimmed claim, and canonical
  source URLs.
- The immediate submitter address (`gl.message.sender_address`). For an
  IC-to-IC call this is the calling contract, not necessarily the originating
  user.
- The complete canonical source and source-result JSON.
- The GenVM transaction timestamp. This is not the retrieval-completion or
  finalization time.

## Public interface

| Method | Type | Purpose |
| --- | --- | --- |
| `verify_claim(claim, source_urls_json)` | write | Evaluate and append one verification record. |
| `get_verification(id)` | view | Read the stored record from the queried state variant. |
| `get_source_results(id)` | view | Read per-source results as canonical JSON. |
| `get_verification_count()` | view | Read the number of records visible in the queried state variant. |
| `get_policy()` | view | Inspect versions, scope, limits, verdicts, and domain policy. |

`relations_json` lists every relation that can appear in a stored source
result, including `NOT_EVALUATED`; `classifier_relations_json` lists only the
five relations the semantic classifier may propose.

## Input policy

- One caller-supplied claim, 4–1,000 characters. Atomicity is not
  deterministically enforced; split compound outputs before submission.
- One to three unique source URLs.
- HTTPS URLs whose initial hostname is covered by the deployment allowlist.
- No URL credentials, fragments, IP literals, explicit ports, single-label
  hosts, query strings, or reserved local/internal suffixes.
- Recognized textual, HTML, JSON, or XML media types, including structured
  `application/*+json` and `application/*+xml` types. Missing media-type
  metadata is handled conservatively as documented in `SECURITY.md`.
- At most 48,000 response-body bytes, 12,000 normalized characters, and 48,000
  normalized UTF-8 bytes per source. These are post-response processing bounds.
- A 96,000-byte hard prompt bound, with 16,000 bytes reserved so the validator's
  audit prompt can include the leader proposal. Evaluation-prompt overflow is a
  truncation outcome.
- The contract requests `Range: bytes=0-47999` and
  `Accept-Encoding: identity` as best-effort hints, but `web.get` still returns
  a complete response object and exposes no streaming or response-size control.
- Any body, character, range, or prompt-budget truncation signal skips semantic
  classification for the entire request. The truncated source is recorded as
  `TRUNCATED`; all relations are `NOT_EVALUATED`, and the final result is
  `INSUFFICIENT_EVIDENCE` with `SOURCE_CONTENT_LIMIT_REACHED`.
- Between 8 and 320 characters per nonempty exact evidence excerpt.
- Callers must not submit private, authenticated, paywalled, or secret
  evidence. This is a caller-side rule, not a complete content detector.
  Query-based tokens are rejected, but secrets can still be embedded in URL
  paths or page content and would become public.

Repeated claims intentionally produce new records because web evidence may
change over time.

## Consensus and validator logic

The leader:

1. Fetch the same validated URLs.
2. Apply media-aware normalization: HTML/XML-like content is parsed as markup,
   XML CDATA is retained, non-text controls are removed, and plain text and JSON
   are not indiscriminately stripped as HTML.
3. Treat claim and source content as untrusted data.
4. Skip semantic classification for the entire request if any source is
   truncated.
5. Request a bounded per-source classification for complete available sources.
6. Reject hallucinated excerpts that do not occur in normalized source text.
7. Derive the final verdict and reason code from the per-source relations.

Each participating validator independently re-fetches and normalizes the same
initial URLs, validates the fixed leader schema and deterministic aggregation,
then runs `GROUNDING_AUDIT_V1`. The audit returns bounded booleans that assess
whether each proposed relation and excerpt is semantically justified by the
validator's independently retrieved evidence. Validators do not have to
generate the identical excerpt independently; they audit the leader's exact
excerpt in context.

Validators also compare consensus-critical deterministic fields, including
fetch status and truncation state. A validator rejects a leader result when the
source became materially different, an excerpt is absent or misleading, a
relation is unsupported, aggregation is invalid, or the audit output is
malformed.

This is a custom source-grounded non-comparative equivalence check. It is not a
JSON shape check.
All storage writes occur outside the nondeterministic block. Proposed state is
committed only when the overall transaction executes successfully and reaches
the requested consensus state.

## Retrieval failures

- HTTP `408`, `425`, `429`, and `5xx` responses are transient errors. They do
  not become durable grounding verdicts. Validators reproduce the transient
  class so a matching failure propagates without writing state.
- Stable non-`2xx`, empty, or non-text responses are marked unavailable.
- `Range` is a best-effort request hint, not a download cap. A `206` response
  and its `Content-Range` are interpreted conservatively; partial, malformed, or
  ambiguous range metadata cannot be presented as complete evidence.
- On a successful `200` or `206`, a present `Content-Length` must be decimal
  and equal the returned body length. Otherwise the source is `TRUNCATED`.
- Any truncation skips semantic classification for the whole request and makes
  the final result
  `INSUFFICIENT_EVIDENCE` with `SOURCE_CONTENT_LIMIT_REACHED`.
- If every source is unavailable, the durable result is
  `SOURCE_UNAVAILABLE`.
- Malformed model output or a fabricated excerpt produces an LLM error and
  forces rejection/leader rotation rather than a permissive fallback.

## Reusing the primitive

The simplest integration is to copy the contract, deploy it with a domain
allowlist, and read verdicts by ID. Common extensions include:

- Replacing the five source relations with a domain-specific rubric.
- Adding a caller-supplied correlation reference and an asynchronous callback
  after finalized consensus. IC-to-IC writes are asynchronous, so a calling IC
  cannot consume `verify_claim()`'s return value synchronously. A shared
  deployment otherwise needs off-chain receipt/indexing correlation.
- Gating a publishing workflow on `SUPPORTED`.
- Recording an application-specific external reference beside each request.
- Supporting rendered JavaScript pages through `gl.nondet.web.render`.
- Adding separate policy versions for multilingual evidence.

Keep downstream consequences deterministic and tied only to stable verdicts and
reason codes—not the excerpt text.

## Important limitations

- Grounding is not truth, source reputation, or historical archiving.
- Public pages can change between leader and validator retrieval.
- Only the initial URL hostname is checked; redirect handling and final URL are
  not exposed by the current pinned SDK.
- The `Range` header is best effort and does not bound downloaded response size.
- The MVP does not render JavaScript-only pages.
- Evidence past the bounded content window is not inspected.
- Text decoding is UTF-8 with invalid byte sequences replaced; both evidence
  and the final prompt are bounded by their UTF-8 encodings.
- Prompt injection cannot be eliminated completely; the fixed prompt, bounded
  schema, exact excerpts, and independent semantic audit reduce its impact.
- Correlated model failures remain possible.
- High-consequence legal, medical, employment, credit, or financial decisions
  require additional safeguards and human review.

## Accepted state versus final state

GenLayer `ACCEPTED` transactions remain appealable. An appeal can re-execute the
transaction against later web content and change or remove provisionally
accepted state. Only `FINALIZED` state should be treated as permanent.

GenLayer clients may read accepted state by default. Integrations that trigger
irreversible consequences must explicitly request finalized contract state and
verify the transaction is finalized. For either status, also verify that
execution finished successfully: an accepted or finalized error creates no
verification record.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md),
[docs/TESTING.md](docs/TESTING.md), and
[docs/HETEROGENEOUS_VALIDATION.md](docs/HETEROGENEOUS_VALIDATION.md) for the
detailed design, test evidence, and review guidance. Public deployment and
receipt verification are documented in
[docs/ONCHAIN_DEPLOYMENT.md](docs/ONCHAIN_DEPLOYMENT.md).

## Official GenLayer references

- [Writing your first Intelligent Contract](https://docs.genlayer.com/developers/intelligent-contracts/first-contract)
- [The Equivalence Principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle)
- [Non-deterministic execution](https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism)
- [Web access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access)
- [GenVM Web API response specification](https://sdk.genlayer.com/main/spec/02-execution-environment/03-wasi_genlayer_sdk.html)
- [Prompt-injection guidance](https://docs.genlayer.com/developers/intelligent-contracts/security-and-best-practices/prompt-injection)
- [Direct-mode testing](https://docs.genlayer.com/api-references/genlayer-test/direct)
- [Writing to Intelligent Contracts](https://docs.genlayer.com/developers/decentralized-applications/writing-data)
- [Messages and accepted/finalized timing](https://docs.genlayer.com/developers/intelligent-contracts/features/messages)
- [Transaction context](https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context)
- [Transaction statuses](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/transactions/transaction-statuses)
- [Finality](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/optimistic-democracy/finality)

## License

MIT
