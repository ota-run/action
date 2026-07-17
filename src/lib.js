//                █████
//               ░░███
//       ██████  ███████    ██████
//      ███░░███░░░███░    ░░░░░███
//     ░███ ░███  ░███      ███████
//     ░███ ░███  ░███ ███ ███░░███
//     ░░██████   ░░█████ ░░████████
//      ░░░░░░     ░░░░░   ░░░░░░░░
//
//   Copyright (C) 2026 — 2026, Ota. All Rights Reserved.
//
//   DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
//
//   Licensed under the Apache License, Version 2.0. See LICENSE for the full license text.
//   You may not use this file except in compliance with that License.
//   Unless required by applicable law or agreed to in writing, software distributed under the
//   License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
//   either express or implied. See the License for the specific language governing permissions
//   and limitations under the License.
//
//   If you need additional information or have any questions, please email: os@ota.run

import path from "node:path";

const COMMENT_MARKER = "<!-- ota-action -->";
const CI_WORKFLOW_DRIFT_CODES = new Set([
  "OTA_CI_BOOTSTRAP_TRUTH_DRIFT",
  "OTA_CI_BOOTSTRAP_TRUTH_DUPLICATED",
  "OTA_CI_VERIFICATION_DRIFT",
  "OTA_CI_VERIFICATION_REMOVED"
]);

function getEnvValue(env, key) {
  const direct = env[key];
  if (direct !== undefined) {
    return direct;
  }

  const normalizedKey = String(key).toLowerCase();
  for (const candidateKey of Object.keys(env)) {
    if (candidateKey.toLowerCase() === normalizedKey) {
      return env[candidateKey];
    }
  }

  return undefined;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseInstallMode(value) {
  const mode = String(value ?? "auto").trim().toLowerCase() || "auto";
  if (mode !== "auto" && mode !== "always" && mode !== "never") {
    throw new Error(`unsupported install mode: ${mode}`);
  }
  return mode;
}

function parseSourceMode(value) {
  const mode = String(value ?? "explicit").trim().toLowerCase() || "explicit";
  if (mode !== "explicit" && mode !== "contract") {
    throw new Error(`unsupported source mode: ${mode}`);
  }
  return mode;
}

function stripWrappingQuotes(value) {
  const text = String(value ?? "");
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function stripInlineComment(value) {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let prev = "";

  for (const ch of String(value ?? "")) {
    if (ch === "\"" && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === "#" && !inSingle && !inDouble) {
      break;
    }
    out += ch;
    prev = ch;
  }

  return out.trim();
}

function parseTargetedYamlFields(text, fieldPaths) {
  const targetSet = new Set(fieldPaths);
  const values = new Map();
  const keys = [];
  const indents = [];

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }

    let indent = 0;
    while (indent < rawLine.length && rawLine[indent] === " ") {
      indent += 1;
    }

    const trimmed = rawLine.slice(indent);
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    if (!key || key.startsWith("#") || key.startsWith("-")) {
      continue;
    }

    const rawValue = stripInlineComment(trimmed.slice(colonIndex + 1));

    while (indents.length > 0 && indents[indents.length - 1] >= indent) {
      indents.pop();
      keys.pop();
    }

    indents.push(indent);
    keys.push(key);

    if (!rawValue) {
      continue;
    }

    const fieldPath = keys.join(".");
    if (targetSet.has(fieldPath)) {
      values.set(fieldPath, stripWrappingQuotes(rawValue));
    }
  }

  return values;
}

function inferBootstrapSourceFromCommand(command) {
  const text = String(command ?? "");
  const matchers = [
    { kind: "branch", patterns: ["OTA_GIT_BRANCH", "\\$env:OTA_GIT_BRANCH"] },
    { kind: "git_rev", patterns: ["OTA_GIT_REV", "\\$env:OTA_GIT_REV"] },
    { kind: "version", patterns: ["OTA_VERSION", "\\$env:OTA_VERSION"] }
  ];

  for (const matcher of matchers) {
    for (const pattern of matcher.patterns) {
      const regex = new RegExp(`${pattern}\\s*=\\s*['"]?([^'"\\s;|]+)['"]?`);
      const match = text.match(regex);
      if (match) {
        return { kind: matcher.kind, value: match[1] };
      }
    }
  }

  return null;
}

async function resolveBootstrapSourceFromContract(contractPath, fsModule) {
  const stat = await fsModule.stat(contractPath).catch(() => null);
  let resolvedPath = contractPath;
  if (stat?.isDirectory()) {
    resolvedPath = path.join(contractPath, "ota.yaml");
  }

  const contract = await fsModule.readFile(resolvedPath, "utf8").catch((error) => {
    throw new Error(`failed to read contract \`${contractPath}\`: ${error.message}`);
  });

  const values = parseTargetedYamlFields(contract, [
    "agent.bootstrap.ota.source.kind",
    "agent.bootstrap.ota.source.version",
    "agent.bootstrap.ota.source.rev",
    "agent.bootstrap.ota.source.branch",
    "agent.bootstrap.ota.sh",
    "agent.bootstrap.ota.powershell"
  ]);

  let kind = values.get("agent.bootstrap.ota.source.kind") || "";
  let version = values.get("agent.bootstrap.ota.source.version") || "";
  let rev = values.get("agent.bootstrap.ota.source.rev") || "";
  let branch = values.get("agent.bootstrap.ota.source.branch") || "";

  if (!kind) {
    const inferred = inferBootstrapSourceFromCommand(values.get("agent.bootstrap.ota.sh"))
      || inferBootstrapSourceFromCommand(values.get("agent.bootstrap.ota.powershell"));
    if (inferred) {
      kind = inferred.kind;
      if (kind === "version") {
        version = inferred.value;
      } else if (kind === "git_rev") {
        rev = inferred.value;
      } else if (kind === "branch") {
        branch = inferred.value;
      }
    }
  }

  if (kind === "version" && version) {
    return { contractPath: resolvedPath, kind, version: normalizeOtaVersion(version) };
  }
  if (kind === "git_rev" && rev) {
    return { contractPath: resolvedPath, kind, rev };
  }
  if (kind === "branch" && branch) {
    return { contractPath: resolvedPath, kind, branch };
  }

  throw new Error(
    `contract \`${resolvedPath}\` does not declare a usable agent.bootstrap.ota source`
  );
}

function resolveOtaInstallPlan({
  installMode,
  requestedVersion,
  requestedSource,
  preferredExisting,
  preferred
}) {
  if (installMode === "never") {
    if (requestedVersion) {
      return {
        action: "error",
        message: "ota-version requires install=auto or install=always; install=never cannot honor a requested installer version"
      };
    }
    if (preferredExisting) {
      return { action: "use-existing", path: preferredExisting };
    }
    return {
      action: "error",
      message: `ota binary \`${preferred}\` was not found and install=never prevents automatic installation`
    };
  }

  if (installMode === "auto" && preferredExisting && !requestedVersion && !requestedSource) {
    return { action: "use-existing", path: preferredExisting };
  }

  return { action: "install" };
}

function prioritizeRuntimeNodePath(env = process.env, runtimeExecPath = process.execPath) {
  const nodeDir = path.dirname(runtimeExecPath || "");
  if (!nodeDir || !path.isAbsolute(nodeDir)) {
    return env;
  }

  const entries = String(env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const filtered = entries.filter((entry) => entry !== nodeDir);
  const nextPath = filtered.length > 0
    ? `${nodeDir}${path.delimiter}${filtered.join(path.delimiter)}`
    : nodeDir;

  return {
    ...env,
    PATH: nextPath
  };
}

function normalizeOtaVersion(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  const normalized = String(value).trim();
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

function otaBinaryName(platform = process.platform) {
  return platform === "win32" ? "ota.exe" : "ota";
}

function otaInstallDirectories(env = process.env, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const directories = [];
  const otaBinDir = getEnvValue(env, "OTA_BIN_DIR");
  if (otaBinDir) {
    directories.push(otaBinDir);
  }
  const localAppData = getEnvValue(env, "LOCALAPPDATA");
  if (platform === "win32" && localAppData) {
    directories.push(pathApi.join(localAppData, "ota", "bin"));
  }
  const home = getEnvValue(env, "HOME") || (platform === "win32" ? getEnvValue(env, "USERPROFILE") : "");
  if (home) {
    directories.push(pathApi.join(home, ".local", "bin"));
    directories.push(pathApi.join(home, ".cargo", "bin"));
  }
  return [...new Set(directories)];
}

function postInstallBinaryDirectories(env = process.env, platform = process.platform) {
  const directories = [];
  const push = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || directories.includes(normalized)) {
      return;
    }
    directories.push(normalized);
  };

  const otaBinDir = getEnvValue(env, "OTA_BIN_DIR");
  if (otaBinDir) {
    push(otaBinDir);
  }

  const delimiter = platform === "win32" ? path.win32.delimiter : path.posix.delimiter;
  for (const entry of String(getEnvValue(env, "PATH") || "")
    .split(delimiter)
    .map((candidate) => candidate.trim())
    .filter(Boolean)) {
    push(entry);
  }

  for (const directory of otaInstallDirectories(env, platform)) {
    push(directory);
  }

  return directories;
}

function buildOtaArgs(inputs) {
  if (inputs.command !== "doctor" && inputs.command !== "receipt" && inputs.command !== "proof") {
    throw new Error(`unsupported command: ${inputs.command}`);
  }
  if (inputs.executionMode !== "native" && inputs.executionMode !== "container") {
    throw new Error(`unsupported execution mode: ${inputs.executionMode}`);
  }

  const command = inputs.command;
  const args = command === "proof"
    ? ["proof", "runtime", "--json"]
    : [command, "--json"];

  if (command === "receipt" && parseBoolean(inputs.archive, true) && !inputs.baseline) {
    args.push("--archive");
  }

  if (command === "receipt" && inputs.baseline) {
    args.push("--baseline", inputs.baseline);
  }

  if (command === "receipt" && parseBoolean(inputs.failOnNewBlockers, false) && inputs.baseline) {
    args.push("--fail-on-new-blockers");
  }

  if (inputs.executionMode) {
    args.push("--mode", inputs.executionMode);
  }

  if (inputs.workflow) {
    args.push("--workflow", inputs.workflow);
  }

  if (inputs.member) {
    args.push("--member", inputs.member);
  }

  if (inputs.path) {
    args.push(inputs.path);
  }

  return args;
}

function parseOtaPayload(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    const detail = stdout.trim().slice(0, 500);
    throw new Error(`failed to parse Ota JSON output: ${error.message}${detail ? `\n${detail}` : ""}`);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Ota JSON output was not an object");
  }

  return payload;
}

function isValidateFailure(payload) {
  return payload.ok === false && (typeof payload.error === "string" || Array.isArray(payload.errors));
}

function isReceiptDiffPayload(payload) {
  return payload?.mode === "diff"
    && payload.baseline
    && payload.current
    && payload.summary
    && Array.isArray(payload.introduced)
    && Array.isArray(payload.resolved)
    && Array.isArray(payload.unchanged);
}

function inferKind(payload) {
  if (isValidateFailure(payload)) {
    return "validate_failure";
  }
  if (isReceiptDiffPayload(payload)) {
    return "receipt_diff";
  }
  if (payload.mode === "receipt" && payload.receipt) {
    return "receipt";
  }
  if (payload.mode === "runtime-proof" && payload.summary && typeof payload.path === "string") {
    return "proof";
  }
  if (payload.summary && Array.isArray(payload.findings) && typeof payload.mode === "string") {
    return "doctor";
  }
  throw new Error("unsupported Ota JSON shape for this action");
}

function annotationModeForKind(kind) {
  switch (kind) {
    case "doctor":
      return "doctor";
    case "receipt_diff":
      return "receipt-diff";
    default:
      return "";
  }
}

function normalizeSummary(payload, kind) {
  if (kind === "validate_failure") {
    return {
      errorCount: Array.isArray(payload.errors) ? payload.errors.length : 1,
      warnCount: 0,
      infoCount: 0,
      verdict: "not_ready",
      primaryBlocker: {
        summary: payload.error || payload.errors?.[0] || "Contract load or validation failed",
        why: payload.error || payload.errors?.join("; ") || "Ota could not load the requested contract",
        next: "fix the contract and rerun Ota"
      }
    };
  }

  if (kind === "receipt_diff") {
    const currentSummary = payload.current?.summary || {};
    const introduced = payload.summary?.introduced || {};
    const resolved = payload.summary?.resolved || {};
    const unchanged = payload.summary?.unchanged || {};
    const gate = payload.gate && typeof payload.gate === "object"
      ? {
        rule: payload.gate.rule || "",
        passed: Boolean(payload.gate.passed),
        newBlockerCount: Number(payload.gate.new_blocker_count ?? 0)
      }
      : null;

    let verdict = "ready";
    if (gate) {
      if (!gate.passed) {
        verdict = "not_ready";
      } else if (
        !payload.current?.ok
        || (currentSummary.warn_count ?? 0) > 0
        || (introduced.warn_count ?? 0) > 0
      ) {
        verdict = "risky";
      }
    } else if (!payload.current?.ok) {
      verdict = "not_ready";
    } else if ((currentSummary.warn_count ?? 0) > 0 || (introduced.warn_count ?? 0) > 0) {
      verdict = "risky";
    }

    return {
      errorCount: currentSummary.error_count ?? 0,
      warnCount: currentSummary.warn_count ?? 0,
      infoCount: currentSummary.info_count ?? 0,
      verdict,
      primaryBlocker: null,
      currentOk: Boolean(payload.current?.ok),
      baselineOk: Boolean(payload.baseline?.ok),
      gate,
      introduced: {
        count: introduced.count ?? 0,
        errorCount: introduced.error_count ?? 0,
        warnCount: introduced.warn_count ?? 0,
        infoCount: introduced.info_count ?? 0
      },
      resolved: {
        count: resolved.count ?? 0,
        errorCount: resolved.error_count ?? 0,
        warnCount: resolved.warn_count ?? 0,
        infoCount: resolved.info_count ?? 0
      },
      unchanged: {
        count: unchanged.count ?? 0,
        errorCount: unchanged.error_count ?? 0,
        warnCount: unchanged.warn_count ?? 0,
        infoCount: unchanged.info_count ?? 0
      }
    };
  }

  return {
    errorCount: payload.summary?.error_count ?? 0,
    warnCount: payload.summary?.warn_count ?? 0,
    infoCount: payload.summary?.info_count ?? 0,
    verdict: payload.summary?.verdict ?? (payload.ok ? "ready" : "not_ready"),
    primaryBlocker: payload.summary?.primary_blocker ?? null
  };
}

function deriveStatus(kind, summary) {
  if (kind === "validate_failure") {
    return "blocked";
  }

  switch (summary.verdict) {
    case "ready":
      return "ready";
    case "risky":
      return "risky";
    default:
      return "blocked";
  }
}

function ciWorkflowDrift(payload) {
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  const findingCodes = findings
    .map((finding) => finding?.code)
    .filter((code) => CI_WORKFLOW_DRIFT_CODES.has(code));
  const mergeGateState = payload?.governance?.merge_gate?.state || "";

  return {
    detected: mergeGateState === "drift_detected" || findingCodes.length > 0,
    mergeGateState,
    findingCodes
  };
}

function topFinding(payload, kind) {
  if (kind === "validate_failure") {
    return normalizeSummary(payload, kind).primaryBlocker;
  }

  if (kind === "receipt_diff") {
    const introduced = Array.isArray(payload.introduced) ? payload.introduced : [];
    if (payload.gate?.passed === false) {
      return introduced.find((finding) => finding?.severity === "error") || introduced[0] || null;
    }
    return introduced[0] || null;
  }

  if (payload.summary?.primary_blocker) {
    return payload.summary.primary_blocker;
  }

  if (Array.isArray(payload.findings) && payload.findings.length > 0) {
    return payload.findings[0];
  }

  return null;
}

function normalizeArchivePath(archivePath, cwd, pathModule = path) {
  if (!archivePath || String(archivePath).trim() === "") {
    return "";
  }
  return pathModule.resolve(cwd, archivePath);
}

function normalizeOtaBinInput(otaBin, cwd, pathModule = path) {
  const preferred = otaBin && String(otaBin).trim() !== ""
    ? String(otaBin)
    : "ota";

  if (
    preferred.includes("/")
    || preferred.includes("\\")
    || pathModule.isAbsolute(preferred)
  ) {
    return pathModule.resolve(cwd, preferred);
  }

  return preferred;
}

function selectPullRequestNumberForComment({
  payloadPullRequest,
  commentPrOnly,
  associatedPullRequests = []
}) {
  if (typeof payloadPullRequest?.number === "number") {
    return payloadPullRequest.number;
  }

  if (commentPrOnly) {
    return null;
  }

  const openPullRequest = associatedPullRequests.find(
    (pullRequest) => pullRequest?.state === "open" && typeof pullRequest.number === "number"
  );
  if (openPullRequest) {
    return openPullRequest.number;
  }

  const fallbackPullRequest = associatedPullRequests.find(
    (pullRequest) => typeof pullRequest?.number === "number"
  );
  return fallbackPullRequest?.number ?? null;
}

function statusLabel(status) {
  switch (status) {
    case "ready":
      return "READY";
    case "risky":
      return "RISKY";
    default:
      return "BLOCKED";
  }
}

function annotationMethod(severity) {
  switch (severity) {
    case "error":
      return "error";
    case "warn":
      return "warning";
    default:
      return "notice";
  }
}

function findingsForAnnotations(payload, kind, { ciWorkflowDriftOnly = false } = {}) {
  if (kind === "validate_failure") {
    const messages = [];
    if (payload.error) {
      messages.push(payload.error);
    }
    if (Array.isArray(payload.errors)) {
      messages.push(...payload.errors);
    }
    return messages.map((message) => ({
      severity: "error",
      summary: "Contract load or validation failed",
      why: message,
      next: "fix the contract and rerun Ota"
    }));
  }

  if (kind === "receipt_diff") {
    return Array.isArray(payload.introduced) ? payload.introduced : [];
  }

  if (kind === "proof") {
    return [];
  }

  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  if (!ciWorkflowDriftOnly) {
    return findings;
  }

  return findings.filter((finding) => CI_WORKFLOW_DRIFT_CODES.has(finding?.code));
}

function artifactFiles(outputPath, archivePath) {
  const files = [outputPath];
  if (archivePath && path.resolve(archivePath) !== path.resolve(outputPath)) {
    files.push(archivePath);
  }
  return files;
}

function proofArtifactPaths(payload, cwd, pathModule = path) {
  if (!payload || payload.mode !== "runtime-proof" || !payload.artifacts || typeof payload.artifacts !== "object") {
    return [];
  }

  const files = [];
  for (const value of Object.values(payload.artifacts)) {
    if (typeof value !== "string" || value.trim() === "") {
      continue;
    }
    files.push(pathModule.resolve(cwd, value));
  }
  return [...new Set(files)];
}

function commonRootDirectory(files, pathModule = path) {
  const resolved = files.map((file) => pathModule.resolve(file));
  if (resolved.length === 0) {
    throw new Error("at least one artifact file is required");
  }
  if (resolved.length === 1) {
    return pathModule.dirname(resolved[0]);
  }

  const parsed = resolved.map((file) => ({
    root: pathModule.parse(file).root,
    parts: pathModule.dirname(file).slice(pathModule.parse(file).root.length).split(pathModule.sep).filter(Boolean)
  }));
  const roots = [...new Set(parsed.map((entry) => entry.root))];
  if (roots.length > 1) {
    throw new Error("artifact files must share the same filesystem root");
  }

  const split = parsed.map((entry) => entry.parts);
  const shared = [];
  const maxDepth = Math.min(...split.map((parts) => parts.length));

  for (let index = 0; index < maxDepth; index += 1) {
    const value = split[0][index];
    if (split.every((parts) => parts[index] === value)) {
      shared.push(value);
      continue;
    }
    break;
  }

  const firstRoot = parsed[0].root;
  return shared.length === 0 ? firstRoot : pathModule.join(firstRoot, ...shared);
}

function runUrlFromEnv(env) {
  if (!env.GITHUB_SERVER_URL || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) {
    return null;
  }
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function defaultBaselineArtifactName({
  command,
  baseline,
  baselineArtifactName,
  artifactName,
  eventName
}) {
  if (command !== "receipt") {
    return "";
  }
  if (baseline || baselineArtifactName) {
    return "";
  }
  if (eventName !== "pull_request") {
    return "";
  }
  return artifactName || "";
}

function pushBaselineProvenanceLines(lines, baseline) {
  if (!baseline || typeof baseline !== "object") {
    return;
  }

  lines.push(`- Source: \`${baseline.source || "unknown"}\``);

  if (baseline.selection_path) {
    lines.push(`- Selection: \`${baseline.selection_path}\``);
  }
  if (baseline.archive_path) {
    lines.push(`- Archive: \`${baseline.archive_path}\``);
  }
  if (baseline.promoted_at) {
    lines.push(`- Promoted: \`${baseline.promoted_at}\``);
  }
  if (baseline.archived_at) {
    lines.push(`- Archived: \`${baseline.archived_at}\``);
  }
}

function outcomeText({ kind, status, summary }) {
  if (kind === "validate_failure") {
    return "Ota could not load or validate the requested contract.";
  }

  if (kind === "receipt_diff") {
    if (summary.gate && !summary.gate.passed) {
      return "New blocker findings were introduced against the baseline.";
    }
    if (!summary.currentOk) {
      return "No new blockers were introduced, but the current receipt is still not ready.";
    }
    if (status === "risky") {
      return "The receipt gate passed, but warnings still need review.";
    }
    return "The current receipt is ready and no new blockers were introduced.";
  }

  if (status === "blocked") {
    return "Ota reported blocker findings.";
  }
  if (status === "risky") {
    return "Ota reported warnings that still need review.";
  }
  return "Ota reported a ready result.";
}

function primaryHeading(kind, status, primary) {
  if (!primary) {
    return null;
  }
  if (kind === "receipt_diff" && status !== "blocked") {
    return "### Primary change";
  }
  if (status === "blocked" || primary.severity === "error") {
    return "### Primary blocker";
  }
  return "### Primary finding";
}

function nextSteps({ kind, status, summary, primary }) {
  if (primary?.next) {
    return [primary.next];
  }
  if (kind === "receipt_diff" && summary.gate && !summary.gate.passed) {
    return ["Review the introduced blocker findings in the Ota output and address them before merging."];
  }
  if (kind === "receipt_diff" && !summary.currentOk) {
    return ["Review the current receipt debt before treating this baseline as healthy."];
  }
  if (status === "risky") {
    return ["Review the warnings in the Ota output before promoting this result."];
  }
  if (status === "blocked") {
    return ["Review the blocker findings in the Ota output and rerun Ota."];
  }
  return [];
}

function buildSummaryMarkdown({
  commandLine,
  payload,
  kind,
  status,
  summary,
  archivePath,
  artifactName,
  outputPath,
  runUrl,
  baselineInfo,
  proofArtifacts,
  ciWorkflowDriftGate
}) {
  const lines = [];
  lines.push("## Ota");
  lines.push("");
  lines.push(`Status: **${statusLabel(status)}**`);
  lines.push(`Outcome: ${outcomeText({ kind, status, summary })}`);
  lines.push("");
  lines.push("### References");
  lines.push("");
  lines.push(`- Command: \`${commandLine}\``);
  lines.push(`- Output JSON: \`${outputPath}\``);
  if (archivePath) {
    lines.push(`- Current archive: \`${archivePath}\``);
  }
  if (artifactName) {
    lines.push(`- Artifact: \`${artifactName}\`${runUrl ? ` in [this run](${runUrl})` : ""}`);
  }
  if (proofArtifacts?.topology) {
    lines.push(`- Topology: \`${proofArtifacts.topology}\``);
  }
  if (proofArtifacts?.doctor) {
    lines.push(`- Doctor: \`${proofArtifacts.doctor}\``);
  }
  if (proofArtifacts?.upLog) {
    lines.push(`- Up log: \`${proofArtifacts.upLog}\``);
  }
  if (baselineInfo?.artifactName && kind !== "receipt_diff") {
    if (baselineInfo.restored) {
      lines.push(`- Baseline restore: \`${baselineInfo.artifactName}\` -> \`${baselineInfo.path}\``);
    } else {
      lines.push(`- Baseline restore: none from \`${baselineInfo.artifactName}\`; current receipt only`);
    }
  }
  if (kind === "receipt_diff") {
    lines.push("");
    lines.push("### Baseline");
    lines.push("");
    if (summary.gate) {
      lines.push(`- Gate: **${summary.gate.passed ? "PASSED" : "BLOCKED"}** \`${summary.gate.rule}\``);
    }
    lines.push(`- Current receipt: **${payload.current?.ok ? "READY" : "NOT READY"}**`);
    lines.push(`- Diff: introduced ${summary.introduced.count}, resolved ${summary.resolved.count}, unchanged ${summary.unchanged.count}`);
    pushBaselineProvenanceLines(lines, payload.baseline);
  }

  if (ciWorkflowDriftGate?.enabled) {
    lines.push("");
    lines.push("### CI workflow drift gate");
    lines.push("");
    lines.push(`- Result: **${ciWorkflowDriftGate.detected ? "BLOCKED" : "PASSED"}**`);
    if (ciWorkflowDriftGate.mergeGateState) {
      lines.push(`- Merge gate: \`${ciWorkflowDriftGate.mergeGateState}\``);
    }
    if (ciWorkflowDriftGate.findingCodes.length > 0) {
      lines.push(`- Findings: ${ciWorkflowDriftGate.findingCodes.map((code) => `\`${code}\``).join(", ")}`);
    }
  }

  const primary = topFinding(payload, kind);
  if (primary) {
    lines.push("");
    lines.push(primaryHeading(kind, status, primary));
    lines.push("");
    lines.push(`**${primary.summary}**`);
    if (primary.why) {
      lines.push("");
      lines.push(`Why: ${primary.why}`);
    }
  }

  const actions = nextSteps({ kind, status, summary, primary });
  if (actions.length > 0) {
    lines.push("");
    lines.push("### Next steps");
    lines.push("");
    for (const action of actions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push("");
  lines.push("### Counts");
  lines.push("");
  lines.push(`- Errors: ${summary.errorCount}`);
  lines.push(`- Warnings: ${summary.warnCount}`);
  lines.push(`- Info: ${summary.infoCount}`);
  if (kind === "receipt_diff") {
    lines.push(`- Introduced errors: ${summary.introduced.errorCount}`);
    lines.push(`- Introduced warnings: ${summary.introduced.warnCount}`);
    lines.push(`- Introduced info: ${summary.introduced.infoCount}`);
  }

  return lines.join("\n");
}

function appendActionReferencesMarkdown(summaryMarkdown, {
  commandLine,
  outputPath,
  archivePath,
  artifactName,
  runUrl,
  baselineInfo,
  kind,
  proofArtifacts,
  ciWorkflowDriftGate
}) {
  const lines = [summaryMarkdown.trimEnd(), "", "### Action references", ""];
  lines.push(`- Command: \`${commandLine}\``);
  lines.push(`- Output JSON: \`${outputPath}\``);
  if (archivePath) {
    lines.push(`- Current archive: \`${archivePath}\``);
  }
  if (artifactName) {
    lines.push(`- Artifact: \`${artifactName}\`${runUrl ? ` in [this run](${runUrl})` : ""}`);
  }
  if (proofArtifacts?.topology) {
    lines.push(`- Topology: \`${proofArtifacts.topology}\``);
  }
  if (proofArtifacts?.doctor) {
    lines.push(`- Doctor: \`${proofArtifacts.doctor}\``);
  }
  if (proofArtifacts?.upLog) {
    lines.push(`- Up log: \`${proofArtifacts.upLog}\``);
  }
  if (baselineInfo?.artifactName && kind !== "receipt_diff") {
    if (baselineInfo.restored) {
      lines.push(`- Baseline restore: \`${baselineInfo.artifactName}\` -> \`${baselineInfo.path}\``);
    } else {
      lines.push(`- Baseline restore: none from \`${baselineInfo.artifactName}\`; current receipt only`);
    }
  }
  if (ciWorkflowDriftGate?.enabled) {
    lines.push(`- CI workflow drift gate: **${ciWorkflowDriftGate.detected ? "BLOCKED" : "PASSED"}**`);
  }
  return lines.join("\n");
}

function buildCommentBody(summaryMarkdown) {
  return `${COMMENT_MARKER}\n${summaryMarkdown}`;
}

export {
  appendActionReferencesMarkdown,
  annotationModeForKind,
  COMMENT_MARKER,
  annotationMethod,
  artifactFiles,
  buildCommentBody,
  buildOtaArgs,
  buildSummaryMarkdown,
  ciWorkflowDrift,
  commonRootDirectory,
  deriveStatus,
  findingsForAnnotations,
  inferKind,
  normalizeArchivePath,
  normalizeOtaBinInput,
  parseSourceMode,
  prioritizeRuntimeNodePath,
  normalizeOtaVersion,
  normalizeSummary,
  otaBinaryName,
  otaInstallDirectories,
  postInstallBinaryDirectories,
  parseBoolean,
  defaultBaselineArtifactName,
  parseInstallMode,
  parseOtaPayload,
  parsePositiveInteger,
  proofArtifactPaths,
  pushBaselineProvenanceLines,
  resolveBootstrapSourceFromContract,
  resolveOtaInstallPlan,
  runUrlFromEnv,
  selectPullRequestNumberForComment,
  statusLabel,
  topFinding
};
