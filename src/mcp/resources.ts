/**
 * MCP resource registrations for BetterRTX shader settings.
 *
 * Resources expose read-only reference data that AI assistants
 * use to understand available settings and their structure.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_SETTINGS } from "../betterrtx/defaults.ts";
import {
  SETTING_CATEGORIES,
  CATEGORY_NAMES,
  categorizeSettings,
  getCategorySettings,
} from "./setting-categories.ts";

export function registerResources(server: McpServer): void {
  registerSettingsDefaults(server);
  registerSettingsCategories(server);
  registerSettingsCategory(server);
  registerTonemappingReference(server);
  registerTargetMaterials(server);
}

// ── settings://defaults ──────────────────────────────────────────

function registerSettingsDefaults(server: McpServer): void {
  server.registerResource(
    "settings-defaults",
    "settings://defaults",
    {
      title: "BetterRTX Default Settings",
      description:
        "All 168 default shader settings with their default values as JSON.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(DEFAULT_SETTINGS, null, 2),
        },
      ],
    }),
  );
}

// ── settings://categories ────────────────────────────────────────

function registerSettingsCategories(server: McpServer): void {
  server.registerResource(
    "settings-categories",
    "settings://categories",
    {
      title: "BetterRTX Setting Categories",
      description:
        "Settings organized by category with types, descriptions, and defaults.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(categorizeSettings(), null, 2),
        },
      ],
    }),
  );
}

// ── settings://category/{categoryName} ───────────────────────────

function registerSettingsCategory(server: McpServer): void {
  server.registerResource(
    "settings-category",
    new ResourceTemplate("settings://category/{categoryName}", {
      list: async () => ({
        resources: CATEGORY_NAMES.map((name) => ({
          uri: `settings://category/${name}`,
          name: `${SETTING_CATEGORIES[name]?.displayName ?? name} Settings`,
        })),
      }),
      complete: {
        categoryName: (value) =>
          CATEGORY_NAMES.filter((c) =>
            c.toLowerCase().startsWith(value.toLowerCase()),
          ),
      },
    }),
    {
      title: "Category Settings",
      description: "Settings for a specific BetterRTX category.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const categoryName = String(variables["categoryName"] ?? "");
      const data = getCategorySettings(categoryName);

      if (!data) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `Unknown category "${categoryName}"`,
                  available: CATEGORY_NAMES,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );
}

// ── settings://tonemapping ───────────────────────────────────────

const TONEMAPPING_REFERENCE = {
  overview:
    "TONEMAPPING_TYPE selects the algorithm (0=Linear, 1=Filmic, 2=ACES, 3=Uncharted 2). Each algorithm has its own set of tunable parameters.",
  algorithms: {
    linear: {
      type: 0,
      description:
        "No tonemapping curve. Simple linear mapping from HDR to SDR. Fastest but can clip highlights.",
      parameters: [],
    },
    filmic: {
      type: 1,
      description:
        "Film-inspired curve with natural highlight roll-off and saturation correction.",
      parameters: [
        "FILMIC_SATURATION_CORRECTION_MULTIPLIER",
        "DISABLE_EMISSIVE_DESATURATION",
      ],
    },
    aces: {
      type: 2,
      description:
        "Academy Color Encoding System. Industry-standard cinematic look with full color grading controls.",
      parameters: [
        "ACES_CURVE_SLOPE",
        "ACES_CURVE_SHOULDER",
        "ACES_CURVE_WHITE_CLIP",
        "ACES_CURVE_TOE",
        "ACES_CURVE_BLACK_CLIP",
        "ACES_COLOR_SATURATION",
        "ACES_COLOR_CONTRAST",
        "ACES_COLOR_GAMMA",
        "ACES_COLOR_GAIN",
        "ACES_COLOR_OFFSET",
        "ACES_WHITE_TEMP",
      ],
    },
    uncharted2: {
      type: 3,
      description:
        "John Hable's Uncharted 2 filmic curve with Reinhard extended parameters. Good balance of realism and performance.",
      parameters: [
        "U2_SHOULDER_STRENGTH",
        "U2_LINEAR_STRENGTH",
        "U2_LINEAR_ANGLE",
        "U2_TOE_STRENGTH",
        "U2_TOE_NUMERATOR",
        "U2_TOE_DENOMINATOR",
        "REINHARD_TONE_CURVE",
        "U_MAX_DISPLAY_BRIGHTNESS",
        "U_CONTRAST",
        "U_LINEAR_SECTION_START",
        "U_LINEAR_SECTION_LENGTH",
        "U_BLACK_TIGHTNESS",
        "U_PEDESTAL",
      ],
    },
  },
};

function registerTonemappingReference(server: McpServer): void {
  server.registerResource(
    "settings-tonemapping",
    "settings://tonemapping",
    {
      title: "Tonemapping Reference",
      description:
        "Detailed reference for the 4 tonemapping algorithms and their parameters.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(TONEMAPPING_REFERENCE, null, 2),
        },
      ],
    }),
  );
}

// ── materials://targets ──────────────────────────────────────────

const TARGET_MATERIALS = {
  materials: [
    {
      name: "RTXStub",
      fileName: "RTXStub.material.bin",
      description:
        "Main ray tracing compute shaders (~49 passes). Handles path tracing, GI, reflections, caustics, and lighting.",
      shaderStage: "compute",
      shaderModel: "6.5",
      registerBindings: 0,
      compilerFlags: [
        "-enable-16bit-types",
        "-Qstrip_reflect",
        "-DDXR_1_1",
        "-no-warnings",
      ],
    },
    {
      name: "RTXPostFX.Tonemapping",
      fileName: "RTXPostFX.Tonemapping.material.bin",
      description:
        "Tonemapping and color grading post-processing (1-3 fragment passes). Applies tone curves, DOF, motion blur, chromatic aberration.",
      shaderStage: "fragment",
      shaderModel: "6.5",
      registerBindings: 4,
      compilerFlags: ["-Qstrip_reflect"],
    },
    {
      name: "RTXPostFX.Bloom",
      fileName: "RTXPostFX.Bloom.material.bin",
      description:
        "Bloom post-processing (1-3 fragment passes). Applies improved bloom glow effect.",
      shaderStage: "fragment",
      shaderModel: "6.5",
      registerBindings: 2,
      compilerFlags: ["-Qstrip_reflect"],
    },
  ],
};

function registerTargetMaterials(server: McpServer): void {
  server.registerResource(
    "materials-targets",
    "materials://targets",
    {
      title: "Target Materials",
      description:
        "Information about the 3 BetterRTX target materials (RTXStub, RTXPostFX.Tonemapping, RTXPostFX.Bloom).",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(TARGET_MATERIALS, null, 2),
        },
      ],
    }),
  );
}
