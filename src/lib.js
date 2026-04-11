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
  if (env.OTA_BIN_DIR) {
    directories.push(env.OTA_BIN_DIR);
  }
  if (platform === "win32" && env.LOCALAPPDATA) {
    directories.push(pathApi.join(env.LOCALAPPDATA, "ota", "bin"));
  }
  if (env.HOME) {
    directories.push(pathApi.join(env.HOME, ".local", "bin"));
    directories.push(pathApi.join(env.HOME, ".cargo", "bin"));
  }
  return [...new Set(directories)];
}

function buildOtaArgs(inputs) {
  if (inputs.command !== "doctor" && inputs.command !== "receipt") {
    throw new Error(`unsupported command: ${inputs.command}`);
  }
  if (inputs.executionMode !== "native" && inputs.executionMode !== "container") {
    throw new Error(`unsupported execution mode: ${inputs.executionMode}`);
  }

  const command = inputs.command;
  const args = [command, "--json"];

  if (command === "receipt" && parseBoolean(inputs.archive, true)) {
    args.push("--archive");
  }

  if (inputs.executionMode) {
    args.push("--mode", inputs.executionMode);
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

function inferKind(payload) {
  if (isValidateFailure(payload)) {
    return "validate_failure";
  }
  if (payload.mode === "receipt" && payload.receipt) {
    return "receipt";
  }
  if (payload.summary && Array.isArray(payload.findings) && typeof payload.mode === "string") {
    return "doctor";
  }
  throw new Error("unsupported Ota JSON shape for this action");
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

function topFinding(payload, kind) {
  if (kind === "validate_failure") {
    return null;
  }

  if (payload.summary?.primary_blocker) {
    return payload.summary.primary_blocker;
  }

  if (Array.isArray(payload.findings) && payload.findings.length > 0) {
    return payload.findings[0];
  }

  return null;
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

function findingsForAnnotations(payload, kind) {
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

  return Array.isArray(payload.findings) ? payload.findings : [];
}

function artifactFiles(outputPath, archivePath) {
  const files = [outputPath];
  if (archivePath && path.resolve(archivePath) !== path.resolve(outputPath)) {
    files.push(archivePath);
  }
  return files;
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

function buildSummaryMarkdown({ commandLine, payload, kind, status, summary, archivePath, artifactName, outputPath, runUrl }) {
  const lines = [];
  lines.push("## Ota");
  lines.push("");
  lines.push(`Status: **${statusLabel(status)}**`);
  lines.push(`Command: \`${commandLine}\``);
  lines.push(`Output: \`${outputPath}\``);
  if (archivePath) {
    lines.push(`Archive: \`${archivePath}\``);
  }
  if (artifactName) {
    lines.push(`Artifact: \`${artifactName}\`${runUrl ? ` in [this run](${runUrl})` : ""}`);
  }

  const primary = topFinding(payload, kind);
  if (primary) {
    lines.push("");
    lines.push("### Primary");
    lines.push("");
    lines.push(`**${primary.summary}**`);
    if (primary.why) {
      lines.push("");
      lines.push(`Why: ${primary.why}`);
    }
    if (primary.next) {
      lines.push("");
      lines.push(`Next: ${primary.next}`);
    }
  }

  lines.push("");
  lines.push("### Counts");
  lines.push("");
  lines.push(`- Errors: ${summary.errorCount}`);
  lines.push(`- Warnings: ${summary.warnCount}`);
  lines.push(`- Info: ${summary.infoCount}`);

  return lines.join("\n");
}

function buildCommentBody(summaryMarkdown) {
  return `${COMMENT_MARKER}\n${summaryMarkdown}`;
}

export {
  COMMENT_MARKER,
  annotationMethod,
  artifactFiles,
  buildCommentBody,
  buildOtaArgs,
  buildSummaryMarkdown,
  commonRootDirectory,
  deriveStatus,
  findingsForAnnotations,
  inferKind,
  normalizeOtaVersion,
  normalizeSummary,
  otaBinaryName,
  otaInstallDirectories,
  parseBoolean,
  parseInstallMode,
  parseOtaPayload,
  parsePositiveInteger,
  runUrlFromEnv,
  statusLabel,
  topFinding
};
