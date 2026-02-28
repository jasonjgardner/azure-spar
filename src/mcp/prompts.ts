/**
 * MCP prompt registrations for BetterRTX shader settings.
 *
 * Prompts provide structured conversation templates that AI clients
 * can present to users for common shader-tuning workflows.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CATEGORY_NAMES, SETTING_CATEGORIES } from "./setting-categories.ts";

export function registerPrompts(server: McpServer): void {
  registerCreateShaderPreset(server);
  registerTuneSettingCategory(server);
  registerTroubleshootSettings(server);
  registerInstallMaterials(server);
}

// ── create-shader-preset ─────────────────────────────────────────

function registerCreateShaderPreset(server: McpServer): void {
  server.registerPrompt(
    "create-shader-preset",
    {
      title: "Create Shader Preset",
      description:
        "Walk the user through creating a custom BetterRTX shader settings preset step by step.",
      argsSchema: {
        style: z
          .enum(["realistic", "stylized", "performance", "cinematic"])
          .optional()
          .describe("Visual style to target."),
      },
    },
    ({ style }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Help me create a custom BetterRTX shader settings preset${style ? ` with a "${style}" visual style` : ""}.`,
              "",
              "Guide me through the key categories one at a time:",
              "1. Lighting & Exposure — auto-exposure, EV limits, sun/moon colors",
              "2. Atmosphere — sky scattering, fog, rainbows, clouds",
              "3. Water — parallax waves, caustics, extinction",
              "4. Post-Processing — tonemapping, DOF, motion blur, chromatic aberration",
              "",
              "For each category, explain what the important settings do and suggest good values.",
              "At the end, produce a complete settings JSON file containing only the non-default values.",
              "",
              "Use the search-settings and explain-setting tools to look up setting details.",
              "Use the validate-settings tool to check the final result.",
              "Use the create-settings tool with a preset as a starting point if helpful.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

// ── tune-setting-category ────────────────────────────────────────

function registerTuneSettingCategory(server: McpServer): void {
  server.registerPrompt(
    "tune-setting-category",
    {
      title: "Tune Setting Category",
      description:
        "Deep-dive into a specific category of BetterRTX shader settings.",
      argsSchema: {
        category: z
          .string()
          .describe(
            `Category name. Available: ${CATEGORY_NAMES.join(", ")}`,
          ),
        currentSettings: z
          .string()
          .optional()
          .describe("Current settings JSON to modify (optional)."),
      },
    },
    ({ category, currentSettings }) => {
      const info = SETTING_CATEGORIES[category];
      const displayName = info?.displayName ?? category;

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `I want to fine-tune my BetterRTX "${displayName}" settings.`,
                currentSettings
                  ? `My current settings: ${currentSettings}`
                  : "",
                "",
                "For each setting in this category:",
                "1. Explain what it controls visually",
                "2. Show the default value and type",
                "3. Recommend a value for a balanced look",
                "4. Note any related settings that should be adjusted together",
                "",
                "Use the explain-setting tool to look up details.",
                "Use the preview-defines tool to show the DXC output.",
                "At the end, produce the updated settings JSON.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  );
}

// ── troubleshoot-settings ────────────────────────────────────────

function registerTroubleshootSettings(server: McpServer): void {
  server.registerPrompt(
    "troubleshoot-settings",
    {
      title: "Troubleshoot Settings",
      description:
        "Diagnose and fix issues with BetterRTX shader settings.",
      argsSchema: {
        settings: z.string().describe("The problematic settings JSON string."),
        issue: z
          .string()
          .optional()
          .describe("Description of the visual issue (optional)."),
      },
    },
    ({ settings, issue }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "I'm having an issue with my BetterRTX shader settings.",
              issue ? `The problem is: ${issue}` : "",
              "",
              `Here are my current settings:`,
              settings,
              "",
              "Please:",
              "1. Validate the settings using the validate-settings tool",
              "2. Identify any type errors, unknown keys, or suspicious values",
              "3. Check for common mistakes (wrong tonemapping params for the selected type, derived settings overridden, etc.)",
              "4. Suggest specific fixes with explanations",
              "5. Use the preview-defines tool to verify the corrected output",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );
}

// ── install-materials ────────────────────────────────────────────

/** Material file names produced by the BetterRTX compilation pipeline. */
const MATERIAL_FILES = [
  "RTXStub.material.bin",
  "RTXPostFX.Tonemapping.material.bin",
  "RTXPostFX.Bloom.material.bin",
] as const;

function registerInstallMaterials(server: McpServer): void {
  server.registerPrompt(
    "install-materials",
    {
      title: "Install Compiled Materials",
      description:
        "Guide the user through installing compiled BetterRTX .material.bin files into their Minecraft Bedrock Edition installation on Windows.",
      argsSchema: {
        sourcePath: z
          .string()
          .describe(
            "Directory containing the compiled .material.bin files to install.",
          ),
        edition: z
          .enum(["stable", "preview"])
          .optional()
          .describe(
            'Minecraft edition to target. "stable" = Minecraft for Windows, "preview" = Minecraft Preview for Windows. Defaults to stable.',
          ),
        installDrive: z
          .string()
          .optional()
          .describe(
            "Drive letter where Xbox Games are installed (e.g. C, D). If omitted, the LLM will search common drives.",
          ),
      },
    },
    ({ sourcePath, edition, installDrive }) => {
      const editionFolder =
        edition === "preview"
          ? "Minecraft Preview for Windows"
          : "Minecraft for Windows";
      const materialsRelPath = `Content\\data\\renderer\\materials`;

      const driveHint = installDrive
        ? `The user says Minecraft is on the **${installDrive}:** drive.`
        : "The user has not specified a drive letter — search common locations.";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Install my compiled BetterRTX shader materials into Minecraft Bedrock Edition (${edition ?? "stable"}) on Windows.`,
                "",
                `Source directory with compiled files: ${sourcePath}`,
                driveHint,
                "",
                "Follow these steps using **PowerShell** commands:",
                "",
                "**Step 1 — Locate the Minecraft installation**",
                `Find the "${editionFolder}" folder under \\XboxGames on the target drive.`,
                installDrive
                  ? `Check: ${installDrive}:\\XboxGames\\${editionFolder}`
                  : [
                      "Search these drives in order: C, D, E, F.",
                      "For each drive, test whether the path exists:",
                      `  <drive>:\\XboxGames\\${editionFolder}\\${materialsRelPath}`,
                      "Stop at the first match. If none found, ask the user for the correct path.",
                    ].join("\n"),
                "",
                "Use PowerShell `Test-Path` to verify the directory exists before proceeding.",
                "",
                "**Step 2 — Verify compiled files exist**",
                `Confirm that all three material files are present in the source directory:`,
                ...MATERIAL_FILES.map((f) => `  - ${f}`),
                "",
                "Use `Test-Path` for each file. If any are missing, stop and report the error.",
                "",
                "**Step 3 — Back up existing materials**",
                "Before overwriting, create timestamped backups of the originals:",
                '```powershell',
                `$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"`,
                `$backupDir = Join-Path $materialsDir "backups_$timestamp"`,
                "New-Item -ItemType Directory -Path $backupDir -Force",
                "```",
                `Copy each of the three original .material.bin files from the Minecraft materials directory into $backupDir.`,
                "If an original file does not exist (first-time install), skip its backup without error.",
                "",
                "**Step 4 — Copy compiled materials**",
                `Copy all three .material.bin files from the source directory to:`,
                `  <drive>:\\XboxGames\\${editionFolder}\\${materialsRelPath}\\`,
                "",
                "Use `Copy-Item -Force` to overwrite existing files.",
                "",
                "**Step 5 — Verify installation**",
                "After copying, verify each destination file exists and compare file sizes:",
                "```powershell",
                '(Get-Item $dest).Length -eq (Get-Item $src).Length',
                "```",
                "",
                "**Important notes:**",
                "- Minecraft must be **closed** before installing materials. Warn the user if `Minecraft.Windows.exe` is running.",
                "- This workflow is **Windows-only**. The XboxGames directory structure is specific to the Microsoft Store / Xbox app installation.",
                "- If the materials directory does not exist, do NOT create it — this means Minecraft is not installed correctly or the path is wrong.",
                "- Always preserve the backup directory path in the output so the user can restore originals if needed.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  );
}
