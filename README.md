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
2. commit and push `main`
3. create and push a semver tag such as `v1.0.2`

You can replace `patch` with `minor`, `major`, `prerelease`, or an explicit semver value.

## What v1 does

- runs `ota doctor --json` or `ota receipt --json --archive`
- writes a GitHub Actions step summary
- emits GitHub annotations from Ota findings
- optionally posts or updates a pull request comment
- uploads the Ota JSON output and any archived receipt file as workflow artifacts

## Requirements

- `ota` must already be installed on the runner
- the workflow should use `permissions: pull-requests: write` if `comment-pr` is enabled
- self-hosted runners should be on Actions Runner `v2.327.1` or later for Node 24-based actions

Install Ota in GitHub Actions with the same official bootstrap path used across Ota repos:

```yaml
- name: Install ota
  shell: bash
  run: |
    curl -fsSL https://dist.ota.run/install.sh | sh
    echo "$HOME/.local/bin" >> "$GITHUB_PATH"
```

## Usage

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v5

  - name: Install ota
    shell: bash
    run: |
      curl -fsSL https://dist.ota.run/install.sh | sh
      echo "$HOME/.local/bin" >> "$GITHUB_PATH"

  - name: Ota readiness
    uses: ota-run/action@v1
    with:
      command: receipt
      path: .
      archive: true
      annotate: true
      comment-pr: true
      github-token: ${{ github.token }}
```

## Inputs

- `command`
  - `receipt` or `doctor`
  - default: `receipt`
- `path`
  - repo or contract target passed to Ota
  - default: `.`
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
  - fail the action when Ota reports a blocked outcome
  - default: `true`
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
- `artifact-name`
- `error-count`
- `warn-count`
- `info-count`
- `primary-summary`

## Notes

- `receipt` is the better default for CI because it is archive-friendly and read-only.
- `doctor` is useful when you want the richer top-level `verdict` and `primary_blocker` semantics.
- archived receipts are referenced by local path in the summary and uploaded as artifacts when available.

## Developing This Repo

This repository is also managed through Ota.

- `ota validate` checks the repo contract.
- `ota run setup` installs local dependencies.
- `ota run ci` runs the canonical verification path for this repo.
- `ota run version:bump --version patch` prepares the next release version without creating a tag.

## License

Apache-2.0. See [LICENSE](./LICENSE).
