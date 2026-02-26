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
