/**
 * Unit tests for the Bash PreToolUse hook in ClaudeAgentProvider.
 *
 * The hook uses an allowlist to gate which CLI commands the agent may run.
 * These tests verify that the allowlist approach closes bypass vectors that
 * the previous blocklist approach missed (subshells, brace expansion, etc.)
 * while still permitting legitimate CLI tool invocations.
 */
import { test, expect } from "@playwright/test";
import { buildBashPreToolUseHook } from "../../src/main/agents/providers/bash-hook";
import type { CliToolConfig } from "../../src/shared/types";

// Helper: build a hook for a given set of allowed commands and invoke it.
async function invoke(
  allowedCommands: string[],
  command: string,
): Promise<"allow" | "deny"> {
  const cliTools: CliToolConfig[] = allowedCommands.map((cmd) => ({
    command: cmd,
    instructions: "",
  }));
  const hookConfig = buildBashPreToolUseHook(cliTools);
  if (!hookConfig) throw new Error("expected hook to be non-null");
  const hook = hookConfig.hooks[0];
  const result = await hook({ tool_input: { command } } as Record<string, unknown>);
  const decision = (result as Record<string, unknown>).hookSpecificOutput as {
    permissionDecision: "allow" | "deny";
  };
  return decision.permissionDecision;
}

test.describe("buildBashPreToolUseHook", () => {
  test("returns null when no CLI tools are configured", () => {
    expect(buildBashPreToolUseHook([])).toBeNull();
  });

  test("returns null when all CLI tool commands are blank", () => {
    const tools: CliToolConfig[] = [{ command: "  ", instructions: "" }];
    expect(buildBashPreToolUseHook(tools)).toBeNull();
  });

  test("hook matcher targets Bash", () => {
    const config = buildBashPreToolUseHook([{ command: "git", instructions: "" }]);
    expect(config?.matcher).toBe("Bash");
  });

  // --- Legitimate commands ---

  test("allows configured command with no arguments", async () => {
    expect(await invoke(["git"], "git status")).toBe("allow");
  });

  test("allows command with flags and paths", async () => {
    expect(await invoke(["ls"], "ls -la /tmp/my_dir")).toBe("allow");
  });

  test("allows command with colon in script name", async () => {
    expect(await invoke(["npm"], "npm run test:unit")).toBe("allow");
  });

  test("allows command with equals-style options", async () => {
    expect(await invoke(["npm"], "npm install --save-exact=true")).toBe("allow");
  });

  test("allows command with quoted argument", async () => {
    expect(await invoke(["git"], 'git commit -m "fix: correct off-by-one"')).toBe("allow");
  });

  test("allows command with @ in argument (e.g. npm scope)", async () => {
    expect(await invoke(["npm"], "npm install @scope/package")).toBe("allow");
  });

  test("allows command with tilde path", async () => {
    expect(await invoke(["ls"], "ls ~/Documents")).toBe("allow");
  });

  test("allows command with colon (e.g. npm script name)", async () => {
    expect(await invoke(["npm"], "npm run test:e2e")).toBe("allow");
  });

  test("allows full-path command when base name is in allowlist", async () => {
    expect(await invoke(["git"], "/usr/bin/git status")).toBe("allow");
  });

  // --- Command not in allowlist ---

  test("denies a command whose base name is not in the allowed list", async () => {
    expect(await invoke(["git"], "rm -rf /")).toBe("deny");
  });

  test("denies an empty command string", async () => {
    expect(await invoke(["git"], "")).toBe("deny");
  });

  test("denies a whitespace-only command string", async () => {
    expect(await invoke(["git"], "   ")).toBe("deny");
  });

  // --- Blocklist bypass vectors now caught by the allowlist ---

  test("denies semicolon-chained commands", async () => {
    expect(await invoke(["git"], "git status; rm -rf /")).toBe("deny");
  });

  test("denies AND-chained commands", async () => {
    expect(await invoke(["git"], "git status && rm -rf /")).toBe("deny");
  });

  test("denies pipe to another command", async () => {
    expect(await invoke(["git"], "git log | cat /etc/passwd")).toBe("deny");
  });

  test("denies output redirection", async () => {
    expect(await invoke(["git"], "git status > /etc/crontab")).toBe("deny");
  });

  test("denies input redirection", async () => {
    expect(await invoke(["git"], "git status < /etc/passwd")).toBe("deny");
  });

  test("denies backtick command substitution", async () => {
    expect(await invoke(["git"], "git `rm -rf /`")).toBe("deny");
  });

  test("denies $() command substitution", async () => {
    expect(await invoke(["git"], 'git commit -m "$(cat /etc/passwd)"')).toBe("deny");
  });

  test("denies subshell via parentheses", async () => {
    expect(await invoke(["git"], "(rm -rf /)")).toBe("deny");
  });

  test("denies brace expansion", async () => {
    // {rm,-rf,/} expands to: rm -rf /
    expect(await invoke(["git"], "{rm,-rf,/}")).toBe("deny");
  });

  test("denies newline-separated commands", async () => {
    expect(await invoke(["git"], "git status\nrm -rf /")).toBe("deny");
  });

  test("denies line continuation backslash", async () => {
    expect(await invoke(["git"], "git status\\")).toBe("deny");
  });

  test("denies history expansion", async () => {
    expect(await invoke(["git"], "git !$")).toBe("deny");
  });

  test("denies background operator &", async () => {
    expect(await invoke(["git"], "git status & rm -rf /")).toBe("deny");
  });
});
