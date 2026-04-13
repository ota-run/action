<!--
                █████
               ░░███
       ██████  ███████    ██████
      ███░░███░░░███░    ░░░░░███
     ░███ ░███  ░███      ███████
     ░███ ░███  ░███ ███ ███░░███
     ░░██████   ░░█████ ░░████████
      ░░░░░░     ░░░░░   ░░░░░░░░

   Copyright (C) 2026 — 2026, Ota. All Rights Reserved.

   DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.

   Licensed under the Apache License, Version 2.0. See LICENSE for the full license text.
   You may not use this file except in compliance with that License.
   Unless required by applicable law or agreed to in writing, software distributed under the
   License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
   either express or implied. See the License for the specific language governing permissions
   and limitations under the License.

   If you need additional information or have any questions, please email: os@ota.run
-->

# Changelog

## Unreleased

## 1.0.6 - 2026-04-14

- fixed `ota run version:bump` semver handling so prerelease identifiers with internal hyphens and explicit build metadata are preserved instead of being truncated.
- added baseline provenance lines to receipt diff step summaries and sticky pull request comments, including source, selection path, archive path, and promoted or archived time when present.

## 1.0.5 - 2026-04-13

- added receipt baseline compare support to `ota-run/action`, including `baseline`, `baseline-artifact-name`, and `fail-on-new-blockers` inputs plus gate-aware status and outputs for GitHub-native regression gating.
- restored compare baselines from the latest successful artifact of the current workflow on the default branch so fresh GitHub runners can gate on persisted archived receipts instead of runner-local state.

## 1.0.4 - 2026-04-12

- added copyable workflow examples under `examples/` for basic readiness, PR comments and annotations, pinned ota versions, and self-hosted preinstalled runners.
- fixed archived receipt handling so relative `archive_path` values are resolved against `working-directory` before summary and artifact upload logic runs.
- fixed validate/load failure summaries so the primary contract error stays visible in the step summary and `primary-summary` output.
- fixed `receipt --archive` compatibility in the action by retrying without archive when the installed ota release does not yet support the archived receipt flag.

## 1.0.3 - 2026-04-11

- fixed action metadata YAML parsing by quoting colon-bearing descriptions in `action.yml`.
- fixed Windows artifact root handling for action uploads.
- added hosted-runner smoke coverage for `ubuntu`, `macos`, and `windows` using a minimal contract fixture in CI.

## 1.0.2 - 2026-04-11

- made `ota-run/action` self-install `ota` by default through the official installer, with `install` and `ota-version` controls for pinned or pre-provisioned runners.
- added `ota run version:bump` for Ota-native release preparation in the action repo.

## 1.0.1 - 2026-04-11

- moved the action runtime and repository workflows to Node 24-compatible GitHub Actions surfaces to remove the hosted-runner Node 20 deprecation warning.

## 1.0.0 - 2026-04-11

- bootstrapped the official Ota GitHub Action repo with a thin `doctor` and `receipt` integration surface that runs `ota`, emits GitHub summaries and annotations, uploads artifacts, and can update a sticky pull request comment.
- added a canonical `ota.yaml` contract for the action repo and moved CI onto `ota validate`, `ota run setup`, and `ota run ci`.
- added a release workflow that verifies semver tags through Ota, updates the matching major action tag, and publishes a GitHub release.
