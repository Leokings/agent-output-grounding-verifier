# Testing Guide

## Local checks

Run from the repository root:

```powershell
genvm-lint check contracts\AgentOutputGroundingVerifier.py --json
genvm-lint typecheck contracts\AgentOutputGroundingVerifier.py --json
python -m pytest tests\direct -v -p no:cacheprovider
```

The linter's `--json` mode avoids Unicode console failures in legacy Windows
code pages. Alternatively set `$env:PYTHONIOENCODING='utf-8'` before using its
human-readable output. `-p no:cacheprovider` avoids unnecessary cache writes in
restricted environments.

## Required direct test coverage

Before release, the direct suite must cover:

- All five final verdicts.
- All per-source relationship classes.
- Cross-source and within-source conflicts.
- Stable versus transient retrieval failures.
- Media-aware HTML/XML versus plain-text/JSON normalization, including XML
  CDATA and HTML-versus-XML self-closing semantics.
- Body, normalized-evidence, and final-prompt UTF-8 bounds.
- Best-effort `Range` requests and conservative `206` / `Content-Range`
  handling.
- Successful responses with an absent, valid, malformed, or mismatched
  `Content-Length`.
- Skipping semantic classification for the entire request when any source is
  truncated, including `NOT_EVALUATED` relations on complete peer sources.
- Claim, URL, source-count, hostname, and domain-allowlist validation.
- Required nonempty deployment allowlists and rejected query strings.
- Canonical URLs and duplicate detection.
- Sequential append-only state.
- Claim and request digests.
- Missing-record reads.
- Defensive LLM parsing.
- Exact-excerpt verification.
- Bounded `GROUNDING_AUDIT_V1` boolean parsing.
- Semantic audit rejection of an unsupported relation, irrelevant-but-present
  excerpt, or fabricated excerpt.
- Rejection of unexpected leader fields and bounded-schema expansion.
- Prompt-injection-shaped claim and source content.
- Independent validator acceptance.
- Validator rejection of:
  - A semantically unsupported leader classification.
  - A tampered final verdict.
  - A fabricated excerpt.
  - An irrelevant but present excerpt.
  - Extra top-level or per-source fields.
  - A source change that removes the leader excerpt or makes its relation
    semantically unsupported.
  - A transient leader error not independently reproduced by a validator.

`direct_vm.run_validator()` executes the captured custom validator against
leader output, but direct mode is still not a validator network. It does not
measure real model agreement, latency, appeals, or finality.

Direct mocks can show that the audit schema and rejection paths work. They
cannot show that heterogeneous real models reliably catch subtle misleading
relations or excerpts.

## Opt-in network smoke test

`tests/integration/test_grounding_verifier_smoke.py` deploys the contract and
submits one real cited claim on the network selected by `gltest.config.yaml`.
It is skipped unless both required inputs are set:

```powershell
$env:GENLAYER_GROUNDING_SMOKE_URL='https://your-stable-host.example/evidence'
$env:GENLAYER_GROUNDING_SMOKE_CLAIM='One atomic claim supported by that page.'
$env:GENLAYER_GROUNDING_SMOKE_EXPECTED_VERDICT='SUPPORTED' # optional
$env:GENLAYER_GROUNDING_SMOKE_WAIT_RETRIES='200' # optional for local CPU models
python -m pytest tests\integration\test_grounding_verifier_smoke.py -v -p no:cacheprovider
```

The test asserts successful deployment and write execution before reading the
record. It also requires a leader, validator receipts, successful execution for
every participant, unanimous validator votes, and at least two distinct
provider/model identities in the receipt. A single-model simulator therefore
cannot satisfy the heterogeneous gate.

## Public-network deployment smoke test

`deploy/001_deploy_and_smoke.js` is the StudioNet and Bradbury release smoke
test. It uses the SDK client supplied by `genlayer.cmd deploy`, which preserves
the constructor and method arguments that contain JSON encoded as ABI strings.

The script checks the explicitly selected chain, lifecycle status, positive
consensus, successful execution, deployed source and schema, policy, one
state-changing verification, and the request-bound persisted record. It does
not require provider/model identities because public network receipts may not
expose them. That is deliberately separate from, and does not weaken, the
heterogeneous integration gate above.

Run its local tooling tests with:

```powershell
npm run check:deploy
npm run test:deploy
```

The complete StudioNet and Bradbury procedure is in
[ONCHAIN_DEPLOYMENT.md](ONCHAIN_DEPLOYMENT.md).

## Semantic golden corpus

`tests/semantic/golden_cases.json` documents the core human-labelled cases that
should remain stable across validator model families.

The corpus is intentionally separate from mocked direct tests. Mocking an
expected model result tests contract behavior, not model quality.

Before a production or challenge deployment:

1. Run each golden case through a multi-validator GenLayer Studio environment.
2. Include at least two materially different model families.
3. Record the leader classification, each audit boolean set, validator votes,
   rotations, accepted result, and final state.
4. Measure false acceptance, false rejection, consensus rate, and rotations.
5. Investigate every disagreement rather than loosening equivalence globally.
6. Add each discovered failure as a golden case and direct regression test.

The completed 2026-07-30 local two-model run is documented in
[HETEROGENEOUS_VALIDATION.md](HETEROGENEOUS_VALIDATION.md). It demonstrates
local heterogeneous execution and fail-closed disagreement handling, but does
not replace a target-network run with independent operators.

## Required integration scenarios

Test with stable public endpoints created for the evaluation:

1. Direct paraphrased support.
2. Missing global/date/quantity qualifiers.
3. Exact numeric and date contradiction.
4. Two sources that conflict.
5. A page with support in a heading and negation in its body.
6. One `404` plus one supporting page.
7. All stable `404` responses.
8. A `429` and a `503`.
9. A page changing materially between leader and validators.
10. A fabricated excerpt attempt.
11. Prompt injection in visible text, HTML comments, JSON fields, and the claim.
12. Relevant evidence beyond the configured content window.
13. XML/tag-boundary injection in claims, URLs, and source text.
14. Strict source-index types and unexpected output fields.
15. A server that honors `Range` with a valid `206` / `Content-Range`.
16. Servers that ignore `Range`, return malformed or ambiguous
    `Content-Range`, send malformed or mismatched `Content-Length`, or return
    exactly-at-limit bodies.
17. HTML, XML, JSON, and plain-text documents containing identical tag-like
    text.
18. A source whose normalized evidence fits but whose final constructed prompt
    exceeds its UTF-8 budget.
19. A permitted initial host that returns a redirect. Record actual platform
    behavior, but do not claim the contract can inspect or constrain the final
    URL: the current response API does not expose it.
20. Two validators that choose different plausible quotes but correctly audit
    the leader's excerpt in context.

## Acceptance criteria

- Lint and type checking have zero diagnostics.
- All direct tests pass.
- A real multi-validator run has been completed; the JSON corpus alone does not
  satisfy this gate.
- Integration consumers require `ACCEPTED` or `FINALIZED` plus a positive
  consensus result; runtime execution success alone does not accept an
  `UNDETERMINED` or `MAJORITY_DISAGREE` proposal.
- No golden case creates an unsupported accepted or finalized record.
- False `SUPPORTED` on a material qualifier is treated as the highest-priority
  failure.
- Malformed model output and transient retrieval failures write no state.
- Any truncated source prevents semantic classification of the whole request.
- Validators reject leader-only formatting tricks, unsupported relations, and
  fabricated or misleading excerpts.
- Redirect, response-size, and finality limitations are reported rather than
  represented as tested guarantees.
