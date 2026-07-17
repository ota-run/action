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

# `ota-run/action`

Official GitHub Action for Ota.

This action is intentionally thin:

- it runs `ota`
- it reads Ota JSON output
- it publishes GitHub-native summaries, annotations, comments, and artifacts
- for `doctor` and receipt baseline diff output, it prefers Ota's canonical `ota annotations` renderer and falls back to the bundled renderer only when the installed Ota version cannot provide that surface

It does not duplicate repo readiness, diagnosis, or provisioning logic.

## Release Model

The public action contract is published through Git tags:

- immutable semver tags such as `v1.0.0`
- a moving major tag such as `v1`

Use semver tags for release history and `v1` for the stable adoption surface in workflows.
When a new semver tag is pushed, the release workflow verifies the repo through Ota, updates the matching major tag, and publishes a GitHub release.

Release prep is Ota-native:

1. `ota run version:bump --version patch`
   Put Ota command flags before task inputs, for example `ota run version:bump --stream --version patch`.
2. commit and push `main`
3. create and push a semver tag such as `v1.0.2`

You can replace `patch` with `minor`, `major`, `prerelease`, or an explicit semver value.

## What v1 does

- runs `ota doctor --json`, `ota receipt --json --archive`, or `ota proof runtime --json`
- can compare a current receipt against an explicit or auto-restored baseline receipt
- automatically restores the latest successful artifact matching `artifact-name` on pull request receipt runs when no explicit baseline file is configured
- writes a GitHub Actions step summary
- emits GitHub annotations from Ota findings
- posts or updates a sticky pull request comment by default
- uploads the ota JSON output plus any archived receipt or runtime-proof artifacts as workflow artifacts
- formats summaries and sticky pull request comments around outcome, primary blocker or change, next steps, and receipt or baseline references

## Requirements

- the workflow should use `permissions: actions: read` and `permissions: pull-requests: write` for the canonical pull-request gate
- self-hosted runners should be on Actions Runner `v2.327.1` or later for Node 24-based actions
- `ota-run/setup` is the canonical Ota installation surface; this action should normally run with `install: never` after setup
- when used alone, this action can derive install truth from `agent.bootstrap.ota.source` with `source: contract`
- when used alone with the default `source: explicit`, this action defaults to `install: auto`, reusing an existing `ota` binary and installing only when one is missing

## Recommended PR Gate

```yaml
permissions:
  actions: read
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v5

  - uses: ota-run/setup@v1

  - name: ota readiness
    uses: ota-run/action@v1
    with:
      command: receipt
      path: .
      archive: true
      fail-on-new-blockers: true
      install: never
      github-token: ${{ github.token }}
```

This is the intended drop-in path:

- the action archives the current receipt under `ota-readiness`
- pull request runs automatically restore the latest successful `ota-readiness` artifact from the same workflow on the default branch
- the receipt diff gate blocks only on newly introduced blockers by default
- the step summary and sticky pull request comment describe the current outcome, the primary blocker or change, and the next operator step

Use [examples/recommended-pr-gate.yml](./examples/recommended-pr-gate.yml) when you want the copyable workflow file directly.

## Contract-to-CI Drift Gate

Use this when a pull request must fail if Ota can establish that contract-owned verification lanes
or contract-owned bootstrap truth have drifted from the GitHub workflow files:

```yaml
- uses: ota-run/action@v1
  with:
    command: doctor
    source: contract
    fail-on-ci-drift: true
    github-token: ${{ github.token }}
```

This consumes Ota's existing `governance.merge_gate` and CI drift findings. It does not turn
ordinary Doctor warnings into failures. Repositories without contract-owned CI verification truth
remain unblocked until Ota has evidence of actual workflow drift.

## Standalone Contract-Owned Install

Use this when you intentionally skip `ota-run/setup` but still want the job to honor the repo's
canonical `agent.bootstrap.ota.source` truth instead of hardcoding installer version or git
revision in workflow YAML.

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v5
  - uses: ota-run/action@v1
    with:
      command: receipt
      source: contract
      contract-path: ota.yaml
```

## Minimal Push-Only Usage

Use this smaller shape only when the workflow does not run on `pull_request` events. The pull-request gate needs `github-token`, `actions: read`, and `pull-requests: write`.

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v5
  - uses: ota-run/setup@v1
  - uses: ota-run/action@v1
    with:
      command: receipt
      install: never
```

## Runtime Proof Usage

Use this when the selected workflow only becomes ready after starting a live run task and you want the action to own that orchestration instead of writing repo-local background and wait glue.

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v5
  - uses: ota-run/setup@v1
  - uses: ota-run/action@v1
    with:
      command: proof
      workflow: docs
      execution-mode: container
      install: never
```

## Examples

Copyable workflow files live in [examples/](./examples).

- [basic-readiness.yml](./examples/basic-readiness.yml)
- [baseline-regression-gate.yml](./examples/baseline-regression-gate.yml)
- [contract-owned-install.yml](./examples/contract-owned-install.yml)
- [pr-comment-and-annotations.yml](./examples/pr-comment-and-annotations.yml)
- [pinned-ota-version.yml](./examples/pinned-ota-version.yml)
- [self-hosted-preinstalled.yml](./examples/self-hosted-preinstalled.yml)
- [contract-ci-drift-gate.yml](./examples/contract-ci-drift-gate.yml)

## Inputs

- `command`
  - `receipt`, `doctor`, or `proof`
  - default: `receipt`
- `path`
  - repo or contract target passed to Ota
  - default: `.`
- `baseline`
  - optional baseline passed to `ota receipt --baseline`
  - supports `latest` or a receipt JSON file path
- `fail-on-new-blockers`
  - when `true`, adds `--fail-on-new-blockers` for receipt baseline compares
  - default: `true`
- `working-directory`
  - working directory used when invoking `ota`
  - default: `.`
- `execution-mode`
  - `native` or `container`
  - default: `native`
- `workflow`
  - optional workflow name passed to Ota
- `member`
  - optional monorepo member target
- `archive`
  - when `true` and `command=receipt`, adds `--archive`
  - default: `true`
- `annotate`
  - emit GitHub annotations from findings
  - default: `true`
- `max-annotations`
  - maximum findings to emit as annotations
  - default: `20`
- `comment-pr`
  - create or update a sticky pull request comment
  - default: `true`
- `comment-pr-only`
  - only comment when the workflow event is a pull request
  - default: `true`
- `artifact-name`
  - uploaded artifact name
  - default: `ota-readiness`
- `artifact-retention-days`
  - optional artifact retention in days
- `fail-on-error`
  - fail the action when the derived action status is `blocked`
  - default: `true`
  - baseline compare gates can report `risky` when baseline debt remains but no new blockers were introduced
- `fail-on-ci-drift`
  - when `true`, fails the action only when `ota doctor` reports contract-to-CI workflow drift
  - default: `false`
  - requires `command: doctor`
- `install`
  - `auto`, `always`, or `never`
  - default: `auto`
  - `auto` reuses an existing Ota binary and installs only when one is missing when `source=explicit`
  - `auto` installs the contract-declared Ota source when `source=contract`
  - `always` installs Ota before running, even when an Ota binary already exists
  - `never` requires Ota to already be available; use this after `ota-run/setup`
- `source`
  - `explicit` or `contract`
  - default: `explicit`
  - `explicit` keeps workflow-owned install truth through `ota-version`
  - `contract` reads `agent.bootstrap.ota.source` from `ota.yaml` and supports structured `kind: version`, `kind: git_rev`, `kind: branch`, plus legacy shell inference
- `contract-path`
  - path to `ota.yaml` or a repo directory containing it when `source=contract`
  - default: `ota.yaml`
- `ota-version`
  - optional installer version such as `v1.0.1` or `1.0.1`
  - when set, the action installs that version through the official installer
  - invalid when `source=contract`
  - prefer `ota-run/setup` for pinned installation in reusable workflows
- `ota-bin`
  - Ota binary name or path
  - default: `ota`
- `output-path`
  - where the captured Ota JSON output is written
  - default: `.ota-action-output.json`
- `github-token`
  - token used for pull request baseline restore and sticky pull request comment updates

## Outputs

- `ok`
- `status`
- `output-path`
- `archive-path`
- `baseline-path`
- `artifact-name`
- `error-count`
- `warn-count`
- `info-count`
- `gate-rule`
- `gate-passed`
- `ci-drift-detected`
- `primary-summary`

## Notes

- `receipt` is the better default for CI when you want archive-friendly, read-only reporting against a repo that is already ready or against a workflow that does not require a live run task.
- `proof` is the right CI surface when the selected workflow only becomes ready after Ota starts and verifies a live runtime path.
- `workflow` lets the action target a non-default repo workflow explicitly when the contract exposes more than one front door.
- prefer `ota-run/setup` plus `install: never` for the canonical split, but use `source: contract` when this action intentionally owns installation by itself.
- on pull request receipt runs, the action automatically restores the latest successful artifact named by `artifact-name` when no explicit baseline file is set.
- receipt baseline mode is a two-step wrapper: the action captures the current receipt for archive continuity, then runs the compare output used for summaries, annotations, comments, and failure semantics.
- `receipt` does not start workflow run tasks for you. Use `command: proof` when the selected workflow defines live surface readiness on a run task and CI needs Ota to start it, wait for readiness, and capture the canonical proof artifacts.
- the canonical pull-request gate expects `github-token`, `actions: read`, and `pull-requests: write`; missing them is now a configuration error, not a soft fallback.
- step summaries and sticky pull request comments lead with the derived outcome, then show the primary blocker or change, explicit next steps, and any receipt or baseline references available from Ota.
- receipt diff summaries and sticky pull request comments include baseline provenance when Ota provides it, including the source plus selection path, archive path, and promoted or archived time.
- `doctor` is useful when you want the richer top-level `verdict` and `primary_blocker` semantics.
- archived receipts are referenced by local path in the summary and uploaded as artifacts when available.
- use `ota-run/setup` plus `install: never` for the canonical split where setup installs Ota and this action only runs/report gates
- use `install: never` on self-hosted runners when Ota is already provisioned and you want the action to fail closed instead of mutating the runner

## Developing This Repo

This repository is also managed through Ota.

- `ota validate` checks the repo contract.
- `ota run setup` installs local dependencies.
- `ota run ci` runs the canonical verification path for this repo.
- `ota run version:bump --version patch` prepares the next release version without creating a tag.

## License

Apache-2.0. See [LICENSE](./LICENSE).
