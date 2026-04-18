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

- runs `ota doctor --json` or `ota receipt --json --archive`
- can compare a current receipt against an explicit or restored baseline receipt
- writes a GitHub Actions step summary
- emits GitHub annotations from Ota findings
- optionally posts or updates a pull request comment
- uploads the ota JSON output and any archived receipt file as workflow artifacts
- formats summaries and sticky pull request comments around outcome, primary blocker or change, next steps, and receipt or baseline references

## Requirements

- the workflow should use `permissions: pull-requests: write` if `comment-pr` is enabled
- the workflow should use `permissions: actions: read` if `baseline-artifact-name` is enabled
- self-hosted runners should be on Actions Runner `v2.327.1` or later for Node 24-based actions
- by default the action installs Ota automatically when it is not already available

## Usage

```yaml
permissions:
  actions: read
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v5

  - name: ota readiness
    uses: ota-run/action@v1
    with:
      command: receipt
      path: .
      archive: true
      annotate: true
      comment-pr: true
      github-token: ${{ github.token }}
```

## Examples

Copyable workflow files live in [examples/](./examples).

- [basic-readiness.yml](./examples/basic-readiness.yml)
- [baseline-regression-gate.yml](./examples/baseline-regression-gate.yml)
- [pr-comment-and-annotations.yml](./examples/pr-comment-and-annotations.yml)
- [pinned-ota-version.yml](./examples/pinned-ota-version.yml)
- [self-hosted-preinstalled.yml](./examples/self-hosted-preinstalled.yml)

## Inputs

- `command`
  - `receipt` or `doctor`
  - default: `receipt`
- `path`
  - repo or contract target passed to Ota
  - default: `.`
- `baseline`
  - optional baseline passed to `ota receipt --baseline`
  - supports `latest` or a receipt JSON file path
- `baseline-artifact-name`
  - restores the latest successful artifact with this name from the current workflow on the repository default branch and uses its archived receipt as the compare baseline
  - requires `actions: read` and a token through `github-token` or `GITHUB_TOKEN`
- `fail-on-new-blockers`
  - when `true`, adds `--fail-on-new-blockers` for receipt baseline compares
  - default: `false`
- `working-directory`
  - working directory used when invoking `ota`
  - default: `.`
- `execution-mode`
  - `native` or `container`
  - default: `native`
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
  - default: `false`
- `comment-pr-only`
  - only comment when the workflow event is a pull request
  - default: `true`
- `artifact-name`
  - uploaded artifact name
  - default: `ota-report`
- `artifact-retention-days`
  - optional artifact retention in days
- `fail-on-error`
  - fail the action when the derived action status is `blocked`
  - default: `true`
  - baseline compare gates can report `risky` when baseline debt remains but no new blockers were introduced
- `install`
  - `auto`, `always`, or `never`
  - default: `auto`
  - `auto` reuses an existing `ota` binary when present and otherwise installs Ota automatically
  - `always` installs Ota before running
  - `never` requires Ota to already be available
- `ota-version`
  - optional installer version such as `v1.0.1` or `1.0.1`
  - when set, the action installs that version through the official installer
- `ota-bin`
  - Ota binary name or path
  - default: `ota`
- `output-path`
  - where the captured Ota JSON output is written
  - default: `.ota-action-output.json`
- `github-token`
  - optional token used for pull request comment updates

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
- `primary-summary`

## Notes

- `receipt` is the better default for CI because it is archive-friendly and read-only.
- when `baseline-artifact-name` is enabled, the action restores the latest successful artifact from the same workflow on the default branch and prefers the archived receipt inside that artifact as the compare baseline.
- receipt baseline mode is a two-step wrapper: the action captures the current receipt for archive continuity, then runs the compare output used for summaries, annotations, comments, and failure semantics.
- step summaries and sticky pull request comments lead with the derived outcome, then show the primary blocker or change, explicit next steps, and any receipt or baseline references available from Ota.
- receipt diff summaries and sticky pull request comments include baseline provenance when Ota provides it, including the source plus selection path, archive path, and promoted or archived time.
- `doctor` is useful when you want the richer top-level `verdict` and `primary_blocker` semantics.
- archived receipts are referenced by local path in the summary and uploaded as artifacts when available.
- use `install: never` on self-hosted runners when Ota is already provisioned and you want the action to fail closed instead of mutating the runner

## Developing This Repo

This repository is also managed through Ota.

- `ota validate` checks the repo contract.
- `ota run setup` installs local dependencies.
- `ota run ci` runs the canonical verification path for this repo.
- `ota run version:bump --version patch` prepares the next release version without creating a tag.

## License

Apache-2.0. See [LICENSE](./LICENSE).
