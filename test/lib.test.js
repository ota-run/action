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
import assert from "node:assert/strict";
import test from "node:test";

import {
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
  parseInstallMode,
  parseOtaPayload,
  selectPullRequestNumberForComment,
  shouldRetryReceiptWithoutArchive,
  topFinding
} from "../src/lib.js";

test("buildOtaArgs defaults to archived receipt json", () => {
  const args = buildOtaArgs({
    command: "receipt",
    archive: "true",
    executionMode: "native",
    path: "."
  });

  assert.deepEqual(args, ["receipt", "--json", "--archive", "--mode", "native", "."]);
});

test("buildOtaArgs forwards receipt baseline diff gate flags", () => {
  const args = buildOtaArgs({
    command: "receipt",
    archive: "true",
    baseline: "/tmp/baseline-receipt.json",
    failOnNewBlockers: "true",
    executionMode: "native",
    path: "."
  });

  assert.deepEqual(args, [
    "receipt",
    "--json",
    "--baseline",
    "/tmp/baseline-receipt.json",
    "--fail-on-new-blockers",
    "--mode",
    "native",
    "."
  ]);
});

test("buildOtaArgs builds doctor arguments without archive", () => {
  const args = buildOtaArgs({
    command: "doctor",
    archive: "true",
    executionMode: "container",
    member: "api",
    path: "/repo"
  });

  assert.deepEqual(args, ["doctor", "--json", "--mode", "container", "--member", "api", "/repo"]);
});

test("buildOtaArgs rejects unsupported command", () => {
  assert.throws(
    () => buildOtaArgs({ command: "up", executionMode: "native", path: "." }),
    /unsupported command/
  );
});

test("parseInstallMode defaults to auto and rejects unsupported values", () => {
  assert.equal(parseInstallMode(""), "auto");
  assert.equal(parseInstallMode("always"), "always");
  assert.throws(() => parseInstallMode("sometimes"), /unsupported install mode/);
});

test("normalizeOtaVersion prefixes semver values with v", () => {
  assert.equal(normalizeOtaVersion("1.2.3"), "v1.2.3");
  assert.equal(normalizeOtaVersion("v1.2.3"), "v1.2.3");
  assert.equal(normalizeOtaVersion(""), "");
});

test("otaInstallDirectories follows official install locations", () => {
  assert.deepEqual(
    otaInstallDirectories({ HOME: "/home/ota" }, "linux"),
    ["/home/ota/.local/bin", "/home/ota/.cargo/bin"]
  );

  assert.deepEqual(
    otaInstallDirectories({ LOCALAPPDATA: "C:\\Users\\ota\\AppData\\Local", HOME: "C:\\Users\\ota" }, "win32"),
    [
      "C:\\Users\\ota\\AppData\\Local\\ota\\bin",
      "C:\\Users\\ota\\.local\\bin",
      "C:\\Users\\ota\\.cargo\\bin"
    ]
  );

  assert.deepEqual(
      otaInstallDirectories({LOCALAPPDATA: "C:\\Users\\ota\\AppData\\Local", USERPROFILE: "C:\\Users\\ota"}, "win32"),
      [
        "C:\\Users\\ota\\AppData\\Local\\ota\\bin",
        "C:\\Users\\ota\\.local\\bin",
        "C:\\Users\\ota\\.cargo\\bin"
      ]
  );

  assert.equal(otaBinaryName("win32"), "ota.exe");
  assert.equal(otaBinaryName("linux"), "ota");
});

test("commonRootDirectory uses shared parent for artifact upload", () => {
  const root = commonRootDirectory([
    "/repo/.ota-action-output.json",
    "/repo/.ota/receipts/repo-receipt.json"
  ]);

  assert.equal(root, "/repo");
});

test("commonRootDirectory handles windows drive roots without duplicating the drive prefix", () => {
  const root = commonRootDirectory([
    "D:\\a\\action\\action\\.ota-action-output.json",
    "D:\\a\\action\\action\\.ota\\receipts\\repo-receipt.json"
  ], path.win32);

  assert.equal(root, "D:\\a\\action\\action");
});

test("commonRootDirectory returns the containing directory for a single windows file", () => {
  const root = commonRootDirectory([
    "D:\\a\\action\\action\\.ota-action-output.json"
  ], path.win32);

  assert.equal(root, "D:\\a\\action\\action");
});

test("doctor payload derives risky status and blocker summary", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: true,
    path: "/repo/ota.yaml",
    mode: "native",
    summary: {
      verdict: "risky",
      error_count: 0,
      warn_count: 1,
      info_count: 0,
      primary_blocker: {
        severity: "warn",
        summary: "Review config",
        why: "config drift exists",
        next: "run ota detect --merge"
      }
    },
    findings: []
  }));

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);
  assert.equal(kind, "doctor");
  assert.equal(deriveStatus(kind, summary), "risky");

  const markdown = buildSummaryMarkdown({
    commandLine: "ota doctor --json .",
    payload,
    kind,
    status: "risky",
    summary,
    archivePath: "",
    artifactName: "ota-report",
    outputPath: "/tmp/ota.json",
    runUrl: null
  });

  assert.match(markdown, /Status: \*\*RISKY\*\*/);
  assert.match(markdown, /Outcome: Ota reported warnings that still need review\./);
  assert.match(markdown, /### References/);
  assert.match(markdown, /Review config/);
  assert.match(markdown, /### Next steps/);
  assert.match(markdown, /run ota detect --merge/);
});

test("receipt diff gate passes with existing baseline debt and keeps risky status", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: false,
    path: "/repo/ota.yaml",
    mode: "diff",
    gate: {
      rule: "fail_on_new_blockers",
      passed: true,
      new_blocker_count: 0
    },
    baseline: {
      source: "file",
      selection_path: "/tmp/baseline-receipt.json",
      archive_path: "/repo/.ota/receipts/repo-receipt-20260414-101010-123Z.json",
      archived_at: "2026-04-14T10:10:10.123Z",
      ok: false,
      contract: "/repo/ota.yaml",
      summary: {
        error_count: 2,
        warn_count: 0,
        info_count: 0,
        step_count: 1
      }
    },
    current: {
      ok: false,
      contract: "/repo/ota.yaml",
      summary: {
        error_count: 2,
        warn_count: 0,
        info_count: 0,
        step_count: 1
      }
    },
    summary: {
      baseline_ok: false,
      current_ok: false,
      introduced: {
        count: 0,
        error_count: 0,
        warn_count: 0,
        info_count: 0
      },
      resolved: {
        count: 0,
        error_count: 0,
        warn_count: 0,
        info_count: 0
      },
      unchanged: {
        count: 2,
        error_count: 2,
        warn_count: 0,
        info_count: 0
      }
    },
    introduced: [],
    resolved: [],
    unchanged: []
  }));

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);

  assert.equal(kind, "receipt_diff");
  assert.equal(summary.gate.passed, true);
  assert.equal(deriveStatus(kind, summary), "risky");

  const markdown = buildSummaryMarkdown({
    commandLine: "ota receipt --json --baseline /tmp/baseline-receipt.json --fail-on-new-blockers .",
    payload,
    kind,
    status: "risky",
    summary,
    archivePath: "/tmp/current-receipt.json",
    artifactName: "ota-readiness",
    outputPath: "/tmp/ota-diff.json",
    runUrl: null
  });

  assert.match(markdown, /Outcome: No new blockers were introduced, but the current receipt is still not ready\./);
  assert.match(markdown, /### Baseline/);
  assert.match(markdown, /- Gate: \*\*PASSED\*\* `fail_on_new_blockers`/);
  assert.match(markdown, /- Source: `file`/);
  assert.match(markdown, /- Selection: `\/tmp\/baseline-receipt.json`/);
  assert.match(markdown, /- Archive: `\/repo\/\.ota\/receipts\/repo-receipt-20260414-101010-123Z\.json`/);
  assert.match(markdown, /- Archived: `2026-04-14T10:10:10.123Z`/);
  assert.match(markdown, /- Diff: introduced 0, resolved 0, unchanged 2/);
  assert.match(markdown, /### Next steps/);
  assert.match(markdown, /Review the current receipt debt before treating this baseline as healthy\./);
});

test("receipt diff summary shows promoted baseline provenance when ota provides it", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: true,
    path: "/repo/ota.yaml",
    mode: "diff",
    baseline: {
      source: "promoted",
      selection_path: "/repo/.ota/receipts/repo-baseline.json",
      archive_path: "/repo/.ota/receipts/repo-receipt-20260414-111111-000Z.json",
      promoted_at: "2026-04-14T11:22:33.456Z",
      archived_at: "2026-04-14T11:11:11.000Z",
      ok: true,
      contract: "/repo/ota.yaml",
      summary: {
        error_count: 0,
        warn_count: 0,
        info_count: 0,
        step_count: 1
      }
    },
    current: {
      ok: true,
      contract: "/repo/ota.yaml",
      summary: {
        error_count: 0,
        warn_count: 0,
        info_count: 0,
        step_count: 1
      }
    },
    summary: {
      baseline_ok: true,
      current_ok: true,
      introduced: {
        count: 0,
        error_count: 0,
        warn_count: 0,
        info_count: 0
      },
      resolved: {
        count: 0,
        error_count: 0,
        warn_count: 0,
        info_count: 0
      },
      unchanged: {
        count: 0,
        error_count: 0,
        warn_count: 0,
        info_count: 0
      }
    },
    introduced: [],
    resolved: [],
    unchanged: []
  }));

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);

  const markdown = buildSummaryMarkdown({
    commandLine: "ota receipt --json --baseline promoted .",
    payload,
    kind,
    status: "ready",
    summary,
    archivePath: "",
    artifactName: "ota-readiness",
    outputPath: "/tmp/ota-diff.json",
    runUrl: null
  });

  assert.match(markdown, /Outcome: The current receipt is ready and no new blockers were introduced\./);
  assert.match(markdown, /- Source: `promoted`/);
  assert.match(markdown, /- Selection: `\/repo\/\.ota\/receipts\/repo-baseline.json`/);
  assert.match(markdown, /- Archive: `\/repo\/\.ota\/receipts\/repo-receipt-20260414-111111-000Z\.json`/);
  assert.match(markdown, /- Promoted: `2026-04-14T11:22:33.456Z`/);
  assert.match(markdown, /- Archived: `2026-04-14T11:11:11.000Z`/);
});

test("receipt diff gate blocks on introduced blockers and annotates introduced findings only", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: false,
    path: "/repo/ota.yaml",
    mode: "diff",
    gate: {
      rule: "fail_on_new_blockers",
      passed: false,
      new_blocker_count: 1
    },
    baseline: {
      source: "latest",
      ok: false,
      contract: "/repo/ota.yaml",
      summary: {
        error_count: 1,
        warn_count: 0,
        info_count: 0,
        step_count: 1
      }
    },
    current: {
      ok: false,
      contract: "/repo/ota.yaml",
      summary: {
        error_count: 2,
        warn_count: 0,
        info_count: 0,
        step_count: 1
      }
    },
    summary: {
      baseline_ok: false,
      current_ok: false,
      introduced: {
        count: 1,
        error_count: 1,
        warn_count: 0,
        info_count: 0
      },
      resolved: {
        count: 0,
        error_count: 0,
        warn_count: 0,
        info_count: 0
      },
      unchanged: {
        count: 1,
        error_count: 1,
        warn_count: 0,
        info_count: 0
      }
    },
    introduced: [
      {
        severity: "error",
        summary: "Missing environment variable: OTA_BASELINE_REQUIRED",
        why: "the contract requires `OTA_BASELINE_REQUIRED`, but it was not set",
        next: "set `OTA_BASELINE_REQUIRED` and rerun Ota"
      }
    ],
    resolved: [],
    unchanged: []
  }));

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);

  assert.equal(deriveStatus(kind, summary), "blocked");
  assert.equal(topFinding(payload, kind)?.summary, "Missing environment variable: OTA_BASELINE_REQUIRED");
  assert.deepEqual(findingsForAnnotations(payload, kind), payload.introduced);
});

test("validate failure becomes blocked summary", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: false,
    path: "/repo/ota.yaml",
    errors: ["unknown field `foo`"]
  }));

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);
  assert.equal(kind, "validate_failure");
  assert.equal(summary.errorCount, 1);
  assert.equal(deriveStatus(kind, summary), "blocked");
  assert.equal(topFinding(payload, kind)?.summary, "unknown field `foo`");

  const markdown = buildSummaryMarkdown({
    commandLine: "ota receipt --json .",
    payload,
    kind,
    status: "blocked",
    summary,
    archivePath: "",
    artifactName: "ota-report",
    outputPath: "/tmp/ota.json",
    runUrl: null
  });

  assert.match(markdown, /Outcome: Ota could not load or validate the requested contract\./);
  assert.match(markdown, /### Primary blocker/);
  assert.match(markdown, /\*\*unknown field `foo`\*\*/);
  assert.match(markdown, /unknown field `foo`/);
  assert.match(markdown, /### Next steps/);
  assert.match(markdown, /fix the contract and rerun Ota/);
});

test("normalizeArchivePath resolves relative receipt paths against working directory", () => {
  assert.equal(
    normalizeArchivePath("./.ota/receipts/repo-receipt-1.json", "/repo/subdir"),
    path.resolve("/repo/subdir", "./.ota/receipts/repo-receipt-1.json")
  );
});

test("normalizeOtaBinInput resolves path-like values from working directory", () => {
  assert.equal(
    normalizeOtaBinInput("./bin/ota", "/repo/subdir"),
    path.resolve("/repo/subdir", "./bin/ota")
  );
  assert.equal(
    normalizeOtaBinInput("ota", "/repo/subdir"),
    "ota"
  );
  assert.equal(
    normalizeOtaBinInput("C:\\repo\\bin\\ota.exe", "D:\\workspace", path.win32),
    "C:\\repo\\bin\\ota.exe"
  );
});

test("selectPullRequestNumberForComment prefers the event pull request", () => {
  assert.equal(
    selectPullRequestNumberForComment({
      payloadPullRequest: { number: 42 },
      commentPrOnly: false,
      associatedPullRequests: [{ number: 7, state: "open" }]
    }),
    42
  );
});

test("selectPullRequestNumberForComment skips non-pr events when commentPrOnly is true", () => {
  assert.equal(
    selectPullRequestNumberForComment({
      payloadPullRequest: null,
      commentPrOnly: true,
      associatedPullRequests: [{ number: 7, state: "open" }]
    }),
    null
  );
});

test("selectPullRequestNumberForComment uses an associated open pull request when allowed", () => {
  assert.equal(
    selectPullRequestNumberForComment({
      payloadPullRequest: null,
      commentPrOnly: false,
      associatedPullRequests: [
        { number: 7, state: "closed" },
        { number: 9, state: "open" }
      ]
    }),
    9
  );
});

test("shouldRetryReceiptWithoutArchive only retries the known ota receipt archive incompatibility", () => {
  assert.equal(
    shouldRetryReceiptWithoutArchive(
      { command: "receipt", archive: "true" },
      {
        exitCode: 2,
        stderr: "error: unexpected argument '--archive' found\n\nUsage: ota receipt --json [PATH]\n"
      }
    ),
    true
  );

  assert.equal(
    shouldRetryReceiptWithoutArchive(
      { command: "receipt", archive: "false" },
      {
        exitCode: 2,
        stderr: "error: unexpected argument '--archive' found\n\nUsage: ota receipt --json [PATH]\n"
      }
    ),
    false
  );

  assert.equal(
    shouldRetryReceiptWithoutArchive(
      { command: "doctor", archive: "true" },
      {
        exitCode: 2,
        stderr: "error: unexpected argument '--archive' found\n\nUsage: ota receipt --json [PATH]\n"
      }
    ),
    false
  );
});
