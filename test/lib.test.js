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
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  appendActionReferencesMarkdown,
  annotationModeForKind,
  buildOtaArgs,
  buildSummaryMarkdown,
  ciWorkflowDrift,
  commonRootDirectory,
  defaultBaselineArtifactName,
  deriveStatus,
  findingsForAnnotations,
  inferKind,
  normalizeArchivePath,
  normalizeOtaBinInput,
  normalizeOtaVersion,
  normalizeSummary,
  otaBinaryName,
  otaInstallDirectories,
  parseSourceMode,
  postInstallBinaryDirectories,
  proofArtifactPaths,
  prioritizeRuntimeNodePath,
  parseInstallMode,
  parseOtaPayload,
  resolveBootstrapSourceFromContract,
  resolveOtaInstallPlan,
  selectPullRequestNumberForComment,
  topFinding
} from "../src/lib.js";

test("annotationModeForKind maps canonical ota annotation modes", () => {
  assert.equal(annotationModeForKind("doctor"), "doctor");
  assert.equal(annotationModeForKind("receipt_diff"), "receipt-diff");
  assert.equal(annotationModeForKind("receipt"), "");
  assert.equal(annotationModeForKind("validate_failure"), "");
});

test("appendActionReferencesMarkdown preserves wrapper-specific references", () => {
  const markdown = appendActionReferencesMarkdown("## ota doctor\n\nStatus: READY", {
    commandLine: "ota doctor --json .",
    outputPath: ".ota-action-output.json",
    archivePath: "",
    artifactName: "ota-readiness",
    runUrl: "https://github.com/ota-run/action/actions/runs/123",
    baselineInfo: {
      artifactName: "ota-readiness",
      restored: true,
      path: "/tmp/baseline.json"
    },
    kind: "doctor"
  });

  assert.match(markdown, /## ota doctor/);
  assert.match(markdown, /### Action references/);
  assert.match(markdown, /- Command: `ota doctor --json \.`/);
  assert.match(markdown, /- Output JSON: `\.ota-action-output\.json`/);
  assert.match(markdown, /- Artifact: `ota-readiness` in \[this run\]/);
  assert.match(markdown, /- Baseline restore: `ota-readiness` -> `\/tmp\/baseline\.json`/);
});

test("buildOtaArgs defaults to archived receipt json", () => {
  const args = buildOtaArgs({
    command: "receipt",
    archive: "true",
    executionMode: "native",
    path: "."
  });

  assert.deepEqual(args, ["receipt", "--json", "--archive", "--mode", "native", "."]);
});

test("defaultBaselineArtifactName auto-selects the current artifact on pull request receipt runs", () => {
  assert.equal(defaultBaselineArtifactName({
    command: "receipt",
    baseline: "",
    baselineArtifactName: "",
    artifactName: "ota-readiness",
    eventName: "pull_request"
  }), "ota-readiness");

  assert.equal(defaultBaselineArtifactName({
    command: "doctor",
    baseline: "",
    baselineArtifactName: "",
    artifactName: "ota-readiness",
    eventName: "pull_request"
  }), "");

  assert.equal(defaultBaselineArtifactName({
    command: "receipt",
    baseline: "/tmp/baseline.json",
    baselineArtifactName: "",
    artifactName: "ota-readiness",
    eventName: "pull_request"
  }), "");
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
    workflow: "docs",
    member: "api",
    path: "/repo"
  });

  assert.deepEqual(args, ["doctor", "--json", "--mode", "container", "--workflow", "docs", "--member", "api", "/repo"]);
});

test("buildOtaArgs builds proof runtime arguments", () => {
  const args = buildOtaArgs({
    command: "proof",
    executionMode: "container",
    workflow: "docs",
    path: "/repo"
  });

  assert.deepEqual(args, ["proof", "runtime", "--json", "--mode", "container", "--workflow", "docs", "/repo"]);
});

test("buildOtaArgs rejects unsupported command", () => {
  assert.throws(
    () => buildOtaArgs({ command: "up", executionMode: "native", path: "." }),
    /unsupported command/
  );
});

test("proof runtime payload derives blocked status and artifact paths", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: false,
    path: "/repo/ota.yaml",
    mode: "runtime-proof",
    workflow: "docs",
    phase: "service readiness",
    summary: {
      verdict: "not_ready",
      error_count: 1,
      warn_count: 0,
      info_count: 0,
      primary_blocker: {
        severity: "error",
        summary: "Surface readiness failed: site",
        why: "the selected workflow surface `site` on run task `dev` did not become ready",
        next: "inspect the proof artifacts and repair the docs workflow"
      }
    },
    artifacts: {
      topology: ".ota/proof/docs/topology.json",
      doctor: ".ota/proof/docs/doctor.json",
      up_log: ".ota/proof/docs/up.log"
    }
  }));

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);
  assert.equal(kind, "proof");
  assert.equal(deriveStatus(kind, summary), "blocked");
  assert.deepEqual(proofArtifactPaths(payload, "/repo"), [
    path.resolve("/repo", ".ota/proof/docs/topology.json"),
    path.resolve("/repo", ".ota/proof/docs/doctor.json"),
    path.resolve("/repo", ".ota/proof/docs/up.log")
  ]);
});

test("parseInstallMode defaults to auto and rejects unsupported values", () => {
  assert.equal(parseInstallMode(""), "auto");
  assert.equal(parseInstallMode("auto"), "auto");
  assert.equal(parseInstallMode("always"), "always");
  assert.equal(parseInstallMode("never"), "never");
  assert.throws(() => parseInstallMode("sometimes"), /unsupported install mode/);
});

test("parseSourceMode defaults to explicit and rejects unsupported values", () => {
  assert.equal(parseSourceMode(""), "explicit");
  assert.equal(parseSourceMode("explicit"), "explicit");
  assert.equal(parseSourceMode("contract"), "contract");
  assert.throws(() => parseSourceMode("repo"), /unsupported source mode/);
});

test("resolveOtaInstallPlan reuses existing binaries in auto mode", () => {
  assert.deepEqual(
    resolveOtaInstallPlan({
      installMode: "auto",
      requestedVersion: "",
      requestedSource: null,
      preferredExisting: "/opt/ota/bin/ota",
      preferred: "ota"
    }),
    { action: "use-existing", path: "/opt/ota/bin/ota" }
  );
});

test("resolveOtaInstallPlan installs when auto mode has no binary or a requested version", () => {
  assert.deepEqual(
    resolveOtaInstallPlan({
      installMode: "auto",
      requestedVersion: "",
      requestedSource: null,
      preferredExisting: "",
      preferred: "ota"
    }),
    { action: "install" }
  );

  assert.deepEqual(
    resolveOtaInstallPlan({
      installMode: "auto",
      requestedVersion: "v1.6.9",
      requestedSource: { kind: "version", version: "v1.6.9" },
      preferredExisting: "/opt/ota/bin/ota",
      preferred: "ota"
    }),
    { action: "install" }
  );
});

test("resolveOtaInstallPlan keeps never mode fail closed", () => {
  assert.deepEqual(
    resolveOtaInstallPlan({
      installMode: "never",
      requestedVersion: "",
      requestedSource: null,
      preferredExisting: "/opt/ota/bin/ota",
      preferred: "ota"
    }),
    { action: "use-existing", path: "/opt/ota/bin/ota" }
  );

  assert.match(
    resolveOtaInstallPlan({
      installMode: "never",
      requestedVersion: "",
      requestedSource: null,
      preferredExisting: "",
      preferred: "ota"
    }).message,
    /install=never prevents automatic installation/
  );

  assert.match(
    resolveOtaInstallPlan({
      installMode: "never",
      requestedVersion: "v1.6.9",
      requestedSource: { kind: "version", version: "v1.6.9" },
      preferredExisting: "/opt/ota/bin/ota",
      preferred: "ota"
    }).message,
    /ota-version requires install=auto or install=always/
  );
});

test("resolveOtaInstallPlan installs in auto mode for contract-owned git revisions", () => {
  assert.deepEqual(
    resolveOtaInstallPlan({
      installMode: "auto",
      requestedVersion: "",
      requestedSource: { kind: "git_rev", rev: "756b2b982e42de1b09a76a6d53c59962a94c2a30" },
      preferredExisting: "/opt/ota/bin/ota",
      preferred: "ota"
    }),
    { action: "install" }
  );
});

test("postInstallBinaryDirectories prefers OTA_BIN_DIR and PATH before static fallbacks", () => {
  const directories = postInstallBinaryDirectories({
    OTA_BIN_DIR: "/tmp/ota-bin",
    HOME: "/tmp/home",
    PATH: "/tmp/home/.cargo/bin:/usr/bin:/tmp/home/.local/bin"
  }, "linux");
  assert.deepEqual(directories, [
    "/tmp/ota-bin",
    "/tmp/home/.cargo/bin",
    "/usr/bin",
    "/tmp/home/.local/bin"
  ]);
});

test("resolveBootstrapSourceFromContract reads structured git rev truth", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ota-action-contract-"));
  const contract = path.join(directory, "ota.yaml");
  await fs.writeFile(contract, `version: 1
project:
  name: demo
agent:
  bootstrap:
    ota:
      source:
        kind: git_rev
        rev: 756b2b982e42de1b09a76a6d53c59962a94c2a30
`);

  const resolved = await resolveBootstrapSourceFromContract(directory, fs);
  assert.deepEqual(resolved, {
    contractPath: contract,
    kind: "git_rev",
    rev: "756b2b982e42de1b09a76a6d53c59962a94c2a30"
  });
  await fs.rm(directory, { recursive: true, force: true });
});

test("resolveBootstrapSourceFromContract infers legacy shell version truth", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ota-action-contract-"));
  const contract = path.join(directory, "ota.yaml");
  await fs.writeFile(contract, `version: 1
project:
  name: demo
agent:
  bootstrap:
    ota:
      sh: curl -fsSL https://dist.ota.run/install.sh | OTA_VERSION=v1.6.20 sh
`);

  const resolved = await resolveBootstrapSourceFromContract(contract, fs);
  assert.deepEqual(resolved, {
    contractPath: contract,
    kind: "version",
    version: "v1.6.20"
  });
  await fs.rm(directory, { recursive: true, force: true });
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

test("ciWorkflowDrift recognizes canonical merge-gate and CI drift evidence", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: true,
    path: "/repo/ota.yaml",
    mode: "native",
    summary: { verdict: "risky" },
    findings: [
      { code: "OTA_CI_VERIFICATION_DRIFT" },
      { code: "OTA_RUNTIME_VERSION_MISMATCH" }
    ],
    governance: {
      merge_gate: { state: "drift_detected" }
    }
  }));

  assert.deepEqual(ciWorkflowDrift(payload), {
    detected: true,
    mergeGateState: "drift_detected",
    findingCodes: ["OTA_CI_VERIFICATION_DRIFT"]
  });
});

test("ciWorkflowDrift recognizes duplicated CI bootstrap truth", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: true,
    findings: [{
      code: "OTA_CI_BOOTSTRAP_TRUTH_DUPLICATED",
      severity: "warn"
    }]
  }));

  assert.deepEqual(ciWorkflowDrift(payload), {
    detected: true,
    mergeGateState: "",
    findingCodes: ["OTA_CI_BOOTSTRAP_TRUTH_DUPLICATED"]
  });
});

test("ciWorkflowDrift ignores ordinary doctor warnings", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: true,
    path: "/repo/ota.yaml",
    mode: "native",
    summary: { verdict: "risky" },
    findings: [{ code: "OTA_RUNTIME_VERSION_MISMATCH" }],
    governance: {
      merge_gate: { state: "projected" }
    }
  }));

  assert.deepEqual(ciWorkflowDrift(payload), {
    detected: false,
    mergeGateState: "projected",
    findingCodes: []
  });
});

test("drift-only annotations exclude unrelated doctor findings", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: false,
    findings: [
      { code: "OTA_WORKFLOW_SURFACE_READINESS_FAILED", severity: "error" },
      { code: "OTA_CI_VERIFICATION_DRIFT", severity: "warn" }
    ]
  }));

  assert.deepEqual(
    findingsForAnnotations(payload, "doctor", { ciWorkflowDriftOnly: true }),
    [{ code: "OTA_CI_VERIFICATION_DRIFT", severity: "warn" }]
  );
});

test("summary markdown explains when no baseline artifact was restored", () => {
  const payload = parseOtaPayload(JSON.stringify({
    ok: true,
    mode: "receipt",
    receipt: {
      ok: true,
      summary: {
        error_count: 0,
        warn_count: 0,
        info_count: 0,
        step_count: 1
      }
    },
    summary: {
      error_count: 0,
      warn_count: 0,
      info_count: 0
    }
  }));

  const kind = inferKind(payload);
  const summary = normalizeSummary(payload, kind);
  const markdown = buildSummaryMarkdown({
    commandLine: "ota receipt --json --archive --mode native .",
    payload,
    kind,
    status: "ready",
    summary,
    archivePath: "/tmp/repo-receipt.json",
    artifactName: "ota-readiness",
    outputPath: "/tmp/ota.json",
    runUrl: null,
    baselineInfo: {
      artifactName: "ota-readiness",
      restored: false,
      path: ""
    }
  });

  assert.match(markdown, /Baseline restore: none from `ota-readiness`; current receipt only/);
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

test("prioritizeRuntimeNodePath moves the runtime node directory to PATH front", () => {
  assert.equal(
    prioritizeRuntimeNodePath({
      PATH: "/bin:/usr/local/bin:/tmp/node"
    }, "/tmp/node/bin/node").PATH,
    "/tmp/node/bin:/bin:/usr/local/bin:/tmp/node"
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
