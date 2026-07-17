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

- drift-only gates now annotate only contract-to-CI drift findings when `fail-on-error: false`,
  keeping unrelated Doctor readiness findings out of a passing gate.

- added `fail-on-ci-drift` to `ota-run/action`, an opt-in `command: doctor` gate that fails only
  when Ota's canonical merge-gate or CI verification/bootstrap drift evidence establishes
  contract-to-workflow drift; the action now publishes `ci-drift-detected` and includes a
  copy-ready required-check example
- added contract-owned install truth to `ota-run/action`: it now supports `source: contract`
  plus `contract-path`, can read `agent.bootstrap.ota.source` from `ota.yaml`, and can install
  deterministic `version`, `git_rev`, `branch`, or inferred legacy shell truth instead of
  forcing workflows to restate Ota install configuration separately
- fixed standalone installer binary selection to prefer the freshly installed Ota binary before
  stale fallback copies on PATH-standard locations
- aligned the action repo's own contract and workflows to the new surface so CI, readiness, and
  release verification all consume repo-owned Ota bootstrap truth through `source: contract`
- pinned the action repo's temporary setup workflow consumption to the exact `ota-run/setup`
  commit that already ships `source: contract`, so first-party proof stays green until that setup
  release is published under `@v1`
- fixed the action repo's own pressure bootstrap truth to use the real pushed Ota commit SHA for
  `source.kind: git_rev`; the earlier GitHub failure was caused by an invalid revision value, not
  by a broken cross-repo `git_rev` install lane
- made the setup/action boundary explicit: `install` now supports `auto` as the default, reuses an existing `ota` binary before installing, and the docs/examples now teach `ota-run/setup` for installation with `ota-run/action` running/reporting via `install: never`.
- added `command: proof` to `ota-run/action`, backed by `ota proof runtime`, so CI can start a selected workflow, wait for readiness, and archive the canonical runtime-proof artifacts without repo-local background/wait glue.
- added a `workflow` input to `ota-run/action` so CI can target a non-default Ota workflow explicitly instead of always inheriting the repo default.
- clarified in the action docs that `command: receipt` stays read-only and does not implicitly start live workflow run tasks; jobs that archive receipts for live-surface workflows should start them first or target a different workflow explicitly.

## 1.0.8 - 2026-05-09

- made the action thinner and more canonical for doctor-style reporting: `doctor` and receipt baseline diff step summaries, sticky PR comments, and doctor GitHub annotations now prefer Ota's `ota annotations` renderer, while still falling back to the bundled JavaScript renderer when an older installed Ota version cannot provide that surface
- aligned release docs and contract guidance with the current `ota run version:bump --version ...` form, including the rule that Ota command flags such as `--stream` should appear before task inputs.
- made pull request `receipt` runs automatically try to restore the latest successful artifact named by `artifact-name` when no explicit baseline source is configured, so the default PR gate path needs less setup.
- added a recommended PR gate workflow example and updated the action docs to make archived receipts, automatic baseline restore, annotations, and sticky PR comments the clearest adoption path.
- removed the compatibility-era `baseline-artifact-name` input, made the PR gate defaults opinionated (`artifact-name: ota-readiness`, `comment-pr: true`, `fail-on-new-blockers: true`), and changed installer mode to `always`/`never` with `always` as the default.
- added automatic main-branch release in CI: after verification and smoke tests pass, CI now creates the version tag from `package.json`, updates the major tag, and publishes/updates a GitHub release using the changelog entry for release notes.

## 1.0.7 - 2026-04-18

- improved GitHub step summaries and sticky pull request comments so they now lead with the derived outcome, surface the primary blocker or change more clearly, include explicit next steps, and group receipt or baseline references into more operator-friendly sections.

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
