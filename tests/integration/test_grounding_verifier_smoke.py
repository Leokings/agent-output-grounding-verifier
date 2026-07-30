import json
import os
from urllib.parse import urlsplit

import pytest

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.utils import extract_contract_address


CONTRACT_PATH = "AgentOutputGroundingVerifier.py"
SMOKE_URL = os.getenv("GENLAYER_GROUNDING_SMOKE_URL", "").strip()
SMOKE_CLAIM = os.getenv("GENLAYER_GROUNDING_SMOKE_CLAIM", "").strip()
EXPECTED_VERDICT = os.getenv(
    "GENLAYER_GROUNDING_SMOKE_EXPECTED_VERDICT",
    "",
).strip()
WAIT_RETRIES = int(
    os.getenv("GENLAYER_GROUNDING_SMOKE_WAIT_RETRIES", "50")
)

pytestmark = pytest.mark.skipif(
    not SMOKE_URL or not SMOKE_CLAIM,
    reason=(
        "Set GENLAYER_GROUNDING_SMOKE_URL and "
        "GENLAYER_GROUNDING_SMOKE_CLAIM to run the real-network smoke test"
    ),
)


def receipt_diagnostics(receipt):
    return json.dumps(receipt, default=str, indent=2, sort_keys=True)


def _receipt_list(value):
    if not value:
        return []
    return value if isinstance(value, list) else [value]


def _participant_report(role, index, receipt):
    node = receipt.get("node_config") or {}
    primary_model = node.get("primary_model") or node
    execution_result = str(receipt.get("execution_result") or "")
    return {
        "role": role,
        "index": index,
        "address": node.get("address"),
        "provider": primary_model.get("provider"),
        "model": primary_model.get("model"),
        "plugin": primary_model.get("plugin"),
        "execution_result": execution_result,
        "execution_succeeded": execution_result.upper() == "SUCCESS",
        "vote": receipt.get("vote"),
    }


def consensus_report(receipt):
    consensus = receipt.get("consensus_data") or {}
    leaders = _receipt_list(consensus.get("leader_receipt"))
    validators = _receipt_list(consensus.get("validators"))
    votes = consensus.get("votes") or {}
    votes_by_address = (
        {str(address).lower(): vote for address, vote in votes.items()}
        if isinstance(votes, dict)
        else {}
    )
    validator_reports = [
        _participant_report("validator", index, item)
        for index, item in enumerate(validators)
    ]
    for item in validator_reports:
        if item["vote"] is None and item["address"]:
            item["vote"] = votes_by_address.get(
                str(item["address"]).lower()
            )
    return {
        "tx_ref": receipt.get("tx_id") or receipt.get("hash"),
        "status": receipt.get("status_name") or receipt.get("status"),
        "result": receipt.get("result_name") or receipt.get("result"),
        "execution_succeeded": tx_execution_succeeded(receipt),
        "votes": votes,
        "leaders": [
            _participant_report("leader", index, item)
            for index, item in enumerate(leaders)
        ],
        "validators": validator_reports,
    }


def _vote_agrees(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value == 1
    return str(value).strip().lower() in {
        "1",
        "agree",
        "agreed",
        "true",
        "votetype.agree",
    }


def test_real_consensus_grounding_smoke():
    parsed = urlsplit(SMOKE_URL)
    assert parsed.scheme == "https"
    assert parsed.hostname
    assert parsed.query == ""
    assert parsed.fragment == ""
    assert 12 <= len(SMOKE_CLAIM) <= 1_000

    factory = get_contract_factory(contract_file_path=CONTRACT_PATH)
    deploy_receipt = factory.deploy_contract_tx(
        args=[json.dumps([parsed.hostname])],
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(deploy_receipt), receipt_diagnostics(
        deploy_receipt
    )

    contract = factory.build_contract(
        extract_contract_address(deploy_receipt),
    )
    verify_receipt = contract.verify_claim(
        args=[SMOKE_CLAIM, json.dumps([SMOKE_URL])],
    ).transact(wait_retries=WAIT_RETRIES)
    assert tx_execution_succeeded(verify_receipt), receipt_diagnostics(
        verify_receipt
    )

    report = consensus_report(verify_receipt)
    print("\nHETEROGENEOUS_CONSENSUS_REPORT:")
    print(json.dumps(report, default=str, indent=2, sort_keys=True))

    participants = report["leaders"] + report["validators"]
    identities = {
        (item["provider"], item["model"])
        for item in participants
        if item["provider"] and item["model"]
    }
    assert report["leaders"], report
    assert report["validators"], report
    assert report["status"] in {"ACCEPTED", "FINALIZED"}, report
    assert report["result"] == "MAJORITY_AGREE", report
    assert all(item["execution_succeeded"] for item in participants), report
    assert all(
        _vote_agrees(item["vote"]) for item in report["validators"]
    ), report
    assert len(identities) >= 2, (
        "Expected at least two provider/model identities, "
        f"got {identities}: {report}"
    )

    verification_id = contract.get_verification_count(args=[]).call()
    record = contract.get_verification(args=[verification_id]).call()
    assert record["verdict"] in {
        "SUPPORTED",
        "PARTIALLY_SUPPORTED",
        "CONTRADICTED",
        "INSUFFICIENT_EVIDENCE",
        "SOURCE_UNAVAILABLE",
    }
    assert record["policy_version"] == "GROUNDING_V1"
    assert record["source_count"] == 1
    if EXPECTED_VERDICT:
        assert record["verdict"] == EXPECTED_VERDICT
    print("\nGROUNDING_RESULT:")
    print(
        json.dumps(
            {
                "verification_id": verification_id,
                "verdict": record["verdict"],
                "reason_code": record["reason_code"],
                "policy_version": record["policy_version"],
                "source_count": record["source_count"],
            },
            default=str,
            indent=2,
            sort_keys=True,
        )
    )
