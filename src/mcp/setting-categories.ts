/**
 * Setting categorization and metadata for BetterRTX shader settings.
 *
 * Maps all 168 settings from defaults.json into semantic categories
 * with type information, descriptions, and related-setting links.
 * This is the core domain knowledge powering the MCP tools.
 */

import type { SettingValue, RawSettings } from "../betterrtx/settings.ts";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SETTING_KEYS,
} from "../betterrtx/defaults.ts";

// ── Types ────────────────────────────────────────────────────────

export interface SettingMetadata {
  readonly key: string;
  readonly category: string;
  readonly type: "boolean" | "number" | "string";
  readonly defaultValue: SettingValue;
  readonly description: string;
  readonly relatedKeys?: readonly string[];
  /** True for settings whose default value references other settings. */
  readonly isDerived?: boolean;
}

export interface CategoryInfo {
  readonly displayName: string;
  readonly description: string;
  readonly keys: readonly string[];
}

// ── Category Definitions ─────────────────────────────────────────

export const SETTING_CATEGORIES: Readonly<Record<string, CategoryInfo>> = {
  rendering: {
    displayName: "Rendering Features",
    description:
      "Core rendering techniques including BRDF models, emissive handling, reflection quality, and irradiance cache.",
    keys: [
      "DIFFUSE_BRDF",
      "FORCE_PRIMARY_INSTANCE_MASK",
      "FORCE_HIGH_DETAIL_SECONDARY_RAYS",
      "ENTITY_EMISSIVES",
      "ENABLE_SHARPER_REFLECTIONS",
      "FORCE_ZERO_MIP_LEVEL",
      "CONSERVE_IRRADIANCE_CACHE_ENERGY",
      "DYNAMIC_IRRADIANCE_CACHE_MAX_HISTORY_LENGTH",
    ],
  },
  "ray-tracing": {
    displayName: "Ray Tracing & Caustics",
    description:
      "Water caustics, light transmission, and advanced ray tracing features.",
    keys: [
      "REFLECT_WATER_CAUSTICS",
      "REFLECTED_WATER_CAUSTICS_CUTOFF",
      "REFLECTED_WATER_CAUSTICS_FALLOFF",
      "REFLECTED_WATER_CAUSTICS_INTENSITY",
      "REFLECTED_WATER_CAUSTICS_FALLOFF_SCALE",
      "ENABLE_TRANSMISSION_FOR_EXPLICIT_LIGHTS",
      "ENABLE_TRANSMISSION_FOR_SPECULAR",
    ],
  },
  exposure: {
    displayName: "Exposure & Light Metering",
    description:
      "Auto-exposure, light metering, EV limits, and slight night vision threshold.",
    keys: [
      "ENABLE_SKY_AUTO_EXPOSURE",
      "SKY_AUTO_EXPOSURE_POWER",
      "ENABLE_EMISSIVE_AUTO_EXPOSURE",
      "EMISSIVE_AUTO_EXPOSURE_POWER",
      "UNCLAMP_LOWER_EXPOSURE_LIMIT",
      "MAX_EV",
      "LIGHT_MEASURING_SPACE_GAMMA",
      "DESIRED_DIFFUSE_PAPER_WHITE_LUMINANCE",
      "CALCULATE_UNDERWATER_DIRECTION_TO_SUN",
      "MIN_DESIRED_EXPOSURE_EV_FOR_SLIGHT_NIGHT_VISION",
      "MAX_DESIRED_EXPOSURE_EV_FOR_SLIGHT_NIGHT_VISION",
    ],
  },
  "sun-moon": {
    displayName: "Sun & Moon",
    description:
      "Sun position, radius, custom colors at 7 times of day, moon color, shadow filtering, and intensity.",
    keys: [
      "SUN_AZIMUTH",
      "SUN_ZENITH",
      "SUN_RADIUS_MULTIPLIER",
      "SUN_TEXTURE_ORIENTATION_HORIZONTAL",
      "SUN_TEXTURE_SCALE",
      "SUN_MOON_INTENSITY_MULTIPLIER",
      "CUSTOM_SUN_COLORS",
      "SUN_COLOR_06000",
      "SUN_COLOR_03000",
      "SUN_COLOR_01000",
      "SUN_COLOR_00000",
      "SUN_COLOR_23500",
      "SUN_COLOR_23250",
      "SUN_COLOR_23000",
      "MOON_LIGHT_COLOR",
      "KEEP_VANILLA_SUN_INTENSITIES",
      "DISABLE_TEMPORAL_SHADOW_FILTER",
      "SHADOW_FILTER_GAUSSIAN_DEVIATION_MULTIPLIER",
      "DEFERRED_SUN_ANGLE",
    ],
  },
  atmosphere: {
    displayName: "Atmosphere & Sky",
    description:
      "Rayleigh/Mie scattering, rainbows, fog types, cloud shadows, sky distance fade, and inscatter sampling.",
    keys: [
      "ENABLE_RAINBOWS",
      "ENABLE_EXPLICIT_INSCATTER_LIGHT_SAMPLING",
      "ENABLE_STATIC_GI_FOG",
      "STATIC_GI_FOG_AMOUNT",
      "ENABLE_STATIC_SUN_FOG",
      "STATIC_SUN_FOG_AMOUNT",
      "ENABLE_STATIC_RAIN_FOG",
      "STATIC_RAIN_FOG_AMOUNT",
      "NOON_FOG_REDUCTION",
      "VOLUMETRIC_FOG_RANGE",
      "ENABLE_IMPROVED_SKY_DISTANCE_FADE",
      "DISTANCE_FADE_START",
      "DISTANCE_FADE_END",
      "CLOUD_SHADOW_OPACITY",
      "ENABLE_BETTER_CLOUD_BLENDING",
      "ENABLE_RAYLEIGH_SKY",
      "RAYLEIGH_SKY_INTENSITY_MULTIPLIER",
      "RAYLEIGH_NIGHT_SKY_STRENGTH",
      "RAYLEIGH_SCATTERING_COEFFICIENT",
      "MIE_SCATTERING_COEFFICIENT",
      "MIE_SCATTERING_INTENSITY",
      "RAYLEIGH_PRIMARY_INTEGRAL_STEPS",
      "RAYLEIGH_LIGHT_INTEGRAL_STEPS",
    ],
  },
  water: {
    displayName: "Water Effects",
    description:
      "Water roughness, extinction, parallax waves, underwater rendering, and caustics rendering.",
    keys: [
      "FORCED_WATER_ROUGHNESS",
      "WATER_EXTINCTION_MULTIPLIER",
      "DISABLE_UNDERWATER_DISTANCE_FADE",
      "ENABLE_WATER_PARALLAX",
      "WATER_PARALLAX_AMPLITUDE",
      "WATER_PARALLAX_FREQUENCY",
      "WATER_PARALLAX_SPEED_MULTIPLIER",
    ],
  },
  "rain-wetness": {
    displayName: "Rain & Wetness",
    description:
      "Rain wetness effects, puddle appearance, puddle scale, and noise thresholds.",
    keys: [
      "ENABLE_RAIN_WETNESS",
      "RAIN_SAMPLE_DISK_RADIUS",
      "PUDDLE_ROUGHNESS",
      "PUDDLE_COLOUR_REDUCTION",
      "PUDDLE_METALNESS_REDUCTION",
      "PUDDLE_NORMAL_REDUCTION",
      "RAIN_WETNESS_MULTIPLIER",
      "ENABLE_RAIN_PUDDLES",
      "UNIFORM_WETNESS",
      "RAIN_PUDDLE_SCALE",
      "NOISE_MIN_THRESHOLD",
      "NOISE_MAX_THRESHOLD",
    ],
  },
  "end-dimension": {
    displayName: "End Dimension",
    description:
      "Custom End sky, sun, fog extinction/scattering, and ambient colors for The End.",
    keys: [
      "ENABLE_CUSTOM_END_SKY",
      "END_SUN_RADIUS_MULTIPLIER",
      "END_SUN_COLOR",
      "END_DIRECTION_TO_SUN",
      "END_SKY_COLOR",
      "END_MIE_COLOR",
      "END_FOG_EXTINCTION",
      "END_FOG_SCATTERING",
    ],
  },
  nether: {
    displayName: "Nether",
    description:
      "Nether visual improvements, exposure, ambient light color/intensity, explicit light bias, and GI fog.",
    keys: [
      "ENABLE_IMPROVED_NETHER_VISUALS",
      "NETHER_MAX_EV",
      "NETHER_EXPLICIT_LIGHTS_INTENSITY_BIAS",
      "NETHER_AMBIENT_LIGHT_INTENSITY",
      "NETHER_AMBIENT_LIGHT_COLOUR",
      "NETHER_STATIC_GI_FOG_AMOUNT",
      "NETHER_AMBIENT_LIGHT",
    ],
  },
  "night-vision": {
    displayName: "Night Vision",
    description:
      "Improved night vision with ambient levels, pulsing effect, and pulse waveform shaping.",
    keys: [
      "ENABLE_IMPROVED_NIGHT_VISION",
      "NIGHT_VISION_MAX_EV",
      "NIGHT_VISION_AMBIENT_LEVEL",
      "NIGHT_VISION_CONSTANT_AMBIENT_LEVEL",
      "ENABLE_NIGHT_VISION_PULSE",
      "NIGHT_VISION_PULSE_INTENSITY",
      "NIGHT_VISION_PULSE_SPEED",
      "NIGHT_VISION_PULSE_ATTACK_SCALE",
      "NIGHT_VISION_PULSE_RELEASE_SCALE",
      "HALF_NIGHT_VISION_PULSE_SPEED",
    ],
  },
  "effects-fixes": {
    displayName: "Effects & Fixes",
    description:
      "Visual effect improvements and bug fixes for default material, spectator mode, blend surfaces, and backface culling.",
    keys: [
      "ENABLE_IMPROVED_EFFECTS",
      "DARKNESS_EXPOSURE_PULSE_INTENSITY",
      "FIX_DEFAULT_MATERIAL",
      "FIX_SPECTATOR_MODE",
      "FULL_BACKFACE_CULLING",
      "FIX_BLEND_SURFACES",
    ],
  },
  "depth-of-field": {
    displayName: "Depth of Field",
    description:
      "Camera DOF simulation with aperture control, auto-focus speeds, and denoiser.",
    keys: [
      "ENABLE_DOF",
      "ENABLE_DOF_DENOISER",
      "DISABLE_NEAR_DOF",
      "DOF_APERTURE_SIZE",
      "DOF_APERTURE_TYPE",
      "DOF_FOCAL_DISTANCE",
      "CLOSE_AUTO_FOCUS_SPEED",
      "FAR_AUTO_FOCUS_SPEED",
      "DOF_MIN_FOCAL_DISTANCE",
    ],
  },
  tonemapping: {
    displayName: "Tonemapping",
    description:
      "Tonemapping algorithm selection (0=Linear, 1=Filmic, 2=ACES, 3=Uncharted 2) with per-algorithm parameters.",
    keys: [
      "TONEMAPPING_TYPE",
      "FILMIC_SATURATION_CORRECTION_MULTIPLIER",
      "DISABLE_EMISSIVE_DESATURATION",
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
  "post-processing": {
    displayName: "Post-Processing",
    description: "Motion blur and chromatic aberration effects.",
    keys: [
      "ENABLE_MOTION_BLUR",
      "MOTION_BLUR_SAMPLES",
      "MOTION_BLUR_INTENSITY",
      "MOTION_BLUR_MAX_LENGTH",
      "MOTION_BLUR_TARGET_FRAMETIME",
      "ENABLE_CHROMATIC_ABERRATION",
      "CHROMATIC_ABERRATION_INTENSITY",
      "IMPROVED_BLOOM",
    ],
  },
  "exposure-control": {
    displayName: "Exposure Control",
    description: "Lock exposure to a fixed EV value for consistent lighting.",
    keys: ["LOCK_EXPOSURE", "LOCKED_EV"],
  },
  compatibility: {
    displayName: "Compatibility",
    description: "Version-specific compatibility flags for Minecraft updates.",
    keys: [
      "ENABLE_LATEST_VERSION_COMPATIBILITY",
      "ENABLE_121_COMPATIBILITY",
    ],
  },
};

/** All category names. */
export const CATEGORY_NAMES: readonly string[] = Object.keys(SETTING_CATEGORIES);

// ── Setting Descriptions ─────────────────────────────────────────

const SETTING_DESCRIPTIONS: Readonly<Record<string, string>> = {
  // Rendering
  DIFFUSE_BRDF: "Diffuse BRDF model (0=Lambert, 1=Burley, 2=Oren-Nayar).",
  FORCE_PRIMARY_INSTANCE_MASK:
    "Force primary ray instance mask for correct material identification.",
  FORCE_HIGH_DETAIL_SECONDARY_RAYS:
    "Use high-detail geometry for secondary (bounced) rays.",
  ENTITY_EMISSIVES:
    "Enable emissive lighting from entities (glowing mobs, items).",
  ENABLE_SHARPER_REFLECTIONS:
    "Use higher-quality reflection sampling for sharper mirror-like reflections.",
  FORCE_ZERO_MIP_LEVEL:
    "Force highest texture mip level for maximum texture sharpness.",
  CONSERVE_IRRADIANCE_CACHE_ENERGY:
    "Apply energy conservation to the irradiance cache.",
  DYNAMIC_IRRADIANCE_CACHE_MAX_HISTORY_LENGTH:
    "Use dynamic history length for irradiance cache temporal accumulation.",

  // Ray Tracing
  REFLECT_WATER_CAUSTICS: "Enable caustic light patterns reflected by water.",
  REFLECTED_WATER_CAUSTICS_CUTOFF:
    "Distance cutoff for reflected water caustics (blocks).",
  REFLECTED_WATER_CAUSTICS_FALLOFF:
    "Falloff distance for caustic intensity (blocks).",
  REFLECTED_WATER_CAUSTICS_INTENSITY: "Intensity multiplier for water caustics.",
  REFLECTED_WATER_CAUSTICS_FALLOFF_SCALE:
    "Derived: 6 / REFLECTED_WATER_CAUSTICS_FALLOFF. Do not modify directly.",
  ENABLE_TRANSMISSION_FOR_EXPLICIT_LIGHTS:
    "Allow light to transmit through translucent surfaces from explicit lights.",
  ENABLE_TRANSMISSION_FOR_SPECULAR:
    "Allow specular light transmission through translucent surfaces.",

  // Exposure
  ENABLE_SKY_AUTO_EXPOSURE:
    "Automatically adjust exposure based on sky brightness.",
  SKY_AUTO_EXPOSURE_POWER: "Power curve for sky auto-exposure adjustment.",
  ENABLE_EMISSIVE_AUTO_EXPOSURE:
    "Include emissive surfaces in auto-exposure calculation.",
  EMISSIVE_AUTO_EXPOSURE_POWER:
    "Power curve for emissive auto-exposure adjustment.",
  UNCLAMP_LOWER_EXPOSURE_LIMIT:
    "Remove the lower bound on auto-exposure for darker scenes.",
  MAX_EV: "Maximum exposure value (EV) limit.",
  LIGHT_MEASURING_SPACE_GAMMA:
    "Gamma curve applied in the light-metering space.",
  DESIRED_DIFFUSE_PAPER_WHITE_LUMINANCE:
    "Target luminance for diffuse paper-white surfaces.",
  CALCULATE_UNDERWATER_DIRECTION_TO_SUN:
    "Compute accurate sun direction when underwater.",
  MIN_DESIRED_EXPOSURE_EV_FOR_SLIGHT_NIGHT_VISION:
    "Lower EV threshold for slight night vision effect.",
  MAX_DESIRED_EXPOSURE_EV_FOR_SLIGHT_NIGHT_VISION:
    "Upper EV threshold for slight night vision effect.",

  // Sun & Moon
  SUN_AZIMUTH: "Horizontal angle of the sun in radians.",
  SUN_ZENITH: "Vertical angle of the sun from zenith in radians.",
  SUN_RADIUS_MULTIPLIER: "Scale factor for the sun disk size.",
  SUN_TEXTURE_ORIENTATION_HORIZONTAL:
    "Orient the sun texture horizontally instead of vertically.",
  SUN_TEXTURE_SCALE:
    "Scale factor for the sun texture. Default: 1/sqrt(2) for correct aspect.",
  SUN_MOON_INTENSITY_MULTIPLIER:
    "Global intensity multiplier for sun and moon light.",
  CUSTOM_SUN_COLORS: "Enable custom sun color definitions per time of day.",
  SUN_COLOR_06000:
    "Sun color at 06:00 as float4(R, G, B, intensity). Noon transition.",
  SUN_COLOR_03000: "Sun color at 03:00 as float4(R, G, B, intensity). Dawn.",
  SUN_COLOR_01000: "Sun color at 01:00 as float4(R, G, B, intensity). Sunrise.",
  SUN_COLOR_00000:
    "Sun color at 00:00 as float4(R, G, B, intensity). Horizon.",
  SUN_COLOR_23500:
    "Sun color at 23:50 as float4(R, G, B, intensity). Late sunset.",
  SUN_COLOR_23250:
    "Sun color at 23:25 as float4(R, G, B, intensity). Deep dusk.",
  SUN_COLOR_23000:
    "Sun color at 23:00 as float4(R, G, B, intensity). Civil twilight.",
  MOON_LIGHT_COLOR:
    "Moon light color as float4(R, G, B, intensity). Cool blueish tone.",
  KEEP_VANILLA_SUN_INTENSITIES:
    "Use vanilla game sun intensity values instead of custom.",
  DISABLE_TEMPORAL_SHADOW_FILTER: "Disable temporal filtering on shadows.",
  SHADOW_FILTER_GAUSSIAN_DEVIATION_MULTIPLIER:
    "Gaussian blur deviation for shadow filtering. Lower = sharper shadows.",
  DEFERRED_SUN_ANGLE: "Use deferred sun angle computation.",

  // Atmosphere
  ENABLE_RAINBOWS: "Enable rainbow rendering after rain.",
  ENABLE_EXPLICIT_INSCATTER_LIGHT_SAMPLING:
    "Enable explicit light sampling for atmospheric inscatter.",
  ENABLE_STATIC_GI_FOG: "Enable static global illumination fog.",
  STATIC_GI_FOG_AMOUNT: "Density of static GI fog.",
  ENABLE_STATIC_SUN_FOG: "Enable static sun-lit fog effect.",
  STATIC_SUN_FOG_AMOUNT: "Density of static sun fog.",
  ENABLE_STATIC_RAIN_FOG: "Enable fog during rain.",
  STATIC_RAIN_FOG_AMOUNT: "Density of rain fog.",
  NOON_FOG_REDUCTION:
    "Fog reduction factor at noon (1.0 = full reduction, 0.0 = no reduction).",
  VOLUMETRIC_FOG_RANGE:
    "Maximum range of volumetric fog rendering in blocks.",
  ENABLE_IMPROVED_SKY_DISTANCE_FADE:
    "Enable improved sky distance fading at chunk boundaries.",
  DISTANCE_FADE_START:
    "Normalized distance where sky fade begins (0.0-1.0).",
  DISTANCE_FADE_END: "Normalized distance where sky fade completes (0.0-1.0).",
  CLOUD_SHADOW_OPACITY: "Opacity of cloud shadows on the ground (0.0 = off).",
  ENABLE_BETTER_CLOUD_BLENDING: "Enable improved cloud edge blending.",
  ENABLE_RAYLEIGH_SKY:
    "Enable Rayleigh scattering for realistic sky color gradient.",
  RAYLEIGH_SKY_INTENSITY_MULTIPLIER:
    "Intensity multiplier for Rayleigh sky scattering.",
  RAYLEIGH_NIGHT_SKY_STRENGTH:
    "Intensity of Rayleigh scattering for the night sky.",
  RAYLEIGH_SCATTERING_COEFFICIENT:
    "Rayleigh scattering coefficient as float3(R, G, B). Controls sky color.",
  MIE_SCATTERING_COEFFICIENT:
    "Mie scattering coefficient. Controls haze/sun halo intensity.",
  MIE_SCATTERING_INTENSITY: "Intensity multiplier for Mie scattering.",
  RAYLEIGH_PRIMARY_INTEGRAL_STEPS:
    "Sample count for primary Rayleigh integral (quality vs performance).",
  RAYLEIGH_LIGHT_INTEGRAL_STEPS:
    "Sample count for light Rayleigh integral (0 = single scatter approx).",
  NETHER_STATIC_GI_FOG_AMOUNT: "Density of static GI fog in the Nether.",

  // Water
  FORCED_WATER_ROUGHNESS:
    "Override water surface roughness (0.0 = mirror-smooth).",
  WATER_EXTINCTION_MULTIPLIER:
    "Multiplier for underwater light extinction (higher = murkier).",
  DISABLE_UNDERWATER_DISTANCE_FADE:
    "Disable chunk-boundary distance fading while underwater.",
  ENABLE_WATER_PARALLAX: "Enable parallax wave displacement on water surface.",
  WATER_PARALLAX_AMPLITUDE: "Height of parallax water waves.",
  WATER_PARALLAX_FREQUENCY: "Frequency/density of parallax water waves.",
  WATER_PARALLAX_SPEED_MULTIPLIER:
    "Speed multiplier for parallax wave animation.",

  // Rain & Wetness
  ENABLE_RAIN_WETNESS: "Enable surface wetness effect during rain.",
  RAIN_SAMPLE_DISK_RADIUS: "Radius of rain splash sampling disk.",
  PUDDLE_ROUGHNESS: "Surface roughness of rain puddles (0.0 = mirror).",
  PUDDLE_COLOUR_REDUCTION:
    "How much puddles darken the surface color (0.0-1.0).",
  PUDDLE_METALNESS_REDUCTION:
    "How much puddles reduce surface metalness (0.0-1.0).",
  PUDDLE_NORMAL_REDUCTION:
    "How much puddles flatten surface normals (0.0-1.0).",
  RAIN_WETNESS_MULTIPLIER:
    "Global multiplier for rain wetness intensity.",
  ENABLE_RAIN_PUDDLES: "Enable puddle accumulation during rain.",
  UNIFORM_WETNESS: "Base wetness level applied uniformly (0.0-1.0).",
  RAIN_PUDDLE_SCALE: "Scale of the puddle noise pattern.",
  NOISE_MIN_THRESHOLD: "Minimum noise threshold for puddle formation.",
  NOISE_MAX_THRESHOLD: "Maximum noise threshold for puddle formation.",

  // End Dimension
  ENABLE_CUSTOM_END_SKY: "Enable custom sky rendering in The End dimension.",
  END_SUN_RADIUS_MULTIPLIER: "Scale factor for the End sun disk size.",
  END_SUN_COLOR:
    "End sun color as float3(R, G, B). Typically faint purple.",
  END_DIRECTION_TO_SUN:
    "Direction vector to the End sun as float3(X, Y, Z).",
  END_SKY_COLOR: "End sky base color as float3(R, G, B).",
  END_MIE_COLOR: "End Mie scattering color as float3(R, G, B).",
  END_FOG_EXTINCTION:
    "End fog extinction coefficient as float3(R, G, B). Controls fog opacity.",
  END_FOG_SCATTERING:
    "End fog scattering coefficient as float3(R, G, B). Controls fog glow.",

  // Nether
  ENABLE_IMPROVED_NETHER_VISUALS:
    "Enable improved visual rendering in the Nether.",
  NETHER_MAX_EV: "Maximum exposure value in the Nether.",
  NETHER_EXPLICIT_LIGHTS_INTENSITY_BIAS:
    "Intensity bias for explicit point lights in the Nether.",
  NETHER_AMBIENT_LIGHT_INTENSITY:
    "Ambient light intensity in the Nether.",
  NETHER_AMBIENT_LIGHT_COLOUR:
    "Nether ambient light color as float3(R, G, B). Warm reddish tone.",
  NETHER_AMBIENT_LIGHT:
    "Derived: NETHER_AMBIENT_LIGHT_COLOUR * NETHER_AMBIENT_LIGHT_INTENSITY. Do not modify directly.",

  // Night Vision
  ENABLE_IMPROVED_NIGHT_VISION:
    "Enable improved night vision rendering.",
  NIGHT_VISION_MAX_EV:
    "Maximum EV when night vision is active.",
  NIGHT_VISION_AMBIENT_LEVEL:
    "Ambient light level boost from night vision.",
  NIGHT_VISION_CONSTANT_AMBIENT_LEVEL:
    "Constant ambient light added by night vision.",
  ENABLE_NIGHT_VISION_PULSE:
    "Enable pulsing effect on night vision.",
  NIGHT_VISION_PULSE_INTENSITY:
    "Intensity of the night vision pulse.",
  NIGHT_VISION_PULSE_SPEED:
    "Speed of the night vision pulse oscillation.",
  NIGHT_VISION_PULSE_ATTACK_SCALE:
    "Attack sharpness of the pulse waveform.",
  NIGHT_VISION_PULSE_RELEASE_SCALE:
    "Release sharpness of the pulse waveform.",
  HALF_NIGHT_VISION_PULSE_SPEED:
    "Derived: NIGHT_VISION_PULSE_SPEED / 2. Do not modify directly.",

  // Effects & Fixes
  ENABLE_IMPROVED_EFFECTS: "Enable improved visual effects rendering.",
  DARKNESS_EXPOSURE_PULSE_INTENSITY:
    "Intensity of the darkness effect exposure pulse.",
  FIX_DEFAULT_MATERIAL:
    "Apply fix for the default material rendering bug.",
  FIX_SPECTATOR_MODE: "Fix rendering issues in spectator mode.",
  FULL_BACKFACE_CULLING: "Enable full backface culling on all geometry.",
  FIX_BLEND_SURFACES: "Fix blending artifacts on transparent surfaces.",

  // Depth of Field
  ENABLE_DOF: "Enable depth-of-field camera blur effect.",
  ENABLE_DOF_DENOISER:
    "Enable denoiser for DOF to reduce grain at wide apertures.",
  DISABLE_NEAR_DOF: "Disable near-field blur (only blur background).",
  DOF_APERTURE_SIZE:
    "Aperture size in meters. Larger = more blur (0.012 ≈ f/4.2).",
  DOF_APERTURE_TYPE:
    "Aperture shape (0=circular, higher values for polygonal bokeh).",
  DOF_FOCAL_DISTANCE:
    "Manual focal distance in blocks (0.0 = auto-focus).",
  CLOSE_AUTO_FOCUS_SPEED: "Speed of auto-focus when subject gets closer.",
  FAR_AUTO_FOCUS_SPEED:
    "Speed of auto-focus when subject moves farther away.",
  DOF_MIN_FOCAL_DISTANCE: "Minimum focal distance in blocks.",

  // Tonemapping
  TONEMAPPING_TYPE:
    "Tonemapping algorithm (0=Linear, 1=Filmic, 2=ACES, 3=Uncharted 2).",
  FILMIC_SATURATION_CORRECTION_MULTIPLIER:
    "Filmic: saturation correction strength.",
  DISABLE_EMISSIVE_DESATURATION:
    "Filmic: prevent desaturation of emissive surfaces.",
  ACES_CURVE_SLOPE: "ACES: midtone slope (contrast).",
  ACES_CURVE_SHOULDER: "ACES: highlight roll-off shoulder.",
  ACES_CURVE_WHITE_CLIP: "ACES: white clipping point.",
  ACES_CURVE_TOE: "ACES: shadow toe curve.",
  ACES_CURVE_BLACK_CLIP: "ACES: black clipping point.",
  ACES_COLOR_SATURATION: "ACES: per-channel saturation as float3(R, G, B).",
  ACES_COLOR_CONTRAST: "ACES: per-channel contrast as float3(R, G, B).",
  ACES_COLOR_GAMMA: "ACES: per-channel gamma as float3(R, G, B).",
  ACES_COLOR_GAIN: "ACES: per-channel gain as float3(R, G, B).",
  ACES_COLOR_OFFSET: "ACES: per-channel offset as float3(R, G, B).",
  ACES_WHITE_TEMP:
    "ACES: white balance temperature in Kelvin (6500 = daylight).",
  U2_SHOULDER_STRENGTH: "Uncharted 2: highlight shoulder strength.",
  U2_LINEAR_STRENGTH: "Uncharted 2: linear region strength.",
  U2_LINEAR_ANGLE: "Uncharted 2: linear region angle.",
  U2_TOE_STRENGTH: "Uncharted 2: shadow toe strength.",
  U2_TOE_NUMERATOR: "Uncharted 2: toe curve numerator.",
  U2_TOE_DENOMINATOR: "Uncharted 2: toe curve denominator.",
  REINHARD_TONE_CURVE:
    "Reinhard extended: tone curve parameter (higher = more contrast).",
  U_MAX_DISPLAY_BRIGHTNESS:
    "Reinhard: maximum display brightness multiplier.",
  U_CONTRAST: "Reinhard: contrast adjustment.",
  U_LINEAR_SECTION_START: "Reinhard: start of linear section.",
  U_LINEAR_SECTION_LENGTH: "Reinhard: length of linear section.",
  U_BLACK_TIGHTNESS: "Reinhard: black level tightness.",
  U_PEDESTAL: "Reinhard: pedestal (black level offset).",

  // Post-Processing
  ENABLE_MOTION_BLUR: "Enable camera motion blur effect.",
  MOTION_BLUR_SAMPLES: "Number of blur samples (higher = smoother, slower).",
  MOTION_BLUR_INTENSITY: "Motion blur intensity multiplier.",
  MOTION_BLUR_MAX_LENGTH: "Maximum blur length in pixels.",
  MOTION_BLUR_TARGET_FRAMETIME:
    "Derived: 1/60 (target 60fps frame time). Do not modify directly.",
  ENABLE_CHROMATIC_ABERRATION:
    "Enable chromatic aberration (color fringing) effect.",
  CHROMATIC_ABERRATION_INTENSITY: "Intensity of chromatic aberration.",
  IMPROVED_BLOOM: "Enable improved bloom rendering pipeline.",

  // Exposure Control
  LOCK_EXPOSURE: "Lock exposure to a fixed EV value.",
  LOCKED_EV: "Fixed EV value when LOCK_EXPOSURE is enabled.",

  // Compatibility
  ENABLE_LATEST_VERSION_COMPATIBILITY:
    "Enable compatibility fixes for the latest Minecraft version.",
  ENABLE_121_COMPATIBILITY:
    "Enable compatibility fixes for Minecraft 1.21.x.",
};

// ── Derived Settings ─────────────────────────────────────────────

const DERIVED_SETTINGS = new Set([
  "HALF_NIGHT_VISION_PULSE_SPEED",
  "REFLECTED_WATER_CAUSTICS_FALLOFF_SCALE",
  "NETHER_AMBIENT_LIGHT",
  "MOTION_BLUR_TARGET_FRAMETIME",
]);

// ── Lookup Functions ─────────────────────────────────────────────

/** Build reverse map: setting key → category name. */
function buildKeyToCategoryMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const [categoryName, category] of Object.entries(SETTING_CATEGORIES)) {
    for (const key of category.keys) {
      map.set(key, categoryName);
    }
  }
  return map;
}

const KEY_TO_CATEGORY = buildKeyToCategoryMap();

function inferType(value: SettingValue): "boolean" | "number" | "string" {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

/** Get full metadata for a single setting key. */
export function getSettingInfo(key: string): SettingMetadata | undefined {
  if (!(key in DEFAULT_SETTINGS)) return undefined;

  const defaultValue = DEFAULT_SETTINGS[key]!;
  const category = KEY_TO_CATEGORY.get(key) ?? "unknown";
  const description = SETTING_DESCRIPTIONS[key] ?? "No description available.";

  return {
    key,
    category,
    type: inferType(defaultValue),
    defaultValue,
    description,
    isDerived: DERIVED_SETTINGS.has(key) || undefined,
  };
}

/** Get all settings for a given category. */
export function getCategorySettings(
  categoryName: string,
): { readonly category: CategoryInfo; readonly settings: readonly SettingMetadata[] } | undefined {
  const category = SETTING_CATEGORIES[categoryName];
  if (!category) return undefined;

  const settings = category.keys
    .map((key) => getSettingInfo(key))
    .filter((info): info is SettingMetadata => info !== undefined);

  return { category, settings };
}

/** Get all settings organized by category. */
export function categorizeSettings(): Readonly<Record<string, { readonly category: CategoryInfo; readonly settings: readonly SettingMetadata[] }>> {
  const result: Record<string, { readonly category: CategoryInfo; readonly settings: readonly SettingMetadata[] }> = {};
  for (const name of CATEGORY_NAMES) {
    const data = getCategorySettings(name);
    if (data) {
      result[name] = data;
    }
  }
  return result;
}

/** Search settings by keyword (matches key name and description). */
export function searchSettings(
  query: string,
): readonly SettingMetadata[] {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/);

  return DEFAULT_SETTING_KEYS
    .map((key) => getSettingInfo(key))
    .filter((info): info is SettingMetadata => {
      if (!info) return false;
      const haystack = `${info.key} ${info.description} ${info.category}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
}

/**
 * Validate settings and return errors/warnings.
 * Does NOT throw — returns a structured result.
 */
export function validateSettings(
  settings: Readonly<Record<string, SettingValue>>,
): {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("$")) continue;

    // Unknown key check
    if (!(key in DEFAULT_SETTINGS)) {
      warnings.push(`Unknown setting "${key}" — will be passed as-is to DXC.`);
      continue;
    }

    // Type mismatch check
    const defaultValue = DEFAULT_SETTINGS[key]!;
    const expectedType = inferType(defaultValue);
    const actualType = inferType(value);

    if (expectedType !== actualType) {
      errors.push(
        `Setting "${key}" expects ${expectedType} but got ${actualType}. Default: ${JSON.stringify(defaultValue)}.`,
      );
    }

    // Derived setting warning
    if (DERIVED_SETTINGS.has(key)) {
      warnings.push(
        `Setting "${key}" is derived from other settings. Overriding it may cause inconsistencies.`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Compute the diff between base settings and user overrides.
 * Returns only keys where the value differs.
 */
export function computeSettingsDiff(
  base: RawSettings,
  overrides: RawSettings,
): RawSettings {
  const diff: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key.startsWith("$")) continue;
    if (base[key] !== value) {
      diff[key] = value;
    }
  }
  return diff;
}
