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

## 1.0.1 - 2026-04-11

- moved the action runtime and repository workflows to Node 24-compatible GitHub Actions surfaces to remove the hosted-runner Node 20 deprecation warning.

## 1.0.0 - 2026-04-11

- bootstrapped the official Ota GitHub Action repo with a thin `doctor` and `receipt` integration surface that runs `ota`, emits GitHub summaries and annotations, uploads artifacts, and can update a sticky pull request comment.
- added a canonical `ota.yaml` contract for the action repo and moved CI onto `ota validate`, `ota run setup`, and `ota run ci`.
- added a release workflow that verifies semver tags through Ota, updates the matching major action tag, and publishes a GitHub release.
