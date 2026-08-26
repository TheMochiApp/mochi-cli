export interface SkillInstallerInvocation {
  executable: "npx" | "npx.cmd";
  shell: boolean;
}

export function skillInstallerInvocation(platform: NodeJS.Platform): SkillInstallerInvocation;
export function skillInstallSource(environment?: NodeJS.ProcessEnv): string;
