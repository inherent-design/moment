import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const files = [];
const generatedDirectories = new Set([".tools", ".lake", "artifacts", "dist", "coverage"]);

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    if (directory === root && generatedDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
}

await walk(root);
const texts = new Map(await Promise.all(files.map(async file => [file, await readFile(file, "utf8")])));
const slug = text => text.toLowerCase().replace(/[`*_]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");

function anchors(text) {
  const result = new Set();
  const seen = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = slug(match[1]);
    const count = seen.get(base) ?? 0;
    result.add(count ? `${base}-${count}` : base);
    seen.set(base, count + 1);
  }
  return result;
}

let links = 0;
for (const [file, text] of texts) {
  if (!/^# \S/m.test(text)) failures.push(`${path.relative(root, file)}: missing title`);
  if (!text.endsWith("\n")) failures.push(`${path.relative(root, file)}: missing final newline`);
  if (text.split("\n").some(line => /\s+$/.test(line))) failures.push(`${path.relative(root, file)}: trailing whitespace`);
  const fences = text.match(/^```/gm) ?? [];
  if (fences.length % 2) failures.push(`${path.relative(root, file)}: unmatched code fence`);
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const destination = match[1];
    if (/^(https?:|mailto:)/.test(destination)) continue;
    links++;
    const [relative, fragment] = destination.split("#");
    const target = relative ? path.resolve(path.dirname(file), decodeURIComponent(relative)) : file;
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      failures.push(`${path.relative(root, file)}: nonportable link ${destination}`);
      continue;
    }
    try {
      if (!(await stat(target)).isFile()) throw new Error("not a file");
      if (fragment && target.endsWith(".md")) {
        const targetText = texts.get(target) ?? await readFile(target, "utf8");
        if (!anchors(targetText).has(decodeURIComponent(fragment))) throw new Error("missing anchor");
      }
    } catch (error) {
      failures.push(`${path.relative(root, file)}: ${destination}: ${error.message}`);
    }
  }
}

// The declaration convention keeps one quoted method name at two-space indent.
// Compilation separately checks the full TypeScript syntax and type semantics.
const owners = [
  { contract: "contracts/index.ts", pattern: /^export interface Methods \{([\s\S]*?)^\}/m, reference: "docs/reference/protocol.md" },
  { contract: "contracts/evolution.ts", pattern: /^export interface EvolutionMethods \{([\s\S]*?)^\}/m, reference: "docs/reference/guidance.md", section: "## Public operation contract" },
];
let methodEntries = 0;
for (const owner of owners) {
  const contract = await readFile(path.join(root, owner.contract), "utf8");
  const methods = contract.match(owner.pattern)?.[1];
  if (!methods) failures.push(`Missing method interface: ${owner.contract}`);
  const names = [...(methods ?? "").matchAll(/^  ["']([a-z]+\.[a-z]+)["']:/gm)].map(match => match[1]);
  if (!names.length) failures.push(`No methods found under the declaration convention: ${owner.contract}`);
  const reference = await readFile(path.join(root, owner.reference), "utf8");
  const protocol = owner.section ? reference.split(`${owner.section}\n`)[1]?.split(/\n## /)[0] : reference;
  if (!protocol) failures.push(`Missing method reference section: ${owner.reference}`);
  const documented = [...(protocol ?? "").matchAll(/^\| `([a-z]+\.[a-z]+)` \|/gm)].map(match => match[1]);
  for (const name of names) {
    if (documented.filter(value => value === name).length !== 1) failures.push(`Method must have exactly one reference entry in ${owner.reference}: ${name}`);
  }
  for (const name of documented) if (!names.includes(name)) failures.push(`Documented method is undeclared in ${owner.contract}: ${name}`);
  methodEntries += names.length;
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${files.length} Markdown files, ${links} local links, and ${methodEntries} method entries.\n`);
}
