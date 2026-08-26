import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function skillInstallerInvocation(platform) {
  return platform === "win32" ? { executable: "npx.cmd", shell: true } : { executable: "npx", shell: false };
}

export function skillInstallSource(environment = process.env) {
  return environment.MOCHI_SKILL_SOURCE?.trim() || repositoryRoot;
}

async function main() {
  const installRoot = await mkdtemp(join(tmpdir(), "mochi-skill-install-"));

  try {
    await mkdir(installRoot, { recursive: true });
    await writeFile(join(installRoot, "package.json"), '{"private":true}\n', { mode: 0o600 });
    const invocation = skillInstallerInvocation(process.platform);
    execFileSync(
      invocation.executable,
      [
        "--yes",
        "skills@1.5.18",
        "add",
        skillInstallSource(),
        "--skill",
        "mochi-api",
        "--agent",
        "codex",
        "--copy",
        "--yes",
      ],
      { cwd: installRoot, stdio: "pipe", shell: invocation.shell },
    );

    const installedRoot = join(installRoot, ".agents", "skills");
    const installed = (await readdir(installedRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (installed.join(",") !== "mochi-api") throw new Error(`Expected mochi-api, found ${installed.join(", ")}.`);
    if (!(await lstat(join(installedRoot, "mochi-api"))).isDirectory())
      throw new Error("Installed skill is not a directory.");
    process.stdout.write("clean mochi-api skill install passed\n");
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
