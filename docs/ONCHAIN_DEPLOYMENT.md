# On-chain deployment and smoke testing

This repository separates three different release gates:

1. Direct-mode tests validate deterministic contract behavior.
2. A controlled heterogeneous Studio run validates real multi-model consensus.
3. A public-network deployment validates the target network, account, fees,
   receipts, deployed schema, and persisted contract state.

The public-network check does not claim validator-model diversity when the
network receipt does not expose provider and model identities. The stricter
heterogeneous gate remains documented separately.

## Why the bundled script is used

The constructor and `verify_claim` both accept JSON encoded inside ABI strings.
GenLayer CLI `0.39.2` parses JSON-looking `--args` values into arrays or objects,
so a direct CLI command cannot reliably preserve those arguments as strings.

`deploy/001_deploy_and_smoke.js` calls GenLayerJS through the client supplied by
the CLI. It preserves the JSON strings, deploys the contract, checks positive
consensus and execution, compares the deployed source and schema with the local
release, reads `get_policy`, submits a known claim, and checks the stored
verification record.

The script has no mutating defaults. It requires an explicit expected chain ID,
allowlist, source list, claim, and expected verdict. It refuses to submit a
transaction when the selected CLI network has a different chain ID.

## Prerequisites

- Node.js 18 or newer.
- GenLayer CLI `0.39.2` or a compatible newer version.
- Python 3.12 or newer for the test suites.
- A dedicated testnet account. Never use a wallet holding valuable assets.

Install the project checks and verify the local release gates first:

```powershell
python -m pip install -r requirements.txt
genvm-lint check contracts\AgentOutputGroundingVerifier.py --json
genvm-lint typecheck contracts\AgentOutputGroundingVerifier.py --json
python -m pytest tests\direct -v -p no:cacheprovider
npm run test:deploy
```

Create and select a CLI account if one does not already exist:

```powershell
genlayer.cmd account create --name grounding-deployer
genlayer.cmd account use grounding-deployer
genlayer.cmd account show
```

Use the interactive password prompt. Do not place a wallet password or private
key in shell history.

## StudioNet rehearsal

StudioNet is hosted and gasless. A zero GEN balance is expected.

```powershell
genlayer.cmd network set studionet
genlayer.cmd network info

$env:GROUNDING_EXPECTED_CHAIN_ID='61999'
$env:GROUNDING_ALLOWED_DOMAINS_JSON='["example.com"]'
$env:GROUNDING_SMOKE_SOURCE_URLS_JSON='["https://example.com/"]'
$env:GROUNDING_SMOKE_CLAIM='This domain is for use in illustrative examples in documents.'
$env:GROUNDING_SMOKE_EXPECTED_VERDICT='SUPPORTED'
$env:GROUNDING_WAIT_STATUS='ACCEPTED'
$env:GROUNDING_DEPLOYMENT_OUTPUT='artifacts/studionet-deployment.json'

genlayer.cmd deploy
```

`genlayer.cmd deploy` runs every `.js` or `.ts` file in `deploy/`. This
repository intentionally contains one numbered deployment script.

## Bradbury deployment

Bradbury is the persistent production-like GenLayer testnet. Switch networks,
copy the account address, and fund it using the official faucet:

```powershell
genlayer.cmd network set testnet-bradbury
genlayer.cmd network info
genlayer.cmd account show
```

Faucet: <https://testnet-faucet.genlayer.foundation/>

After the balance appears, run the same script. Waiting for `FINALIZED` is the
strongest release record but may take materially longer than `ACCEPTED`.

```powershell
$env:GROUNDING_EXPECTED_CHAIN_ID='4221'
$env:GROUNDING_ALLOWED_DOMAINS_JSON='["example.com"]'
$env:GROUNDING_SMOKE_SOURCE_URLS_JSON='["https://example.com/"]'
$env:GROUNDING_SMOKE_CLAIM='This domain is for use in illustrative examples in documents.'
$env:GROUNDING_SMOKE_EXPECTED_VERDICT='SUPPORTED'
$env:GROUNDING_WAIT_STATUS='FINALIZED'
$env:GROUNDING_WAIT_RETRIES='300'
$env:GROUNDING_WAIT_INTERVAL_MS='5000'
$env:GROUNDING_DEPLOYMENT_OUTPUT='artifacts/bradbury-deployment.json'

genlayer.cmd deploy
```

The command prints `GROUNDING_DEPLOYMENT_RESULT` containing the contract
address, deployment transaction, verification transaction, verification ID,
verdict, policy version, configuration, contract SHA-256, and Git state.
`source_commit` is populated only when the working tree is clean;
`git_dirty: true` means the recorded `git_commit` is context rather than an
exact source identifier. Run public release deployments from a clean checkout.

The optional output must be a new `.json` file under `artifacts/` or
`deployments/`. Existing files are never overwritten.

## Required success checks

The deployment script rejects the run unless both transactions:

- Reach `ACCEPTED` or `FINALIZED`.
- Have consensus result `MAJORITY_AGREE`.
- Finish execution successfully.
- Contain no failed participant execution when those receipt details are
  exposed.

It also requires:

- A valid deployed contract address.
- Byte-for-byte equality between local and deployed contract source.
- The expected constructor and five public methods in the deployed schema.
- `get_policy().policy_version == "GROUNDING_V1"`.
- The deployed domain allowlist to match the requested allowlist.
- Zero records before the smoke write and exactly record ID `1` afterward.
- A persisted record whose claim and canonical sources match this request.
- The expected verdict and a valid one-to-three source count.

Lifecycle status alone is insufficient. A transaction can finalize an execution
error, and `UNDETERMINED` / `MAJORITY_DISAGREE` is not an authoritative
grounding result.

## Independent receipt and code inspection

Use the hashes and address printed by the script:

```powershell
genlayer.cmd receipt <DEPLOYMENT_TX> --status FINALIZED
genlayer.cmd receipt <VERIFICATION_TX> --status FINALIZED
genlayer.cmd receipt <VERIFICATION_TX> --stdout
genlayer.cmd receipt <VERIFICATION_TX> --stderr
genlayer.cmd schema <CONTRACT_ADDRESS>
genlayer.cmd code <CONTRACT_ADDRESS>
genlayer.cmd call <CONTRACT_ADDRESS> get_policy
genlayer.cmd call <CONTRACT_ADDRESS> get_verification_count
genlayer.cmd call <CONTRACT_ADDRESS> get_verification --args 1
```

Compare `genlayer.cmd code` with the contract at `source_commit`. If
`source_commit` is `null`, use `contract_sha256` for the byte-for-byte check and
do not promote that run as a release deployment. Then add a reviewed,
non-secret deployment record under `deployments/`.

## Existing heterogeneous consensus gate

The opt-in test below requires participant receipts, unanimous validator votes,
and at least two provider/model identities:

```powershell
$env:GENLAYER_GROUNDING_SMOKE_URL='https://example.com/'
$env:GENLAYER_GROUNDING_SMOKE_CLAIM='This domain is for use in illustrative examples in documents.'
$env:GENLAYER_GROUNDING_SMOKE_EXPECTED_VERDICT='SUPPORTED'
$env:GENLAYER_GROUNDING_SMOKE_WAIT_RETRIES='200'

gltest tests\integration\test_grounding_verifier_smoke.py -v -s --network localnet
```

Public networks may intentionally omit model identity details from receipts.
That omission must not be treated as proof of heterogeneity. Keep the controlled
heterogeneous run and the public-network deployment as separate evidence.
