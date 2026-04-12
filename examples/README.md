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

- [basic-readiness.yml](basic-readiness.yml) - minimal read-only readiness summary and artifact flow
- [pr-comment-and-annotations.yml](pr-comment-and-annotations.yml) - pull-request summary with annotations and sticky comment updates
- [pinned-ota-version.yml](pinned-ota-version.yml) - same action flow with an explicit ota installer version
- [self-hosted-preinstalled.yml](self-hosted-preinstalled.yml) - self-hosted runner flow that fails closed unless ota is already available

## Rule

Use `command: receipt` as the default CI path unless you specifically need the richer `doctor`
verdict surface.
