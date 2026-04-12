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

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import * as core from "@actions/core";
import { DefaultArtifactClient } from "@actions/artifact";
import * as github from "@actions/github";

import {
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
  normalizeArchivePath,
  normalizeOtaBinInput,
  normalizeOtaVersion,
  normalizeSummary,
  otaBinaryName,
  otaInstallDirectories,
  parseBoolean,
  parseInstallMode,
  parseOtaPayload,
  parsePositiveInteger,
  runUrlFromEnv,
  selectPullRequestNumberForComment,
  shouldRetryReceiptWithoutArchive,
  topFinding
} from "./lib.js";

async function runCommand(bin, args, cwd, env = process.env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

function pathEntries(env = process.env) {
  return String(env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function executableCandidates(bin, env = process.env, platform = process.platform) {
  const pathLike = bin.includes("/") || bin.includes("\\") || path.isAbsolute(bin);
  const extensions = platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
      .split(";")
      .filter(Boolean)
    : [""];

  const withExtensions = (base) => {
    if (platform !== "win32" || path.extname(base)) {
      return [base];
    }
    return extensions.map((ext) => `${base}${ext.toLowerCase()}`);
  };

  if (pathLike) {
    return withExtensions(path.resolve(bin));
  }

  return pathEntries(env).flatMap((entry) => withExtensions(path.join(entry, bin)));
}

function isPathLike(bin) {
  return bin.includes("/") || bin.includes("\\") || path.isAbsolute(bin);
}

async function resolveExistingBinary(bin, env = process.env, platform = process.platform) {
  for (const candidate of executableCandidates(bin, env, platform)) {
    try {
      await fs.access(candidate, fsSync.constants.F_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function installOta(version, cwd) {
  const env = { ...process.env };
  if (version) {
    env.OTA_VERSION = version;
  }

  if (process.platform === "win32") {
    return await runCommand(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "irm https://dist.ota.run/install.ps1 | iex"],
      cwd,
      env
    );
  }

  return await runCommand(
    "sh",
    ["-c", "curl -fsSL https://dist.ota.run/install.sh | sh"],
    cwd,
    env
  );
}

async function ensureOtaBinary(inputs, cwd) {
  const installMode = parseInstallMode(inputs.install);
  const requestedVersion = normalizeOtaVersion(inputs.otaVersion);
  const preferred = normalizeOtaBinInput(inputs.otaBin, cwd);
  const binaryName = otaBinaryName();
  const effectiveInstallMode = requestedVersion && installMode === "auto" ? "always" : installMode;
  const preferredExisting = await resolveExistingBinary(preferred);

  if (installMode === "never") {
    if (requestedVersion) {
      throw new Error("ota-version requires install=auto or install=always; install=never cannot honor a requested installer version");
    }
    if (preferredExisting) {
      return preferredExisting;
    }
    throw new Error(
      `ota binary \`${preferred}\` was not found and install=never prevents automatic installation`
    );
  }

  if (effectiveInstallMode === "auto" && preferredExisting) {
    core.info(`Using existing ota binary at ${preferredExisting}`);
    return preferredExisting;
  }

  core.info(
    `Installing ota ${requestedVersion || "latest"} via the official installer (${effectiveInstallMode} mode)`
  );

  const installResult = await installOta(requestedVersion, cwd);
  if (installResult.stdout.trim()) {
    core.info(installResult.stdout.trim());
  }
  if (installResult.stderr.trim()) {
    core.info(installResult.stderr.trim());
  }
  if (installResult.exitCode !== 0) {
    throw new Error(`failed to install ota (exit code ${installResult.exitCode})`);
  }

  if (isPathLike(preferred)) {
    const explicitPath = await resolveExistingBinary(preferred);
    if (explicitPath) {
      core.info(`Using ota binary at ${explicitPath}`);
      return explicitPath;
    }
  }

  for (const directory of otaInstallDirectories()) {
    const candidate = path.join(directory, binaryName);
    try {
      await fs.access(candidate, fsSync.constants.F_OK);
      core.addPath(directory);
      core.info(`Using ota binary at ${candidate}`);
      return candidate;
    } catch {
      continue;
    }
  }

  const discovered = await resolveExistingBinary(preferred) ?? await resolveExistingBinary(binaryName);
  if (discovered) {
    core.info(`Using ota binary at ${discovered}`);
    return discovered;
  }

  throw new Error(
    "ota installation completed but no runnable ota binary was found on PATH or in the standard install locations"
  );
}

async function uploadArtifacts(artifactName, files, retentionDays) {
  const client = new DefaultArtifactClient();
  const rootDirectory = commonRootDirectory(files);
  const options = retentionDays ? { retentionDays } : {};
  await client.uploadArtifact(artifactName, files, rootDirectory, options);
}

async function upsertPullRequestComment(token, commentPrOnly, body) {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const issueNumber = await resolvePullRequestNumber(token, commentPrOnly);
  if (!issueNumber) {
    return false;
  }

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100
  });

  const existing = comments.find((comment) => comment.body && comment.body.includes(COMMENT_MARKER));
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body
    });
    return true;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body
  });

  return true;
}

async function resolvePullRequestNumber(token, commentPrOnly) {
  const payloadPullRequest = github.context.payload.pull_request;
  const directNumber = selectPullRequestNumberForComment({
    payloadPullRequest,
    commentPrOnly
  });
  if (directNumber) {
    return directNumber;
  }

  if (commentPrOnly || !github.context.sha) {
    return null;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const response = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: github.context.sha
  });

  return selectPullRequestNumberForComment({
    payloadPullRequest,
    commentPrOnly,
    associatedPullRequests: response.data
  });
}

async function main() {
  const inputs = {
    command: core.getInput("command") || "receipt",
    path: core.getInput("path") || ".",
    workingDirectory: core.getInput("working-directory") || ".",
    executionMode: core.getInput("execution-mode") || "native",
    member: core.getInput("member"),
    archive: core.getInput("archive"),
    annotate: core.getInput("annotate"),
    maxAnnotations: core.getInput("max-annotations"),
    commentPr: core.getInput("comment-pr"),
    commentPrOnly: core.getInput("comment-pr-only"),
    artifactName: core.getInput("artifact-name") || "ota-report",
    artifactRetentionDays: core.getInput("artifact-retention-days"),
    failOnError: core.getInput("fail-on-error"),
    install: core.getInput("install") || "auto",
    otaVersion: core.getInput("ota-version"),
    otaBin: core.getInput("ota-bin") || "ota",
    outputPath: core.getInput("output-path") || ".ota-action-output.json",
    githubToken: core.getInput("github-token")
  };

  const cwd = path.resolve(inputs.workingDirectory);
  const outputPath = path.resolve(cwd, inputs.outputPath);
  const otaBinary = await ensureOtaBinary(inputs, cwd);
  let effectiveInputs = { ...inputs };
  let args = buildOtaArgs(effectiveInputs);
  let commandLine = `${otaBinary} ${args.join(" ")}`;

  core.info(`Running ${commandLine} in ${cwd}`);

  let result = await runCommand(otaBinary, args, cwd);
  if (shouldRetryReceiptWithoutArchive(effectiveInputs, result)) {
    core.notice(
      "Installed ota does not support `ota receipt --archive`; retrying without archived receipt output"
    );
    effectiveInputs = { ...effectiveInputs, archive: "false" };
    args = buildOtaArgs(effectiveInputs);
    commandLine = `${otaBinary} ${args.join(" ")}`;
    core.info(`Retrying ${commandLine} in ${cwd}`);
    result = await runCommand(otaBinary, args, cwd);
  }

  await fs.writeFile(outputPath, result.stdout, "utf8");

  if (result.stderr.trim()) {
    core.info(result.stderr.trim());
  }

  const payload = parseOtaPayload(result.stdout);
  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);
  const status = deriveStatus(kind, summary);
  const archivePath = normalizeArchivePath(
    typeof payload.archive_path === "string" ? payload.archive_path : "",
    cwd
  );
  const runUrl = runUrlFromEnv(process.env);
  const artifactName = inputs.artifactName;
  const summaryMarkdown = buildSummaryMarkdown({
    commandLine,
    payload,
    kind,
    status,
    summary,
    archivePath,
    artifactName,
    outputPath,
    runUrl
  });

  if (parseBoolean(inputs.annotate, true)) {
    const maxAnnotations = parsePositiveInteger(inputs.maxAnnotations, 20);
    for (const finding of findingsForAnnotations(payload, kind).slice(0, maxAnnotations)) {
      const method = annotationMethod(finding.severity);
      const message = [finding.why, finding.next ? `Next: ${finding.next}` : ""]
        .filter(Boolean)
        .join("\n");
      core[method](message || finding.summary, { title: finding.summary });
    }
  }

  await core.summary.addRaw(summaryMarkdown, true).write();

  const files = artifactFiles(outputPath, archivePath);
  const retentionDays = parsePositiveInteger(inputs.artifactRetentionDays, undefined);
  await uploadArtifacts(artifactName, files, retentionDays);

  const shouldComment = parseBoolean(inputs.commentPr, false);
  const commentPrOnly = parseBoolean(inputs.commentPrOnly, true);
  const isPullRequest = Boolean(github.context.payload.pull_request);

  if (shouldComment && (!commentPrOnly || isPullRequest)) {
    const token = inputs.githubToken || process.env.GITHUB_TOKEN;
    if (!token) {
      core.warning("comment-pr is enabled but no github-token was provided; skipping pull request comment");
    } else {
      try {
        const commented = await upsertPullRequestComment(token, commentPrOnly, buildCommentBody(summaryMarkdown));
        if (!commented) {
          if (commentPrOnly) {
            core.notice("comment-pr requested outside a pull_request event; skipping pull request comment");
          } else {
            core.notice(`comment-pr requested but no associated pull request was found for commit ${github.context.sha}`);
          }
        }
      } catch (error) {
        core.warning(`failed to update pull request comment: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const primary = topFinding(payload, kind, summary);
  core.setOutput("ok", String(Boolean(payload.ok)));
  core.setOutput("status", status);
  core.setOutput("output-path", outputPath);
  core.setOutput("archive-path", archivePath);
  core.setOutput("artifact-name", artifactName);
  core.setOutput("error-count", String(summary.errorCount));
  core.setOutput("warn-count", String(summary.warnCount));
  core.setOutput("info-count", String(summary.infoCount));
  core.setOutput("primary-summary", primary?.summary || "");

  if (parseBoolean(inputs.failOnError, true) && status === "blocked") {
    core.setFailed(primary?.summary || "Ota reported a blocked outcome");
  } else if (result.exitCode !== 0 && status !== "blocked") {
    core.setFailed(`Ota exited with code ${result.exitCode}`);
  }
}

main().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
