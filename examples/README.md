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

# Examples

These are copyable workflow shapes for `ota-run/action@v1`.

Use them when you want the action contract in a real workflow file instead of reconstructing the
inputs from the reference docs.

## Files

- [recommended-pr-gate.yml](recommended-pr-gate.yml) - opinionated pull-request gate with archived receipts, automatic baseline restore, annotations, and sticky PR comments
- [basic-readiness.yml](basic-readiness.yml) - minimal push-only readiness summary and artifact flow
- [baseline-regression-gate.yml](baseline-regression-gate.yml) - compare against the latest successful baseline artifact on the default branch and fail only on new blockers
- [pr-comment-and-annotations.yml](pr-comment-and-annotations.yml) - pull-request summary with annotations and sticky comment updates
- [contract-owned-install.yml](contract-owned-install.yml) - standalone action flow that installs ota from `agent.bootstrap.ota.source` without a separate setup step
- [pinned-ota-version.yml](pinned-ota-version.yml) - same push-only action flow with an explicit `ota-run/setup` version
- [self-hosted-preinstalled.yml](self-hosted-preinstalled.yml) - self-hosted runner flow that fails closed unless ota is already available

## Rule

Use `ota-run/setup` for installation, then run this action with `install: never`. Use
`command: receipt` as the default CI path unless you specifically need the richer `doctor`
verdict surface. When this action intentionally owns installation by itself, use `source: contract`
so workflow YAML does not duplicate `agent.bootstrap.ota.source`.
