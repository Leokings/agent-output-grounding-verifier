# Heterogeneous Validator Validation

Validation date: 2026-07-30

## Scope

This report records a local five-validator GenLayer Studio run using two actual
Ollama model families. It is stronger than direct mocks and single-model
plumbing tests, but it is not a public-testnet or independent-operator security
claim.

## Environment

- GenLayer Studio: `v0.79.1`
- GenVM executor: `v0.2.4`
- Contract runner:
  `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
- Validators: five, each with stake `5`
- Model split: three `ollama/llama3`, two `ollama/qwen2.5:3b`
- Per-validator model bounds: `num_ctx=4096`, `num_predict=512`
- Test harness: `genlayer-test==0.29.2`

Studio `v0.79.1` was used because it is the newest synchronized localnet image
set published for every service required by the installed CLI and it contains
the contract's pinned runner. The CLI default, Studio `v0.65.0`, does not
contain that runner. A newer repository tag, `v0.121.18`, could not form a
localnet because its matching `simulator-hardhat` image was not published.

## Unanimous supported-evidence case

Input:

```text
URL: https://example.com/
Claim: This domain is for use in illustrative examples in documents.
Expected verdict: SUPPORTED
```

Result:

- Transaction:
  `0x00f828f2e091505049f5993d5eeab28de02d25168c30dd415e0cac4a57b0a995`
- Final status: `FINALIZED`
- Consensus result: `MAJORITY_AGREE`
- Leader model: `ollama/llama3`
- Participant execution: every leader and validator receipt was `SUCCESS`
- Votes: five `agree`, zero `disagree`
- Rotations: zero
- Model identities in the receipt: `ollama/llama3` and
  `ollama/qwen2.5:3b`
- Stored verdict: `SUPPORTED`
- Stored reason code: `CITED_EVIDENCE_ENTAILS_CLAIM`
- Stored policy version: `GROUNDING_V1`

The integration test rejects a receipt unless it contains a leader, validators,
successful execution for every participant, all validator votes agree, and at
least two distinct provider/model identities.

## Fail-closed contradiction stress

Input:

```text
URL: https://example.com/
Claim: The Example Domain page says permission is required before this domain
may be used in documentation examples.
Expected semantic verdict: CONTRADICTED
```

Transaction:
`0x6582960ae715601dcf889c7be03a8b32caf932e698b5d4a323260cedcb72eeff`

The local Llama leader incorrectly proposed `SUPPORTED`. All five vote entries
were `disagree`, the consensus result was `MAJORITY_DISAGREE`, and the
transaction became `UNDETERMINED`. No incorrect verification record was
finalized.

This demonstrates the validator audit's safety value, while also showing a
liveness and classification-quality limit of the small local models. Prompt
experiments that overfit this one negation case were discarded after they
reduced agreement on the supported paraphrase.

The case was added to `tests/semantic/golden_cases.json` for future evaluation
with stronger and more diverse validator models.

## Local runtime findings

Two Studio/CLI issues required test-environment workarounds:

1. The CLI's generated GenVM web override omitted required version-specific
   fields, including `session_create_request`. The local test merged the
   `v0.79.1` image defaults with the localhost allowlist and verified that both
   the `web` and `llm` GenVM workers were alive.
2. Studio `v0.79.1` cannot update a validator's full model configuration through
   `sim_updateValidator`. The test used supported `sim_deleteAllValidators` and
   `sim_createValidator` calls to create five explicitly configured validators,
   then restarted JSON-RPC so the live LLM routing table matched the database.

These are local Studio tooling constraints, not changes to the contract.

## Remaining production gate

Before relying on this primitive for consequential production actions, repeat
the golden corpus on the target GenLayer network with independent operators and
production-grade model families. Record consensus rate, false acceptance,
false rejection, rotations, appeals, latency, and finality. The local result
above proves heterogeneous execution and fail-closed behavior, not economic
independence or production readiness.
