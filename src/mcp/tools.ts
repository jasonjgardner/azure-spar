/**
 * MCP tool registrations for BetterRTX shader settings.
 *
 * Tools are callable functions that AI assistants invoke to
 * validate, create, search, and compile shader settings.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_SETTINGS } from "../betterrtx/defaults.ts";
import { settingsToDefines, type RawSettings } from "../betterrtx/settings.ts";
import { mergeSettings, hashSettings, processSettings } from "../server/settings.ts";
import type { McpContext } from "./mod.ts";
import {
  getSettingInfo,
  searchSettings,
  validateSettings,
  computeSettingsDiff,
  CATEGORY_NAMES,
} from "./setting-categories.ts";

// ── Zod Schemas ──────────────────────────────────────────────────

const settingValueSchema = z.union([z.boolean(), z.number(), z.string()]);

const settingsObjectSchema = z.record(z.string(), settingValueSchema);

// ── Presets ──────────────────────────────────────────────────────

const PRESETS: Readonly<Record<string, RawSettings>> = {
  default: {},
  performance: {
    ENABLE_DOF: false,
    ENABLE_MOTION_BLUR: false,
    ENABLE_CHROMATIC_ABERRATION: false,
    ENABLE_WATER_PARALLAX: false,
    RAYLEIGH_PRIMARY_INTEGRAL_STEPS: 8,
    RAYLEIGH_LIGHT_INTEGRAL_STEPS: 0,
    VOLUMETRIC_FOG_RANGE: 64.0,
    REFLECT_WATER_CAUSTICS: false,
    ENABLE_RAIN_PUDDLES: false,
    ENABLE_RAIN_WETNESS: false,
    ENABLE_RAINBOWS: false,
    FORCE_HIGH_DETAIL_SECONDARY_RAYS: false,
  },
  quality: {
    ENABLE_DOF: true,
    ENABLE_DOF_DENOISER: true,
    ENABLE_SHARPER_REFLECTIONS: true,
    FORCE_HIGH_DETAIL_SECONDARY_RAYS: true,
    ENTITY_EMISSIVES: true,
    REFLECT_WATER_CAUSTICS: true,
    ENABLE_WATER_PARALLAX: true,
    ENABLE_RAINBOWS: true,
    ENABLE_RAYLEIGH_SKY: true,
    RAYLEIGH_PRIMARY_INTEGRAL_STEPS: 16,
    VOLUMETRIC_FOG_RANGE: 128.0,
    ENABLE_RAIN_PUDDLES: true,
    ENABLE_RAIN_WETNESS: true,
  },
  cinematic: {
    ENABLE_DOF: true,
    ENABLE_DOF_DENOISER: true,
    DOF_APERTURE_SIZE: 0.025,
    DISABLE_NEAR_DOF: false,
    ENABLE_MOTION_BLUR: true,
    MOTION_BLUR_SAMPLES: 32,
    MOTION_BLUR_INTENSITY: 0.8,
    ENABLE_CHROMATIC_ABERRATION: true,
    CHROMATIC_ABERRATION_INTENSITY: 0.02,
    TONEMAPPING_TYPE: 2,
    CUSTOM_SUN_COLORS: true,
    ENABLE_RAYLEIGH_SKY: true,
    ENABLE_SHARPER_REFLECTIONS: true,
    REFLECT_WATER_CAUSTICS: true,
    ENABLE_WATER_PARALLAX: true,
    ENABLE_RAINBOWS: true,
  },
};

// ── Registration ─────────────────────────────────────────────────

export function registerTools(server: McpServer, ctx: McpContext): void {
  registerValidateSettings(server);
  registerExplainSetting(server);
  registerSearchSettings(server);
  registerPreviewDefines(server);
  registerDiffSettings(server);
  registerCreateSettings(server);
  registerCompileMaterials(server, ctx);
}

// ── validate-settings ────────────────────────────────────────────

function registerValidateSettings(server: McpServer): void {
  server.registerTool(
    "validate-settings",
    {
      title: "Validate Shader Settings",
      description:
        "Validate a BetterRTX settings JSON object. Reports type errors, unknown keys, and derived-setting warnings.",
      inputSchema: z.object({
        settings: settingsObjectSchema.describe(
          "Settings object to validate (partial or complete).",
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ settings }) => {
      const result = validateSettings(
        settings as Readonly<Record<string, boolean | number | string>>,
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );
}

// ── explain-setting ──────────────────────────────────────────────

function registerExplainSetting(server: McpServer): void {
  server.registerTool(
    "explain-setting",
    {
      title: "Explain Setting",
      description:
        "Get detailed documentation for a specific BetterRTX shader setting including type, default, category, and description.",
      inputSchema: z.object({
        key: z.string().describe("The setting key, e.g. 'SUN_AZIMUTH'."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ key }) => {
      const info = getSettingInfo(key);
      if (!info) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown setting "${key}". Use the search-settings tool to find settings by keyword.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(info, null, 2) },
        ],
      };
    },
  );
}

// ── search-settings ──────────────────────────────────────────────

function registerSearchSettings(server: McpServer): void {
  server.registerTool(
    "search-settings",
    {
      title: "Search Settings",
      description:
        "Search BetterRTX settings by keyword. Matches setting key names, descriptions, and categories.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search keyword, e.g. 'water', 'sun', 'fog', 'DOF'."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const matches = searchSettings(query);
      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No settings found matching "${query}". Available categories: ${CATEGORY_NAMES.join(", ")}`,
            },
          ],
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(matches, null, 2) },
        ],
      };
    },
  );
}

// ── preview-defines ──────────────────────────────────────────────

function registerPreviewDefines(server: McpServer): void {
  server.registerTool(
    "preview-defines",
    {
      title: "Preview DXC Defines",
      description:
        "Show the DXC preprocessor defines (-D flags) that would result from merging given settings with defaults.",
      inputSchema: z.object({
        settings: settingsObjectSchema.describe(
          "User settings to preview (only overrides needed).",
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ settings }) => {
      const userSettings = settings as RawSettings;
      const merged = mergeSettings(DEFAULT_SETTINGS, userSettings);
      const defines = settingsToDefines(merged);

      // Show only the user-specified keys
      const userKeys = new Set(
        Object.keys(userSettings).filter((k) => !k.startsWith("$")),
      );
      const userDefines = Object.fromEntries(
        Object.entries(defines).filter(([key]) => userKeys.has(key)),
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalDefines: Object.keys(defines).length,
                userOverrides: Object.keys(userDefines).length,
                defines: userDefines,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ── diff-settings ────────────────────────────────────────────────

function registerDiffSettings(server: McpServer): void {
  server.registerTool(
    "diff-settings",
    {
      title: "Compare Settings",
      description:
        "Compare settings against defaults and show only the differences. Optionally compare two settings objects.",
      inputSchema: z.object({
        settings: settingsObjectSchema.describe(
          "Settings to compare.",
        ),
        compareWith: settingsObjectSchema
          .optional()
          .describe(
            "Optional second settings object to compare against. Defaults to BetterRTX defaults.",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ settings, compareWith }) => {
      const base = (compareWith as RawSettings | undefined) ?? DEFAULT_SETTINGS;
      const diff = computeSettingsDiff(base, settings as RawSettings);
      const hash = hashSettings(mergeSettings(DEFAULT_SETTINGS, settings as RawSettings));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                changedCount: Object.keys(diff).length,
                settingsHash: hash,
                changes: diff,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ── create-settings ──────────────────────────────────────────────

function registerCreateSettings(server: McpServer): void {
  server.registerTool(
    "create-settings",
    {
      title: "Create Settings JSON",
      description:
        "Generate a BetterRTX settings JSON from a preset and/or manual overrides. Returns only values that differ from defaults.",
      inputSchema: z.object({
        preset: z
          .enum(["default", "performance", "quality", "cinematic"])
          .optional()
          .describe(
            "Base preset to start from. 'default' returns empty object.",
          ),
        overrides: settingsObjectSchema
          .optional()
          .describe("Additional setting overrides to apply on top of preset."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ preset, overrides }) => {
      const base = PRESETS[preset ?? "default"] ?? {};
      const merged = { ...base, ...(overrides as RawSettings | undefined) };
      const diffOnly = computeSettingsDiff(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        ...merged,
      });

      const validation = validateSettings(
        diffOnly as Readonly<Record<string, boolean | number | string>>,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                preset: preset ?? "default",
                settingsCount: Object.keys(diffOnly).length,
                settings: diffOnly,
                validation,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ── compile-materials ────────────────────────────────────────────

function registerCompileMaterials(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "compile-materials",
    {
      title: "Compile Shader Materials",
      description:
        "Submit a build job to compile BetterRTX .material.bin files with the given settings. Returns a job ID for tracking. Requires DXC and shader files to be available on the server.",
      inputSchema: z.object({
        settings: settingsObjectSchema.describe(
          "User settings overrides to compile with.",
        ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ settings }) => {
      if (!ctx.db) {
        return {
          content: [
            {
              type: "text",
              text: "Build server database not available. The server must be started with full build infrastructure to use compilation.",
            },
          ],
          isError: true,
        };
      }

      const rawJson = JSON.stringify(settings);
      let result: { readonly hash: string };

      try {
        result = processSettings(rawJson, ctx.defaults);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid settings: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }

      // Check queue depth
      const pending = ctx.db.countByStatus("pending");
      if (pending >= 100) {
        return {
          content: [
            {
              type: "text",
              text: "Build queue is full (100+ pending jobs). Try again later.",
            },
          ],
          isError: true,
        };
      }

      // Atomic deduplicate-or-insert
      const id = crypto.randomUUID();
      const { job, inserted } = ctx.db.insertOrFindByHash(
        id,
        result.hash,
        rawJson,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: job.id,
                status: job.status,
                settingsHash: job.settingsHash,
                deduplicated: !inserted,
                message: inserted
                  ? "Build queued successfully. The queue worker will process it shortly."
                  : `Existing build found with same settings (status: ${job.status}).`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
