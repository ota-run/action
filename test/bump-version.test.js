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

import test from "node:test";
import assert from "node:assert/strict";

import { bump, parseVersion } from "../lib/bump-version.mjs";

test("parseVersion preserves full prerelease and build metadata", () => {
  assert.deepEqual(parseVersion("1.2.3-alpha-beta.1+build.9"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: "alpha-beta.1",
    build: "build.9"
  });
});

test("bump prerelease preserves full prerelease identifier", () => {
  assert.equal(
    bump("1.2.3-alpha-beta.1", "prerelease"),
    "1.2.4-alpha-beta.1"
  );
});

test("bump ignores build metadata in the current version", () => {
  assert.equal(bump("1.2.3+build.9", "patch"), "1.2.4");
  assert.equal(
    bump("1.2.3-alpha-beta.1+build.9", "prerelease"),
    "1.2.4-alpha-beta.1"
  );
});

test("explicit semver values may include build metadata", () => {
  assert.equal(
    bump("1.2.3", "1.2.4-alpha-beta.1+build.9"),
    "1.2.4-alpha-beta.1+build.9"
  );
});
