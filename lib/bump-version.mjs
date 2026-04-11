/*
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
*/

import fs from "node:fs";
import path from "node:path";

const packageJsonPath = path.join(process.cwd(), "package.json");
const packageLockPath = path.join(process.cwd(), "package-lock.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));

const input = process.env.OTA_INPUT_VERSION ?? process.argv[2] ?? "patch";
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function bump(version, part) {
  const [main, prerelease] = version.split("-");
  const [major, minor, patch] = main.split(".").map(Number);

  if (semverPattern.test(part)) {
    return part;
  }

  if (part === "major") {
    return `${major + 1}.0.0`;
  }

  if (part === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  if (part === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }

  if (part === "prerelease") {
    const base = `${major}.${minor}.${patch + 1}`;
    return prerelease ? `${base}-${prerelease}` : `${base}-rc.0`;
  }

  throw new Error(
    `Unsupported version bump "${part}". Use major, minor, patch, prerelease, or an explicit semver value.`,
  );
}

const nextVersion = bump(packageJson.version, input);

packageJson.version = nextVersion;
packageLock.version = nextVersion;

if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = nextVersion;
}

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
process.stdout.write(`${nextVersion}\n`);
