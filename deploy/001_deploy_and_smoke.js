import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const CONTRACT_PATH = path.resolve(
  process.cwd(),
  "contracts",
  "AgentOutputGroundingVerifier.py",
);

const STATUS_NAMES = new Map([
  [5, "ACCEPTED"],
  [7, "FINALIZED"],
]);

const RESULT_NAMES = new Map([[6, "MAJORITY_AGREE"]]);
const EXECUTION_NAMES = new Map([[1, "FINISHED_WITH_RETURN"]]);
const VERDICTS = new Set([
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONTRADICTED",
  "INSUFFICIENT_EVIDENCE",
  "SOURCE_UNAVAILABLE",
]);
const RESERVED_HOST_SUFFIXES = [
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".test",
];

function jsonString(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

function envInteger(name, fallback, minimum = 1) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (fallback === undefined) {
      throw new Error(`${name} is required`);
    }
    return fallback;
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be at least ${minimum}`);
  }
  return value;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function stringArray(name, minimum, maximum, maximumCharacters) {
  const raw = requiredEnv(name);
  if (raw.length > maximumCharacters) {
    throw new Error(`${name} exceeds its maximum encoded length`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < minimum ||
    parsed.length > maximum ||
    parsed.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(
      `${name} must contain between ${minimum} and ${maximum} strings`,
    );
  }
  return parsed.map((item) => item.trim());
}

function looksLikeLegacyIpv4(hostname) {
  const labels = hostname.split(".");
  if (labels.length < 1 || labels.length > 4 || labels.some((label) => !label)) {
    return false;
  }
  return labels.every((label) =>
    label.toLowerCase().startsWith("0x")
      ? /^[0-9a-f]+$/.test(label.slice(2))
      : /^[0-9]+$/.test(label),
  );
}

function hostnameIsValid(hostname) {
  if (
    !hostname ||
    hostname.length > 253 ||
    !hostname.includes(".") ||
    hostname.startsWith(".") ||
    hostname.endsWith(".") ||
    hostname === "localhost" ||
    looksLikeLegacyIpv4(hostname) ||
    RESERVED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return false;
  }
  return hostname.split(".").every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[a-z0-9-]+$/.test(label),
  );
}

function canonicalDomainArray() {
  const domains = stringArray(
    "GROUNDING_ALLOWED_DOMAINS_JSON",
    1,
    32,
    8_194,
  ).map((domain) => domain.toLowerCase());
  if (
    domains.some(
      (domain) =>
        !hostnameIsValid(domain) ||
        domain.includes("://") ||
        /[/?#:@]/.test(domain),
    )
  ) {
    throw new Error(
      "GROUNDING_ALLOWED_DOMAINS_JSON must contain plain public hostnames",
    );
  }
  if (new Set(domains).size !== domains.length) {
    throw new Error(
      "GROUNDING_ALLOWED_DOMAINS_JSON must remain unique after lowercasing",
    );
  }
  domains.sort();
  return domains;
}

function hasProhibitedTextControl(value) {
  for (const character of value) {
    const codepoint = character.codePointAt(0);
    if (
      codepoint < 32 ||
      (codepoint >= 127 && codepoint <= 159) ||
      (codepoint >= 0xd800 && codepoint <= 0xdfff)
    ) {
      return true;
    }
  }
  return false;
}

function canonicalSourceArray(allowedDomains) {
  const urls = stringArray(
    "GROUNDING_SMOKE_SOURCE_URLS_JSON",
    1,
    3,
    6_200,
  ).map((url) => {
    if (url.length > 2_048 || hasProhibitedTextControl(url) || /\s/.test(url)) {
      throw new Error(
        "GROUNDING_SMOKE_SOURCE_URLS_JSON contains an invalid URL length or character",
      );
    }
    if (!url.toLowerCase().startsWith("https://")) {
      throw new Error("GROUNDING_SMOKE_SOURCE_URLS_JSON must use HTTPS URLs");
    }
    if (url.includes("?") || url.includes("#")) {
      throw new Error(
        "GROUNDING_SMOKE_SOURCE_URLS_JSON cannot contain queries or fragments",
      );
    }
    const rest = url.slice(8);
    const authority = rest.split(/[/?#]/, 1)[0];
    if (!authority || authority.includes("@") || authority.includes(":")) {
      throw new Error(
        "GROUNDING_SMOKE_SOURCE_URLS_JSON contains an unsupported URL authority",
      );
    }
    const hostname = authority.toLowerCase();
    if (
      !hostnameIsValid(hostname) ||
      !allowedDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    ) {
      throw new Error(
        "GROUNDING_SMOKE_SOURCE_URLS_JSON contains a non-public or unallowlisted hostname",
      );
    }
    return `https://${hostname}${rest.slice(authority.length)}`;
  });
  if (new Set(urls).size !== urls.length) {
    throw new Error(
      "GROUNDING_SMOKE_SOURCE_URLS_JSON must contain unique canonical URLs",
    );
  }
  return JSON.stringify(urls);
}

function normalizedField(value, numericNames) {
  if (typeof value === "number") {
    return numericNames.get(value) || String(value);
  }
  if (typeof value === "bigint") {
    return numericNames.get(Number(value)) || value.toString();
  }
  return String(value || "").trim().toUpperCase();
}

function receiptList(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function executionSucceeded(value) {
  const normalized = normalizedField(value, EXECUTION_NAMES);
  return normalized === "FINISHED_WITH_RETURN" || normalized === "SUCCESS";
}

export function assertPositiveReceipt(receipt, label) {
  const status = normalizedField(
    receipt?.statusName ?? receipt?.status_name ?? receipt?.status,
    STATUS_NAMES,
  );
  if (status !== "ACCEPTED" && status !== "FINALIZED") {
    throw new Error(
      `${label} did not reach an accepted state: ${jsonString(receipt)}`,
    );
  }

  const result = normalizedField(
    receipt?.resultName ?? receipt?.result_name ?? receipt?.result,
    RESULT_NAMES,
  );
  if (result !== "MAJORITY_AGREE") {
    throw new Error(
      `${label} did not reach positive consensus: ${jsonString(receipt)}`,
    );
  }

  const consensus = receipt?.consensus_data || {};
  const leaders = receiptList(consensus.leader_receipt);
  const validators = receiptList(consensus.validators);
  const fallbackExecution = leaders[0]?.execution_result;
  const execution =
    receipt?.txExecutionResultName ??
    receipt?.tx_execution_result_name ??
    receipt?.txExecutionResult ??
    fallbackExecution;
  if (!executionSucceeded(execution)) {
    throw new Error(
      `${label} execution did not succeed: ${jsonString(receipt)}`,
    );
  }

  for (const participant of [...leaders, ...validators]) {
    if (
      participant?.execution_result !== undefined &&
      !executionSucceeded(participant.execution_result)
    ) {
      throw new Error(
        `${label} contains a failed participant execution: ${jsonString(receipt)}`,
      );
    }
  }

}

function deploymentAddress(receipt) {
  const address =
    receipt?.data?.contract_address ||
    receipt?.txDataDecoded?.contractAddress ||
    receipt?.tx_data_decoded?.contract_address;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address)
  ) {
    throw new Error(
      `Deployment receipt has no valid contract address: ${jsonString(receipt)}`,
    );
  }
  return address;
}

function deploymentOutputPath() {
  const configured = process.env.GROUNDING_DEPLOYMENT_OUTPUT?.trim();
  if (!configured) {
    return null;
  }
  const normalized = configured.replace(/[\\/]+/g, path.sep);
  const resolved = path.resolve(process.cwd(), normalized);
  const roots = [
    path.resolve(process.cwd(), "artifacts"),
    path.resolve(process.cwd(), "deployments"),
  ];
  const permitted = roots.some((root) =>
    resolved.startsWith(`${root}${path.sep}`),
  );
  if (!permitted || path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error(
      "GROUNDING_DEPLOYMENT_OUTPUT must be a JSON file under artifacts/ or deployments/",
    );
  }
  if (existsSync(resolved)) {
    throw new Error(
      `GROUNDING_DEPLOYMENT_OUTPUT already exists and will not be overwritten: ${resolved}`,
    );
  }
  return resolved;
}

function writeOutput(result, resolved) {
  if (!resolved) {
    return;
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${jsonString(result)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(`Deployment record written to ${resolved}`);
}

function currentGitState() {
  try {
    const options = {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    };
    const commit = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
    const status = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      options,
    ).trim();
    return {
      commit,
      dirty: status.length > 0,
    };
  } catch {
    return {
      commit: null,
      dirty: null,
    };
  }
}

export default async function deployAndSmoke(client) {
  const expectedChainId = envInteger("GROUNDING_EXPECTED_CHAIN_ID", undefined);
  const selectedChainId = Number(client.chain?.id);
  if (
    !Number.isSafeInteger(selectedChainId) ||
    selectedChainId !== expectedChainId
  ) {
    throw new Error(
      `Selected chain ID ${client.chain?.id ?? "unknown"} does not match ` +
        `GROUNDING_EXPECTED_CHAIN_ID ${expectedChainId}`,
    );
  }

  const outputPath = deploymentOutputPath();
  const allowedDomains = canonicalDomainArray();
  const allowedDomainsJson = JSON.stringify(allowedDomains);
  const sourceUrlsJson = canonicalSourceArray(allowedDomains);
  const claim = requiredEnv("GROUNDING_SMOKE_CLAIM");
  const claimCodepoints = Array.from(claim).length;
  if (
    claimCodepoints < 4 ||
    claimCodepoints > 1_000 ||
    hasProhibitedTextControl(claim)
  ) {
    throw new Error(
      "GROUNDING_SMOKE_CLAIM must contain 4-1000 characters without controls",
    );
  }
  const expectedVerdict = requiredEnv(
    "GROUNDING_SMOKE_EXPECTED_VERDICT",
  ).toUpperCase();
  if (!VERDICTS.has(expectedVerdict)) {
    throw new Error(
      "GROUNDING_SMOKE_EXPECTED_VERDICT is not a contract verdict",
    );
  }
  const waitStatus =
    process.env.GROUNDING_WAIT_STATUS?.trim().toUpperCase() || "ACCEPTED";
  if (waitStatus !== "ACCEPTED" && waitStatus !== "FINALIZED") {
    throw new Error("GROUNDING_WAIT_STATUS must be ACCEPTED or FINALIZED");
  }
  const retries = envInteger("GROUNDING_WAIT_RETRIES", 200);
  const interval = envInteger("GROUNDING_WAIT_INTERVAL_MS", 5_000, 100);

  const contractCode = readFileSync(CONTRACT_PATH, "utf8");
  if (!contractCode.trim()) {
    throw new Error(`Contract is empty: ${CONTRACT_PATH}`);
  }

  await client.initializeConsensusSmartContract();
  const deploymentHash = await client.deployContract({
    code: contractCode,
    args: [allowedDomainsJson],
    leaderOnly: false,
  });
  const deploymentReceipt = await client.waitForTransactionReceipt({
    hash: deploymentHash,
    status: waitStatus,
    retries,
    interval,
  });
  assertPositiveReceipt(deploymentReceipt, "Deployment");
  const contractAddress = deploymentAddress(deploymentReceipt);
  const readVariant =
    waitStatus === "FINALIZED" ? "latest-final" : "latest-nonfinal";

  const deployedCode = await client.getContractCode(contractAddress);
  if (deployedCode !== contractCode) {
    throw new Error("Deployed contract source does not match the local source");
  }
  const schema = await client.getContractSchema(contractAddress);
  const requiredMethods = new Map([
    ["get_policy", true],
    ["get_source_results", true],
    ["get_verification", true],
    ["get_verification_count", true],
    ["verify_claim", false],
  ]);
  const constructorParam = schema?.ctor?.params?.[0];
  if (
    schema?.ctor?.params?.length !== 1 ||
    constructorParam?.[0] !== "allowed_domains_json" ||
    constructorParam?.[1] !== "string"
  ) {
    throw new Error(`Unexpected deployed constructor schema: ${jsonString(schema)}`);
  }
  for (const [methodName, readonly] of requiredMethods) {
    const method = schema?.methods?.[methodName];
    if (!method || Boolean(method.readonly) !== readonly) {
      throw new Error(`Unexpected deployed method schema: ${jsonString(schema)}`);
    }
  }

  const policy = await client.readContract({
    address: contractAddress,
    functionName: "get_policy",
    args: [],
    jsonSafeReturn: true,
    transactionHashVariant: readVariant,
  });
  if (policy?.policy_version !== "GROUNDING_V1") {
    throw new Error(`Unexpected deployed policy: ${jsonString(policy)}`);
  }
  if (policy?.allowed_domains_json !== allowedDomainsJson) {
    throw new Error(`Unexpected deployed allowlist: ${jsonString(policy)}`);
  }

  const initialVerificationCount = await client.readContract({
    address: contractAddress,
    functionName: "get_verification_count",
    args: [],
    jsonSafeReturn: false,
    transactionHashVariant: readVariant,
  });
  if (Number(initialVerificationCount) !== 0) {
    throw new Error(
      `Fresh deployment should contain zero records, received ${initialVerificationCount}`,
    );
  }

  const verificationHash = await client.writeContract({
    address: contractAddress,
    functionName: "verify_claim",
    args: [claim, sourceUrlsJson],
    value: 0n,
    leaderOnly: false,
  });
  const verificationReceipt = await client.waitForTransactionReceipt({
    hash: verificationHash,
    status: waitStatus,
    retries,
    interval,
  });
  assertPositiveReceipt(verificationReceipt, "Verification");

  const verificationId = await client.readContract({
    address: contractAddress,
    functionName: "get_verification_count",
    args: [],
    jsonSafeReturn: false,
    transactionHashVariant: readVariant,
  });
  if (Number(verificationId) !== 1) {
    throw new Error(
      `Fresh deployment should contain verification ID 1, received ${verificationId}`,
    );
  }
  const record = await client.readContract({
    address: contractAddress,
    functionName: "get_verification",
    args: [verificationId],
    jsonSafeReturn: true,
    transactionHashVariant: readVariant,
  });
  if (record?.verdict !== expectedVerdict) {
    throw new Error(
      `Expected verdict ${expectedVerdict}, received ${record?.verdict}: ${jsonString(record)}`,
    );
  }
  if (record?.claim !== claim || record?.sources_json !== sourceUrlsJson) {
    throw new Error(
      `Stored verification is not bound to this smoke request: ${jsonString(record)}`,
    );
  }
  const sourceCount = Number(record?.source_count);
  if (
    record?.policy_version !== "GROUNDING_V1" ||
    !Number.isInteger(sourceCount) ||
    sourceCount !== JSON.parse(sourceUrlsJson).length ||
    sourceCount < 1 ||
    sourceCount > 3
  ) {
    throw new Error(
      `Stored verification record is invalid: ${jsonString(record)}`,
    );
  }

  const gitState = currentGitState();
  const result = {
    network: client.chain?.name || "unknown",
    chain_id: client.chain?.id ?? null,
    explorer: client.chain?.blockExplorers?.default?.url ?? null,
    wait_status: waitStatus,
    git_commit: gitState.commit,
    git_dirty: gitState.dirty,
    source_commit:
      gitState.commit && gitState.dirty === false ? gitState.commit : null,
    contract_sha256: createHash("sha256")
      .update(contractCode, "utf8")
      .digest("hex"),
    contract_address: contractAddress,
    deployment_transaction: deploymentHash,
    verification_transaction: verificationHash,
    verification_id: verificationId,
    verdict: record.verdict,
    reason_code: record.reason_code,
    policy_version: record.policy_version,
    allowed_domains_json: allowedDomainsJson,
    source_urls_json: sourceUrlsJson,
    schema_methods: [...requiredMethods.keys()],
  };
  writeOutput(result, outputPath);
  console.log(`GROUNDING_DEPLOYMENT_RESULT=${jsonString(result)}`);
  return result;
}
