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
import {spawn} from "node:child_process";

import * as core from "@actions/core";
import {DefaultArtifactClient} from "@actions/artifact";
import * as github from "@actions/github";

import {
  appendActionReferencesMarkdown,
  annotationModeForKind,
  annotationMethod,
  artifactFiles,
  buildCommentBody,
  buildOtaArgs,
  buildSummaryMarkdown,
  COMMENT_MARKER,
  commonRootDirectory,
  defaultBaselineArtifactName,
  deriveStatus,
  findingsForAnnotations,
  inferKind,
  normalizeArchivePath,
  prioritizeRuntimeNodePath,
  normalizeOtaBinInput,
  normalizeOtaVersion,
  normalizeSummary,
  otaBinaryName,
  otaInstallDirectories,
  parseBoolean,
  parseInstallMode,
  parseOtaPayload,
  parsePositiveInteger,
  proofArtifactPaths,
  resolveOtaInstallPlan,
  runUrlFromEnv,
  selectPullRequestNumberForComment,
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

const cachedNodeExecutablePath = { value: undefined };

function parseNodeMajorFromVersion(output) {
  const match = String(output).match(/\bv(\d+)\.\d+\.\d+/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

async function nodeVersionFromExecutable(executablePath, cwd, env = process.env) {
  const result = await runCommand(executablePath, ["--version"], cwd, env);
  if (result.exitCode !== 0) {
    return null;
  }
  return parseNodeMajorFromVersion(`${result.stdout}\n${result.stderr}`);
}

async function resolvePreferredNodeExecutable(env = process.env, cwd = process.cwd()) {
  if (cachedNodeExecutablePath.value !== undefined) {
    return cachedNodeExecutablePath.value;
  }

  const candidates = new Set();

  const candidateList = executableCandidates("node", env)
    .filter((candidate) => path.basename(candidate).toLowerCase().startsWith("node"));

  for (const candidate of candidateList) {
    candidates.add(path.resolve(candidate));
  }

  if (process.execPath) {
    candidates.add(path.resolve(process.execPath));
  }

  let preferred = process.execPath;
  let preferredMajor = parseNodeMajorFromVersion(process.version) ?? 0;

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsSync.constants.X_OK);
    } catch {
      continue;
    }

    const version = await nodeVersionFromExecutable(candidate, cwd, env);
    if (version !== null && version > preferredMajor) {
      preferredMajor = version;
      preferred = candidate;
    }
  }

  cachedNodeExecutablePath.value = preferred || process.execPath;
  core.debug(`Selected node executable for Ota invocations: ${cachedNodeExecutablePath.value}`);
  return cachedNodeExecutablePath.value;
}

async function runOtaWithPreferredNodeEnv(bin, args, cwd) {
  const preferredNode = await resolvePreferredNodeExecutable(process.env, cwd);
  const invocationEnv = prioritizeRuntimeNodePath(process.env, preferredNode);
  return await runCommand(bin, args, cwd, invocationEnv);
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
  if (!env.OTA_BIN_DIR) {
    const installerBinDir = path.resolve(cwd, ".ota", "bin");
    env.OTA_BIN_DIR = installerBinDir;
    process.env.OTA_BIN_DIR = installerBinDir;
    core.info(`Using OTA installer directory ${installerBinDir}`);
  }
  if (version) {
    env.OTA_VERSION = version;
  }

  if (process.platform === "win32") {
    const escapedBinDir = env.OTA_BIN_DIR.replace(/'/g, "''");
    const escapedVersion = (version || "").replace(/'/g, "''");
    const command = `$env:OTA_BIN_DIR='${escapedBinDir}'; $env:OTA_VERSION='${escapedVersion}'; irm https://dist.ota.run/install.ps1 | iex`;
    return await runCommand(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
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
  const preferredExisting = await resolveExistingBinary(preferred);
  const installPlan = resolveOtaInstallPlan({
    installMode,
    requestedVersion,
    preferredExisting,
    preferred
  });

  if (installPlan.action === "error") {
    throw new Error(installPlan.message);
  }

  if (installPlan.action === "use-existing") {
    core.info(`Using existing ota binary at ${installPlan.path}`);
    return installPlan.path;
  }

  core.info(
    `Installing ota ${requestedVersion || "latest"} via the official installer (${installMode} mode)`
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

  const installDirectories = otaInstallDirectories();
  core.debug(`Searching for ota binary in: ${installDirectories.join(", ")}`);

  for (const directory of installDirectories) {
    const candidate = path.join(directory, binaryName);
    core.debug(`Checking candidate: ${candidate}`);
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

async function renderOtaAnnotations(bin, cwd, mode, format, inputPath, title = "") {
  const args = ["annotations", "--mode", mode, "--format", format, "--input", inputPath];
  if (title) {
    args.push("--title", title);
  }
  const result = await runOtaWithPreferredNodeEnv(bin, args, cwd);
  if (result.exitCode !== 0) {
    const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(
      `ota annotations failed for ${mode}/${format}${detail ? `: ${detail}` : ""}`
    );
  }
  return result.stdout;
}

function normalizeBaselineInput(value, cwd) {
  if (!value || String(value).trim() === "") {
    return "";
  }
  const baseline = String(value).trim();
  if (baseline === "latest") {
    return baseline;
  }
  return path.resolve(cwd, baseline);
}

function workflowFileFromEnv(env = process.env) {
  const workflowRef = env.GITHUB_WORKFLOW_REF;
  const repository = env.GITHUB_REPOSITORY;
  if (!workflowRef || !repository) {
    return "";
  }
  const prefix = `${repository}/`;
  const trimmed = workflowRef.endsWith("@")
    ? workflowRef.slice(0, -1)
    : workflowRef.split("@")[0];
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : "";
}

async function repositoryDefaultBranch(token) {
  const payloadBranch = github.context.payload?.repository?.default_branch;
  if (payloadBranch) {
    return payloadBranch;
  }
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const response = await octokit.rest.repos.get({ owner, repo });
  return response.data.default_branch;
}

async function latestSuccessfulWorkflowRunId(token, workflowFile, branch) {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const currentRunId = Number(process.env.GITHUB_RUN_ID || "0");

  for (let page = 1; page <= 5; page += 1) {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
      {
        owner,
        repo,
        workflow_id: workflowFile,
        branch,
        status: "completed",
        per_page: 100,
        page
      }
    );

    const match = response.data.workflow_runs.find(
      (run) => run.conclusion === "success" && run.id !== currentRunId
    );
    if (match) {
      return match.id;
    }

    if (response.data.workflow_runs.length < 100) {
      break;
    }
  }

  return 0;
}

async function listFilesRecursive(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(resolved));
    } else if (entry.isFile()) {
      files.push(resolved);
    }
  }

  return files;
}

async function selectReceiptBaselineFile(root) {
  const files = await listFilesRecursive(root);
  const candidates = [];

  for (const file of files.filter((candidate) => candidate.endsWith(".json"))) {
    try {
      const payload = JSON.parse(await fs.readFile(file, "utf8"));
      if (payload?.mode === "receipt" && payload.receipt) {
        candidates.push({ file, payload });
      }
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) {
    return "";
  }

  const archived = candidates.find(({ file }) => file.includes(`${path.sep}.ota${path.sep}receipts${path.sep}`));
  return archived?.file || candidates[0].file;
}

async function restoreBaselineArtifact(artifactName, token, cwd) {
  const workflowFile = workflowFileFromEnv();
  if (!workflowFile) {
    core.warning("artifact-name baseline restore could not resolve the current workflow file from GITHUB_WORKFLOW_REF");
    return "";
  }

  const branch = await repositoryDefaultBranch(token);
  const workflowRunId = await latestSuccessfulWorkflowRunId(token, workflowFile, branch);
  if (!workflowRunId) {
    core.notice(`No successful ${workflowFile} run on ${branch} had artifact \`${artifactName}\`; running without a restored baseline`);
    return "";
  }

  const { owner, repo } = github.context.repo;
  const client = new DefaultArtifactClient();
  const findBy = {
    token,
    workflowRunId,
    repositoryOwner: owner,
    repositoryName: repo
  };

  let artifact;
  try {
    const response = await client.getArtifact(artifactName, { findBy });
    artifact = response.artifact;
  } catch (error) {
    if (String(error?.message || error).includes("Artifact not found")) {
      core.notice(`Artifact \`${artifactName}\` was not found in successful ${workflowFile} run ${workflowRunId}; running without a restored baseline`);
      return "";
    }
    throw error;
  }

  const downloadPath = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || cwd, "ota-baseline-"));
  await client.downloadArtifact(artifact.id, { path: downloadPath, findBy });
  const baselinePath = await selectReceiptBaselineFile(downloadPath);

  if (!baselinePath) {
    core.notice(`Artifact \`${artifactName}\` from run ${workflowRunId} did not contain a reusable receipt baseline; running without a restored baseline`);
    return "";
  }

  core.info(`Using baseline receipt from artifact \`${artifactName}\` in successful ${workflowFile} run ${workflowRunId}`);
  return baselinePath;
}

async function runOtaInvocation(otaBinary, inputs, cwd) {
  const effectiveInputs = { ...inputs };
  const args = buildOtaArgs(effectiveInputs);
  const commandLine = `${otaBinary} ${args.join(" ")}`;

  core.info(`Running ${commandLine} in ${cwd}`);

  const result = await runOtaWithPreferredNodeEnv(otaBinary, args, cwd);

  if (result.stderr.trim()) {
    core.info(result.stderr.trim());
  }

  return { effectiveInputs, args, commandLine, result };
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
    baseline: core.getInput("baseline"),
    failOnNewBlockers: core.getInput("fail-on-new-blockers"),
    workingDirectory: core.getInput("working-directory") || ".",
    executionMode: core.getInput("execution-mode") || "native",
    workflow: core.getInput("workflow"),
    member: core.getInput("member"),
    archive: core.getInput("archive"),
    annotate: core.getInput("annotate"),
    maxAnnotations: core.getInput("max-annotations"),
    commentPr: core.getInput("comment-pr"),
    commentPrOnly: core.getInput("comment-pr-only"),
    artifactName: core.getInput("artifact-name") || "ota-readiness",
    artifactRetentionDays: core.getInput("artifact-retention-days"),
    failOnError: core.getInput("fail-on-error"),
    install: core.getInput("install") || "auto",
    otaVersion: core.getInput("ota-version"),
    otaBin: core.getInput("ota-bin") || "ota",
    outputPath: core.getInput("output-path") || ".ota-action-output.json",
    githubToken: core.getInput("github-token")
  };

  if (inputs.command !== "receipt" && inputs.baseline) {
    throw new Error("baseline is only supported when command=receipt");
  }

  const cwd = path.resolve(inputs.workingDirectory);
  const outputPath = path.resolve(cwd, inputs.outputPath);
  const otaBinary = await ensureOtaBinary(inputs, cwd);
  const token = inputs.githubToken || process.env.GITHUB_TOKEN;
  let baselinePath = normalizeBaselineInput(inputs.baseline, cwd);
  const effectiveBaselineArtifactName = defaultBaselineArtifactName({
    command: inputs.command,
    baseline: baselinePath,
    baselineArtifactName: "",
    artifactName: inputs.artifactName,
    eventName: github.context.eventName
  });
  let baselineInfo = {
    artifactName: effectiveBaselineArtifactName,
    restored: false,
    path: ""
  };
  if (!baselinePath && effectiveBaselineArtifactName) {
    if (!token) {
      throw new Error(
        "pull request receipt runs require github-token or GITHUB_TOKEN with actions:read permission so the action can restore the latest readiness baseline"
      );
    }
    baselinePath = await restoreBaselineArtifact(effectiveBaselineArtifactName, token, cwd);
    baselineInfo = {
      artifactName: effectiveBaselineArtifactName,
      restored: Boolean(baselinePath),
      path: baselinePath
    };
  }

  let payload;
  let commandLine;
  let selectedResult;
  let archivePath = "";
  let proofArtifactFiles = [];

  if (inputs.command === "receipt" && (baselinePath || effectiveBaselineArtifactName)) {
    if (baselinePath && baselinePath !== "latest") {
      const currentRun = await runOtaInvocation(
        otaBinary,
        {
          ...inputs,
          baseline: "",
          failOnNewBlockers: "false"
        },
        cwd
      );
      const currentPayload = parseOtaPayload(currentRun.result.stdout);
      archivePath = normalizeArchivePath(
        typeof currentPayload.archive_path === "string" ? currentPayload.archive_path : "",
        cwd
      );

      payload = currentPayload;
      commandLine = currentRun.commandLine;
      selectedResult = currentRun.result;
    }

    if (baselinePath) {
      const diffRun = await runOtaInvocation(
        otaBinary,
        {
          ...inputs,
          archive: "false",
          baseline: baselinePath,
          failOnNewBlockers: inputs.failOnNewBlockers
        },
        cwd
      );

      payload = parseOtaPayload(diffRun.result.stdout);
      commandLine = diffRun.commandLine;
      selectedResult = diffRun.result;
      if (!archivePath && parseBoolean(inputs.archive, true)) {
        const currentRun = await runOtaInvocation(
          otaBinary,
          {
            ...inputs,
            baseline: "",
            failOnNewBlockers: "false"
          },
          cwd
        );
        const currentPayload = parseOtaPayload(currentRun.result.stdout);
        archivePath = normalizeArchivePath(
          typeof currentPayload.archive_path === "string" ? currentPayload.archive_path : "",
          cwd
        );
      }
    } else if (parseBoolean(inputs.failOnNewBlockers, false)) {
      core.notice("fail-on-new-blockers was requested but no baseline could be restored; running ungated receipt output");
      const currentRun = await runOtaInvocation(
        otaBinary,
        {
          ...inputs,
          baseline: "",
          failOnNewBlockers: "false"
        },
        cwd
      );
      const currentPayload = parseOtaPayload(currentRun.result.stdout);
      archivePath = normalizeArchivePath(
        typeof currentPayload.archive_path === "string" ? currentPayload.archive_path : "",
        cwd
      );
      payload = currentPayload;
      commandLine = currentRun.commandLine;
      selectedResult = currentRun.result;
    } else if (!selectedResult) {
      const currentRun = await runOtaInvocation(
        otaBinary,
        {
          ...inputs,
          baseline: "",
          failOnNewBlockers: "false"
        },
        cwd
      );
      const currentPayload = parseOtaPayload(currentRun.result.stdout);
      archivePath = normalizeArchivePath(
        typeof currentPayload.archive_path === "string" ? currentPayload.archive_path : "",
        cwd
      );
      payload = currentPayload;
      commandLine = currentRun.commandLine;
      selectedResult = currentRun.result;
    }
  } else {
    const run = await runOtaInvocation(otaBinary, inputs, cwd);
    payload = parseOtaPayload(run.result.stdout);
    commandLine = run.commandLine;
    selectedResult = run.result;
    archivePath = normalizeArchivePath(
      typeof payload.archive_path === "string" ? payload.archive_path : "",
      cwd
    );
    proofArtifactFiles = proofArtifactPaths(payload, cwd);
  }

  await fs.writeFile(outputPath, selectedResult.stdout, "utf8");

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);
  const status = deriveStatus(kind, summary);
  const runUrl = runUrlFromEnv(process.env);
  const artifactName = inputs.artifactName;
  const annotationMode = annotationModeForKind(kind);
  const proofArtifacts = kind === "proof"
    ? {
      topology: typeof payload.artifacts?.topology === "string" ? path.resolve(cwd, payload.artifacts.topology) : "",
      doctor: typeof payload.artifacts?.doctor === "string" ? path.resolve(cwd, payload.artifacts.doctor) : "",
      upLog: typeof payload.artifacts?.up_log === "string" ? path.resolve(cwd, payload.artifacts.up_log) : ""
    }
    : null;
  const fallbackSummaryMarkdown = buildSummaryMarkdown({
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
      proofArtifacts
    });
  let summaryMarkdown = fallbackSummaryMarkdown;
  if (annotationMode) {
    try {
      summaryMarkdown = appendActionReferencesMarkdown(
        (await renderOtaAnnotations(otaBinary, cwd, annotationMode, "markdown", outputPath)).trimEnd(),
        {
          commandLine,
          outputPath,
          archivePath,
          artifactName,
          runUrl,
          baselineInfo,
          kind,
          proofArtifacts
        }
      );
    } catch (error) {
      core.warning(
        `failed to render canonical ota annotations markdown; falling back to bundled action summary: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (parseBoolean(inputs.annotate, true)) {
    const maxAnnotations = parsePositiveInteger(inputs.maxAnnotations, 20);
    if (annotationMode === "doctor") {
      try {
        const rendered = await renderOtaAnnotations(otaBinary, cwd, annotationMode, "github", outputPath);
        const lines = rendered.split(/\r?\n/).filter(Boolean).slice(0, maxAnnotations);
        for (const line of lines) {
          process.stdout.write(`${line}\n`);
        }
      } catch (error) {
        core.warning(
          `failed to render canonical ota annotations github output; falling back to bundled action annotations: ${error instanceof Error ? error.message : String(error)}`
        );
        for (const finding of findingsForAnnotations(payload, kind).slice(0, maxAnnotations)) {
          const method = annotationMethod(finding.severity);
          const message = [finding.why, finding.next ? `Next: ${finding.next}` : ""]
            .filter(Boolean)
            .join("\n");
          core[method](message || finding.summary, { title: finding.summary });
        }
      }
    } else {
      for (const finding of findingsForAnnotations(payload, kind).slice(0, maxAnnotations)) {
        const method = annotationMethod(finding.severity);
        const message = [finding.why, finding.next ? `Next: ${finding.next}` : ""]
          .filter(Boolean)
          .join("\n");
        core[method](message || finding.summary, { title: finding.summary });
      }
    }
  }

  await core.summary.addRaw(summaryMarkdown, true).write();

  const files = [...new Set([...artifactFiles(outputPath, archivePath), ...proofArtifactFiles])];
  const retentionDays = parsePositiveInteger(inputs.artifactRetentionDays, undefined);
  await uploadArtifacts(artifactName, files, retentionDays);

  const shouldComment = parseBoolean(inputs.commentPr, true);
  const commentPrOnly = parseBoolean(inputs.commentPrOnly, true);

  if (shouldComment) {
    const commentRequestedForCurrentEvent = !commentPrOnly || github.context.eventName === "pull_request";
    if (commentRequestedForCurrentEvent && !token) {
      throw new Error("comment-pr requires github-token or GITHUB_TOKEN with pull-requests:write permission");
    }
    if (commentRequestedForCurrentEvent) {
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
  core.setOutput("baseline-path", baselinePath);
  core.setOutput("artifact-name", artifactName);
  core.setOutput("error-count", String(summary.errorCount));
  core.setOutput("warn-count", String(summary.warnCount));
  core.setOutput("info-count", String(summary.infoCount));
  core.setOutput("gate-rule", summary.gate?.rule || "");
  core.setOutput("gate-passed", summary.gate ? String(summary.gate.passed) : "");
  core.setOutput("primary-summary", primary?.summary || "");

  if (parseBoolean(inputs.failOnError, true) && status === "blocked") {
    core.setFailed(primary?.summary || "Ota reported a blocked outcome");
  } else if (selectedResult.exitCode !== 0 && status !== "blocked") {
    core.setFailed(`Ota exited with code ${selectedResult.exitCode}`);
  }
}

main().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
