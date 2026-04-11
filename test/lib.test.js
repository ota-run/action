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
  inferKind,
  normalizeOtaVersion,
  normalizeSummary,
  otaBinaryName,
  otaInstallDirectories,
  parseInstallMode,
  parseOtaPayload
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
  assert.match(markdown, /Review config/);
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
});
