import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import deployAndSmoke, {
  assertPositiveReceipt,
} from "../../deploy/001_deploy_and_smoke.js";

const CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
const DEPLOYMENT_HASH = `0x${"a".repeat(64)}`;
const VERIFICATION_HASH = `0x${"b".repeat(64)}`;

function positiveReceipt(extra = {}) {
  return {
    statusName: "FINALIZED",
    resultName: "MAJORITY_AGREE",
    txExecutionResultName: "FINISHED_WITH_RETURN",
    consensus_data: {
      leader_receipt: [{ execution_result: "SUCCESS" }],
      validators: [
        { execution_result: "SUCCESS" },
        { execution_result: "SUCCESS" },
      ],
      votes: {
        "0x01": "AGREE",
        "0x02": "AGREE",
      },
    },
    ...extra,
  };
}

test("deployment tooling preserves JSON strings and verifies stored state", async () => {
  const envNames = [
    "GROUNDING_EXPECTED_CHAIN_ID",
    "GROUNDING_EXPECTED_NETWORK_NAME",
    "GROUNDING_ALLOWED_DOMAINS_JSON",
    "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    "GROUNDING_SMOKE_CLAIM",
    "GROUNDING_SMOKE_EXPECTED_VERDICT",
    "GROUNDING_WAIT_STATUS",
    "GROUNDING_DEPLOYMENT_OUTPUT",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );

  process.env.GROUNDING_EXPECTED_CHAIN_ID = "61999";
  process.env.GROUNDING_EXPECTED_NETWORK_NAME = "Mock GenLayer";
  process.env.GROUNDING_ALLOWED_DOMAINS_JSON =
    '["STATUS.Example.com","Docs.Example.com"]';
  process.env.GROUNDING_SMOKE_SOURCE_URLS_JSON =
    '["https://Docs.Example.com/evidence"]';
  process.env.GROUNDING_SMOKE_CLAIM =
    "This domain is for use in illustrative examples in documents.";
  process.env.GROUNDING_SMOKE_EXPECTED_VERDICT = "SUPPORTED";
  process.env.GROUNDING_WAIT_STATUS = "FINALIZED";
  delete process.env.GROUNDING_DEPLOYMENT_OUTPUT;

  let deployRequest;
  let writeRequest;
  let countReads = 0;
  const waits = [];
  const reads = [];
  const client = {
    chain: { id: 61999, name: "Mock GenLayer" },
    async initializeConsensusSmartContract() {},
    async deployContract(request) {
      deployRequest = request;
      return DEPLOYMENT_HASH;
    },
    async writeContract(request) {
      writeRequest = request;
      return VERIFICATION_HASH;
    },
    async waitForTransactionReceipt(request) {
      waits.push(request);
      if (request.hash === DEPLOYMENT_HASH) {
        return positiveReceipt({
          data: { contract_address: CONTRACT_ADDRESS },
        });
      }
      return positiveReceipt();
    },
    async getContractCode() {
      return deployRequest.code;
    },
    async getContractSchema() {
      return {
        ctor: {
          params: [["allowed_domains_json", "string"]],
          kwparams: {},
        },
        methods: {
          get_policy: { readonly: true },
          get_source_results: { readonly: true },
          get_verification: { readonly: true },
          get_verification_count: { readonly: true },
          verify_claim: { readonly: false },
        },
      };
    },
    async readContract(request) {
      reads.push(request);
      if (request.functionName === "get_policy") {
        return {
          policy_version: "GROUNDING_V1",
          allowed_domains_json:
            '["docs.example.com","status.example.com"]',
        };
      }
      if (request.functionName === "get_verification_count") {
        countReads += 1;
        return countReads === 1 ? 0n : 1n;
      }
      if (request.functionName === "get_verification") {
        assert.deepEqual(request.args, [1n]);
        return {
          claim:
            "This domain is for use in illustrative examples in documents.",
          sources_json: '["https://docs.example.com/evidence"]',
          verdict: "SUPPORTED",
          reason_code: "CITED_EVIDENCE_ENTAILS_CLAIM",
          policy_version: "GROUNDING_V1",
          source_count: 1,
        };
      }
      throw new Error(`Unexpected read: ${request.functionName}`);
    },
  };

  const originalLog = console.log;
  console.log = () => {};
  try {
    const result = await deployAndSmoke(client);
    assert.equal(result.contract_address, CONTRACT_ADDRESS);
    assert.equal(result.verdict, "SUPPORTED");
    assert.equal(typeof deployRequest.args[0], "string");
    assert.equal(
      deployRequest.args[0],
      '["docs.example.com","status.example.com"]',
    );
    assert.equal(typeof writeRequest.args[1], "string");
    assert.equal(
      writeRequest.args[1],
      '["https://docs.example.com/evidence"]',
    );
    assert.equal(writeRequest.value, 0n);
    assert.equal(countReads, 2);
    assert.ok(
      reads.every(
        (request) => request.transactionHashVariant === "latest-final",
      ),
    );
    assert.deepEqual(
      waits.map((item) => item.status),
      ["FINALIZED", "FINALIZED"],
    );
  } finally {
    console.log = originalLog;
    for (const name of envNames) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});

test("receipt validation fails closed on rejected consensus", () => {
  assert.throws(
    () =>
      assertPositiveReceipt(
        {
          statusName: "UNDETERMINED",
          resultName: "MAJORITY_DISAGREE",
          txExecutionResultName: "FINISHED_WITH_RETURN",
        },
        "Verification",
      ),
    /accepted state|positive consensus/,
  );
});

test("chain mismatch fails before any network mutation", async () => {
  const envNames = [
    "GROUNDING_EXPECTED_CHAIN_ID",
    "GROUNDING_EXPECTED_NETWORK_NAME",
    "GROUNDING_ALLOWED_DOMAINS_JSON",
    "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    "GROUNDING_SMOKE_CLAIM",
    "GROUNDING_SMOKE_EXPECTED_VERDICT",
    "GROUNDING_DEPLOYMENT_OUTPUT",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  process.env.GROUNDING_EXPECTED_CHAIN_ID = "4221";
  process.env.GROUNDING_EXPECTED_NETWORK_NAME = "Mock Bradbury";
  process.env.GROUNDING_ALLOWED_DOMAINS_JSON = '["example.com"]';
  process.env.GROUNDING_SMOKE_SOURCE_URLS_JSON =
    '["https://example.com/"]';
  process.env.GROUNDING_SMOKE_CLAIM = "A sufficiently long atomic claim.";
  process.env.GROUNDING_SMOKE_EXPECTED_VERDICT = "SUPPORTED";
  delete process.env.GROUNDING_DEPLOYMENT_OUTPUT;

  let initialized = false;
  let deployed = false;
  const client = {
    chain: { id: 61999, name: "Mock StudioNet" },
    async initializeConsensusSmartContract() {
      initialized = true;
    },
    async deployContract() {
      deployed = true;
    },
  };

  try {
    await assert.rejects(
      () => deployAndSmoke(client),
      /does not match GROUNDING_EXPECTED_CHAIN_ID/,
    );
    assert.equal(initialized, false);
    assert.equal(deployed, false);
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});

test("network mismatch fails before mutation even when chain IDs match", async () => {
  const envNames = [
    "GROUNDING_EXPECTED_CHAIN_ID",
    "GROUNDING_EXPECTED_NETWORK_NAME",
    "GROUNDING_ALLOWED_DOMAINS_JSON",
    "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    "GROUNDING_SMOKE_CLAIM",
    "GROUNDING_SMOKE_EXPECTED_VERDICT",
    "GROUNDING_DEPLOYMENT_OUTPUT",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  process.env.GROUNDING_EXPECTED_CHAIN_ID = "4221";
  process.env.GROUNDING_EXPECTED_NETWORK_NAME =
    "Genlayer Bradbury Testnet";
  process.env.GROUNDING_ALLOWED_DOMAINS_JSON = '["example.com"]';
  process.env.GROUNDING_SMOKE_SOURCE_URLS_JSON =
    '["https://example.com/"]';
  process.env.GROUNDING_SMOKE_CLAIM = "A sufficiently long atomic claim.";
  process.env.GROUNDING_SMOKE_EXPECTED_VERDICT = "SUPPORTED";
  delete process.env.GROUNDING_DEPLOYMENT_OUTPUT;

  let initialized = false;
  let deployed = false;
  const client = {
    chain: { id: 4221, name: "Genlayer Asimov Testnet" },
    async initializeConsensusSmartContract() {
      initialized = true;
    },
    async deployContract() {
      deployed = true;
    },
  };

  try {
    await assert.rejects(
      () => deployAndSmoke(client),
      /does not match GROUNDING_EXPECTED_NETWORK_NAME/,
    );
    assert.equal(initialized, false);
    assert.equal(deployed, false);
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});

test("invalid contract inputs fail before any network mutation", async (t) => {
  const envNames = [
    "GROUNDING_EXPECTED_CHAIN_ID",
    "GROUNDING_EXPECTED_NETWORK_NAME",
    "GROUNDING_ALLOWED_DOMAINS_JSON",
    "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    "GROUNDING_SMOKE_CLAIM",
    "GROUNDING_SMOKE_EXPECTED_VERDICT",
    "GROUNDING_DEPLOYMENT_OUTPUT",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const cases = [
    {
      name: "too many domains",
      value: JSON.stringify(
        Array.from({ length: 33 }, (_item, index) => `host${index}.example.com`),
      ),
      variable: "GROUNDING_ALLOWED_DOMAINS_JSON",
    },
    {
      name: "reserved domain",
      value: '["service.internal"]',
      variable: "GROUNDING_ALLOWED_DOMAINS_JSON",
    },
    {
      name: "too many sources",
      value: JSON.stringify(
        Array.from(
          { length: 4 },
          (_item, index) => `https://example.com/${index}`,
        ),
      ),
      variable: "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    },
    {
      name: "query string",
      value: '["https://example.com/evidence?token=x"]',
      variable: "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    },
    {
      name: "explicit port",
      value: '["https://example.com:443/evidence"]',
      variable: "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    },
    {
      name: "credentials",
      value: '["https://user@example.com/evidence"]',
      variable: "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    },
    {
      name: "IP literal",
      value: '["https://127.0.0.1/evidence"]',
      variable: "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    },
    {
      name: "unallowlisted source",
      value: '["https://other.example/evidence"]',
      variable: "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    },
    {
      name: "short claim",
      value: "abc",
      variable: "GROUNDING_SMOKE_CLAIM",
    },
    {
      name: "short astral-Unicode claim",
      value: "😀😀",
      variable: "GROUNDING_SMOKE_CLAIM",
    },
    {
      name: "claim control",
      value: "A claim with\u0001a control.",
      variable: "GROUNDING_SMOKE_CLAIM",
    },
    {
      name: "unknown verdict",
      value: "MAYBE",
      variable: "GROUNDING_SMOKE_EXPECTED_VERDICT",
    },
  ];

  try {
    for (const invalidCase of cases) {
      await t.test(invalidCase.name, async () => {
        process.env.GROUNDING_EXPECTED_CHAIN_ID = "61999";
        process.env.GROUNDING_EXPECTED_NETWORK_NAME = "Mock StudioNet";
        process.env.GROUNDING_ALLOWED_DOMAINS_JSON = '["example.com"]';
        process.env.GROUNDING_SMOKE_SOURCE_URLS_JSON =
          '["https://example.com/"]';
        process.env.GROUNDING_SMOKE_CLAIM =
          "A sufficiently long atomic claim.";
        process.env.GROUNDING_SMOKE_EXPECTED_VERDICT = "SUPPORTED";
        delete process.env.GROUNDING_DEPLOYMENT_OUTPUT;
        process.env[invalidCase.variable] = invalidCase.value;

        let initialized = false;
        let deployed = false;
        const client = {
          chain: { id: 61999, name: "Mock StudioNet" },
          async initializeConsensusSmartContract() {
            initialized = true;
          },
          async deployContract() {
            deployed = true;
          },
        };

        await assert.rejects(() => deployAndSmoke(client));
        assert.equal(initialized, false);
        assert.equal(deployed, false);
      });
    }
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});

test("deployment output cannot escape approved repository directories", async () => {
  const envNames = [
    "GROUNDING_EXPECTED_CHAIN_ID",
    "GROUNDING_EXPECTED_NETWORK_NAME",
    "GROUNDING_ALLOWED_DOMAINS_JSON",
    "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    "GROUNDING_SMOKE_CLAIM",
    "GROUNDING_SMOKE_EXPECTED_VERDICT",
    "GROUNDING_DEPLOYMENT_OUTPUT",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  process.env.GROUNDING_EXPECTED_CHAIN_ID = "61999";
  process.env.GROUNDING_EXPECTED_NETWORK_NAME = "Mock StudioNet";
  process.env.GROUNDING_ALLOWED_DOMAINS_JSON = '["example.com"]';
  process.env.GROUNDING_SMOKE_SOURCE_URLS_JSON =
    '["https://example.com/"]';
  process.env.GROUNDING_SMOKE_CLAIM = "A sufficiently long atomic claim.";
  process.env.GROUNDING_SMOKE_EXPECTED_VERDICT = "SUPPORTED";
  process.env.GROUNDING_DEPLOYMENT_OUTPUT = "../outside.json";

  let initialized = false;
  const client = {
    chain: { id: 61999, name: "Mock StudioNet" },
    async initializeConsensusSmartContract() {
      initialized = true;
    },
  };

  try {
    await assert.rejects(
      () => deployAndSmoke(client),
      /must be a JSON file under artifacts\/ or deployments\//,
    );
    assert.equal(initialized, false);
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});

test("an existing deployment record fails before network mutation", async () => {
  const envNames = [
    "GROUNDING_EXPECTED_CHAIN_ID",
    "GROUNDING_EXPECTED_NETWORK_NAME",
    "GROUNDING_ALLOWED_DOMAINS_JSON",
    "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    "GROUNDING_SMOKE_CLAIM",
    "GROUNDING_SMOKE_EXPECTED_VERDICT",
    "GROUNDING_DEPLOYMENT_OUTPUT",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const relativeOutput = `artifacts/deploy-script-existing-${process.pid}.json`;
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(relativeOutput, "{}\n", "utf8");

  process.env.GROUNDING_EXPECTED_CHAIN_ID = "61999";
  process.env.GROUNDING_EXPECTED_NETWORK_NAME = "Mock StudioNet";
  process.env.GROUNDING_ALLOWED_DOMAINS_JSON = '["example.com"]';
  process.env.GROUNDING_SMOKE_SOURCE_URLS_JSON =
    '["https://example.com/"]';
  process.env.GROUNDING_SMOKE_CLAIM = "A sufficiently long atomic claim.";
  process.env.GROUNDING_SMOKE_EXPECTED_VERDICT = "SUPPORTED";
  process.env.GROUNDING_DEPLOYMENT_OUTPUT = relativeOutput;

  let initialized = false;
  const client = {
    chain: { id: 61999, name: "Mock StudioNet" },
    async initializeConsensusSmartContract() {
      initialized = true;
    },
  };

  try {
    await assert.rejects(
      () => deployAndSmoke(client),
      /already exists and will not be overwritten/,
    );
    assert.equal(initialized, false);
  } finally {
    rmSync(relativeOutput, { force: true });
    for (const name of envNames) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});
