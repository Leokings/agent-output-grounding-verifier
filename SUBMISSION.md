# Intelligent Contracts Submission

## Name

Agent Output Grounding Verifier

## One-line description

A reusable GenLayer contract that records whether one caller-supplied factual
claim is supported, partially supported, contradicted, or not addressed by one
to three public citations. Calling applications split compound output into
atomic claims before submission.

## Why it is useful

AI agents frequently return cited reports, recommendations, governance
summaries, and research outputs, but downstream applications normally trust the
agent's citation mapping. This primitive lets another contract or application
request a shared, appealable GenLayer judgment before treating the agent output
as grounded.

Possible consumers include:

- Research and reporting agents.
- DAO proposal assistants.
- Grant and bounty reviewers.
- Agent marketplaces.
- Publishing workflows.
- Autonomous purchasing or monitoring agents.

## Why it is reusable

The contract has no product-specific state, owner, frontend, payment flow, or
mutable policy. Builders deploy the same file with a required nonempty domain
allowlist and no mutator, then submit claims through one stable method.

The stored `CITATION_GROUNDING_ONLY` scope prevents the result from being
misrepresented as a universal truth verdict.

## GenLayer consensus

The leader fetches and media-normalizes each source, conservatively rejects
truncated evidence from semantic classification, classifies complete evidence
against the claim, and supplies exact excerpts. Contract code derives the final
verdict.

Each participating validator independently re-fetches the same initial URLs,
checks schema, fetch/truncation state, excerpt membership, and deterministic
aggregation, then runs a bounded `GROUNDING_AUDIT_V1` semantic audit over the
leader's relations and excerpts. Validators reject:

- Leader-only format validation.
- A final verdict not derivable from the source relations.
- Fabricated excerpts.
- A leader excerpt missing from validator-retrieved evidence.
- A relation or excerpt that the independent semantic audit does not support.
- Unexpected leader fields or storage-bloat attempts.
- Incompatible availability or truncation state.
- Malformed classifier or audit output.

The contract uses a custom source-grounded non-comparative
`run_nondet_unsafe` validator and writes
storage only outside the nondeterministic block. A record is committed only when
execution succeeds and a participating-validator majority accepts the
transaction.

The deployment allowlist covers the initial request hostname only. The current
pinned SDK does not expose redirect controls or a final response URL, and its
`web.get` response is not streaming. `Range` is therefore a best-effort hint,
not a download cap. The contract treats `206` / `Content-Range`, body,
`Content-Length`, normalized-evidence, and final-prompt bounds conservatively;
any truncation signal, including a malformed or mismatched present
`Content-Length` on `200` or `206`, skips semantic classification for the
entire request and prevents a supported verdict.

## State design

Every successfully executed verification transaction that reaches accepted
state creates a sequential append-only record containing:

- Immediate submitter and GenVM transaction timestamp.
- Claim and canonical sources.
- Claim and request digests.
- Per-source fetch states, relations, and exact excerpts.
- Stable verdict and reason code.
- Fixed policy version and scope.

Repeated requests create new records because web evidence can change.
Accepted state remains provisional during GenLayer's appeal window. Only
finalized state should drive irreversible consequences. `ACCEPTED` or
`FINALIZED` status does not by itself prove execution succeeded; failed
execution creates no record.

External SDK writes return a transaction hash, not the `u256` verification ID
synchronously. Consumers wait for the required status, assert
`FINISHED_WITH_RETURN`, decode the return from the receipt or execution trace,
and read the same accepted/finalized state variant. IC-to-IC writes are
asynchronous; shared-service correlation requires off-chain receipt/indexing or
a fork with a caller reference and finalized callback.

## Reviewer quick path

```powershell
genvm-lint check contracts\AgentOutputGroundingVerifier.py --json
genvm-lint typecheck contracts\AgentOutputGroundingVerifier.py --json
python -m pytest tests\direct -v -p no:cacheprovider
```

Key files:

- `contracts/AgentOutputGroundingVerifier.py`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `docs/TESTING.md`
- `tests/direct/test_grounding_verifier.py`
- `tests/semantic/golden_cases.json`
