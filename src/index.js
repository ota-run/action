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
  normalizeSummary,
  parseBoolean,
  parseOtaPayload,
  parsePositiveInteger,
  runUrlFromEnv,
  topFinding
} from "./lib.js";

async function runCommand(bin, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
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

async function uploadArtifacts(artifactName, files, retentionDays) {
  const client = new DefaultArtifactClient();
  const rootDirectory = commonRootDirectory(files);
  const options = retentionDays ? { retentionDays } : {};
  await client.uploadArtifact(artifactName, files, rootDirectory, options);
}

async function upsertPullRequestComment(token, body) {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const issueNumber = pullRequest.number;

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
    return;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body
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
    otaBin: core.getInput("ota-bin") || "ota",
    outputPath: core.getInput("output-path") || ".ota-action-output.json",
    githubToken: core.getInput("github-token")
  };

  const args = buildOtaArgs(inputs);
  const cwd = path.resolve(inputs.workingDirectory);
  const outputPath = path.resolve(cwd, inputs.outputPath);
  const commandLine = `${inputs.otaBin} ${args.join(" ")}`;

  core.info(`Running ${commandLine} in ${cwd}`);

  const result = await runCommand(inputs.otaBin, args, cwd);
  await fs.writeFile(outputPath, result.stdout, "utf8");

  if (result.stderr.trim()) {
    core.info(result.stderr.trim());
  }

  const payload = parseOtaPayload(result.stdout);
  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);
  const status = deriveStatus(kind, summary);
  const archivePath = typeof payload.archive_path === "string" ? payload.archive_path : "";
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
    } else if (!isPullRequest) {
      core.notice("comment-pr requested outside a pull_request event; skipping pull request comment");
    } else {
      try {
        await upsertPullRequestComment(token, buildCommentBody(summaryMarkdown));
      } catch (error) {
        core.warning(`failed to update pull request comment: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const primary = topFinding(payload, kind);
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
