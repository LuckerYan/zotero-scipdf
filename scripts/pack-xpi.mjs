/* global Buffer, console, process */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, ".scaffold", "build");
const addonDir = path.join(buildDir, "addon");
const outputXpi = path.join(buildDir, "sci-pdf.xpi");
const outputZip = path.join(buildDir, "sci-pdf.zip");
const requiredRootFiles = [
  "manifest.json",
  "bootstrap.js",
  path.join("content", "scripts", "scipdf.js"),
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function uint16(value) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function collectFiles(dir, base = dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const absolutePath = path.join(dir, name);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        return collectFiles(absolutePath, base);
      }
      if (!stats.isFile()) {
        return [];
      }
      const relativePath = path
        .relative(base, absolutePath)
        .split(path.sep)
        .join("/");
      return [{ absolutePath, relativePath, stats }];
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function assertAddonBuildReady() {
  if (!existsSync(addonDir)) {
    throw new Error(`Addon build directory not found: ${addonDir}`);
  }

  for (const requiredFile of requiredRootFiles) {
    const absolutePath = path.join(addonDir, requiredFile);
    if (!existsSync(absolutePath)) {
      throw new Error(`Required addon file is missing: ${absolutePath}`);
    }
  }
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const content = readFileSync(file.absolutePath);
    const compressed = deflateRawSync(content, { level: 9 });
    const name = Buffer.from(file.relativePath, "utf8");
    const checksum = crc32(content);
    const { dosDate, dosTime } = dosDateTime(file.stats.mtime);

    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(8),
      uint16(dosTime),
      uint16(dosDate),
      uint32(checksum),
      uint32(compressed.length),
      uint32(content.length),
      uint16(name.length),
      uint16(0),
      name,
    ]);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0),
      uint16(8),
      uint16(dosTime),
      uint16(dosDate),
      uint32(checksum),
      uint32(compressed.length),
      uint32(content.length),
      uint16(name.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(offset),
      name,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(files.length),
    uint16(files.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0),
  ]);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}

function main() {
  assertAddonBuildReady();
  mkdirSync(buildDir, { recursive: true });
  rmSync(outputXpi, { force: true });
  rmSync(outputZip, { force: true });

  const files = collectFiles(addonDir);
  if (files.length === 0) {
    throw new Error(`No files found under addon build directory: ${addonDir}`);
  }

  const zip = createZip(files);
  writeFileSync(outputXpi, zip);

  const rootEntries = new Set(files.map((file) => file.relativePath));
  for (const requiredFile of requiredRootFiles) {
    const normalized = requiredFile.split(path.sep).join("/");
    if (!rootEntries.has(normalized)) {
      throw new Error(`XPI root verification failed for: ${normalized}`);
    }
  }

  console.log(
    `Packed ${files.length} files into ${path.relative(repoRoot, outputXpi)} (${zip.length} bytes)`,
  );
}

main();
