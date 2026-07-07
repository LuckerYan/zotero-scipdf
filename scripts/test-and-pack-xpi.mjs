/* global console, process */

import { spawnSync } from "node:child_process";

function run(command, args, shell = process.platform === "win32") {
  return spawnSync(command, args, {
    shell,
    stdio: "inherit",
  });
}

const testResult = run("zotero-plugin", ["test"]);
const testExitCode = testResult.status ?? (testResult.error ? 1 : 0);

if (testResult.error) {
  console.error(testResult.error);
}

const packResult = run(process.execPath, ["scripts/pack-xpi.mjs"], false);
const packExitCode = packResult.status ?? (packResult.error ? 1 : 0);

if (packResult.error) {
  console.error(packResult.error);
}

process.exit(testExitCode === 0 ? packExitCode : testExitCode);
