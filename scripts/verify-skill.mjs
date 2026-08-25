import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const expectedReferences = ["authentication.md", "docs-discovery.md", "integration-safety.md"];
const forbiddenPatterns = [
  [/\/v1\//u, "copied API path"],
  [
    /(?:operation[_-]?id|\b(?:get|post|put|patch|delete)_[a-z0-9]+(?:_[a-z0-9]+){2,}\b)/iu,
    "copied operation identifier",
  ],
  [/\?[a-z0-9_-]+=/iu, "query-parameter example"],
  [/"[a-z][a-z0-9_]*"\s*:/iu, "JSON payload example"],
  [/mochi_sk_(?:live|test)_/iu, "API key example"],
  [/Authorization:\s*Bearer/iu, "authorization-header example"],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u, "JWT-shaped content"],
  [/TheMochiApp\/mochi-agent/u, "legacy repository name"],
  [
    /mochi\s+(?:api|automations?|flows?|leads?)\s+(?:create|delete|patch|post|run|send|update)/iu,
    "write-oriented CLI command",
  ],
  [/\b\d+\s+(?:requests?|seconds?|minutes?|hours?)\b/iu, "copied retry or rate-limit value"],
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n(?<frontmatter>[\s\S]*?)\n---\n/u);
  if (!match?.groups) return undefined;
  const fields = new Map();
  for (const line of match.groups.frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) return undefined;
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return fields;
}

async function collectSkillFiles(skillRoot) {
  const files = [];
  const errors = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const relativePath = relative(skillRoot, entryPath).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push(relativePath);
      else errors.push(`Unsupported skill entry: ${relativePath}.`);
    }
  }

  await visit(skillRoot);
  return { files: files.sort(), errors };
}

export async function inspectSkillRepository(repositoryRoot) {
  const errors = [];
  const skillsRoot = resolve(repositoryRoot, "skills");
  const skillRoot = resolve(skillsRoot, "mochi-api");

  if (await exists(resolve(repositoryRoot, "SKILL.md"))) errors.push("A root SKILL.md must not shadow nested skills.");
  if (!(await exists(skillsRoot))) return ["The skills directory is missing."];

  const skillDirectories = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (skillDirectories.join(",") !== "mochi-api") {
    errors.push(`Expected exactly mochi-api, found: ${skillDirectories.join(", ") || "none"}.`);
  }
  if (!(await exists(skillRoot))) return errors.sort();

  const expectedFiles = ["SKILL.md", "agents/openai.yaml", ...expectedReferences.map((name) => `references/${name}`)];
  const collected = await collectSkillFiles(skillRoot);
  errors.push(...collected.errors);
  for (const relativePath of collected.files) {
    if (!expectedFiles.includes(relativePath)) errors.push(`Unexpected skill file: ${relativePath}.`);
  }
  for (const relativePath of expectedFiles) {
    if (!(await exists(resolve(skillRoot, relativePath)))) errors.push(`Missing skill file: ${relativePath}.`);
  }
  const availableFiles = new Set(collected.files);
  if (!availableFiles.has("SKILL.md")) return errors.sort();

  const entrypoint = await readFile(resolve(skillRoot, "SKILL.md"), "utf8");
  const frontmatter = parseFrontmatter(entrypoint);
  if (!frontmatter) {
    errors.push("SKILL.md frontmatter is invalid.");
  } else {
    const keys = [...frontmatter.keys()].sort();
    if (keys.join(",") !== "description,name")
      errors.push("SKILL.md frontmatter must contain only name and description.");
    if (frontmatter.get("name") !== "mochi-api") errors.push("SKILL.md name must be mochi-api.");
    const description = frontmatter.get("description") ?? "";
    if (!description || description.length > 1024) errors.push("SKILL.md description must be non-empty and bounded.");
  }
  if (entrypoint.split("\n").length > 500) errors.push("SKILL.md exceeds the portable line budget.");

  for (const referenceName of expectedReferences) {
    const link = `references/${referenceName}`;
    if (entrypoint.split(link).length - 1 !== 1) errors.push(`${link} must be linked exactly once from SKILL.md.`);
    const referencePath = `references/${referenceName}`;
    if (!availableFiles.has(referencePath)) continue;
    const reference = await readFile(resolve(skillRoot, referencePath), "utf8");
    if (/\]\((?:\.\.\/)?references\//u.test(reference)) {
      errors.push(`${referenceName} must not create a nested reference chain.`);
    }
  }

  const files = await Promise.all(
    collected.files.map(async (relativePath) => ({
      relativePath,
      content: await readFile(resolve(skillRoot, relativePath), "utf8"),
    })),
  );
  for (const { relativePath, content } of files) {
    if (/\[TODO:[^\]]*\]|\bTBD\b/u.test(content)) errors.push(`${relativePath} contains an unresolved placeholder.`);
    for (const [pattern, label] of forbiddenPatterns) {
      if (pattern.test(content)) errors.push(`${relativePath} contains forbidden ${label}.`);
    }
  }

  if (availableFiles.has("agents/openai.yaml")) {
    const metadata = await readFile(resolve(skillRoot, "agents/openai.yaml"), "utf8");
    if (!metadata.includes('display_name: "Mochi API"')) errors.push("OpenAI metadata display name is missing.");
    if (!metadata.includes("$mochi-api")) errors.push("OpenAI default prompt must explicitly invoke $mochi-api.");
    if (metadata.includes("allow_implicit_invocation: false"))
      errors.push("Implicit skill discovery must remain enabled.");
  }

  return errors.sort();
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = resolve(dirname(scriptPath), "..");
  const errors = await inspectSkillRepository(repositoryRoot);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`skill validation: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("mochi-api skill validation passed\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
