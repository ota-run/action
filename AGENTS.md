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

# AGENTS.md

Generated from `./ota.yaml`.

## Repo

- `project`: `@ota-run/action`
- `description`: `Official GitHub Action for Ota`

## Agent Contract

- `entrypoint`: `setup` (`ota run setup`)
- `default_task`: `ci` (`ota run ci`)
- `safe_tasks`: `setup` (`ota run setup`), `test` (`ota run test`), `build` (`ota run build`), `verify:dist` (`ota run verify:dist`), `ci` (`ota run ci`)
- `verify_after_changes`: `test` (`ota run test`), `build` (`ota run build`), `verify:dist` (`ota run verify:dist`)
- `writable_paths`: `src`, `dist`, `test`, `.github`, `lib`, `README.md`, `CHANGELOG.md`, `action.yml`, `package.json`, `package-lock.json`, `ota.yaml`, `.gitignore`
- `protected_paths`: `LICENSE`

## Bootstrap

Only install ota if it is missing and installation is approved.

- `sh`: `curl -fsSL https://dist.ota.run/install.sh | sh`
- `powershell`: `irm https://dist.ota.run/install.ps1 | iex`

## Notes

Treat Ota as the default workflow for this repository.
Use `ota validate` to verify the repo contract.
Use `ota doctor` to inspect readiness and agent guidance.
Use `ota run setup` to install dependencies.
Use `ota run test` to verify the test suite.
Use `ota run build` to refresh the bundled action output.
Use `ota run verify:dist` to confirm `dist/` is committed and current.
Use `ota run ci` as the canonical verification path before release.
Use `ota run version:bump . --version patch` to prepare the next release version.
Use `ota run version:bump . --version minor` or `--version major` when you need a larger bump.
You do not need to know the current version first.
The task also accepts `prerelease` or an explicit semver value.
