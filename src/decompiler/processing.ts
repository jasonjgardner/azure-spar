const SAMPLERS: readonly [RegExp, string][] = [
  [/lowp sampler2D/, "SAMPLER2D"],
  [/highp sampler2DMS/, "SAMPLER2DMS"],
  [/highp sampler3D/, "SAMPLER3D"],
  [/lowp samplerCube/, "SAMPLERCUBE"],
  [/highp sampler2DShadow/, "SAMPLER2DSHADOW"],
  [/highp sampler2D/, "SAMPLER2D_HIGHP"],
  [/highp samplerCube/, "SAMPLERCUBE_HIGHP"],
  [/highp sampler2DArray/, "SAMPLER2DARRAY"],
  [/highp sampler2DMSArray/, "SAMPLER2DMSARRAY"],
  [/highp samplerCubeArray/, "SAMPLERCUBEARRAY"],
  [/highp sampler2DArrayShadow/, "SAMPLER2DARRAYSHADOW"],
  [/highp isampler2D/, "ISAMPLER2D"],
  [/highp usampler2D/, "USAMPLER2D"],
  [/highp isampler3D/, "ISAMPLER3D"],
];

const IMAGE_ACCESSES = [
  { access: "readonly ", accessId: "RO" },
  { access: "writeonly ", accessId: "WR" },
  { access: "", accessId: "RW" },
] as const;

const IMAGE_PREFIXES = ["", "u"] as const;

const IMAGE_TYPES = ["image2D", "image2DArray", "image3D"] as const;
const IMAGE_MACRO_NAMES: Record<string, string> = {
  image2D: "IMAGE2D",
  image2DArray: "IMAGE2D_ARRAY",
  image3D: "IMAGE3D",
};

/**
 * Pre-processes plain text shader code to convert it from GLSL to BGFX SC.
 * Removes built-in `u_` uniforms, replaces `gl_FragColor` and `gl_FragData`,
 * replaces attributes and varyings with `$input` and `$output`, removes macros,
 * replaces samplers with BGFX AUTOREG macros, adds NUM_THREADS to compute shaders.
 */
export function preprocessShader(shaderCode: string): string {
  let code = shaderCode;

  // Remove built-in u_ uniforms
  code = code.replace(/^uniform\s+\w+\s+u_[\w[\]]+;\n/gm, "");

  // Replace bgfx_ prefixed fragment outputs back to gl_ versions
  code = code.replace(/(\W)bgfx_FragColor(\W)/g, "$1gl_FragColor$2");
  code = code.replace(/(\W)bgfx_FragData(\W)/g, "$1gl_FragData$2");

  // Remove output declarations
  code = code.replace(/^out\s.+?;\n/gm, "");

  // Detect vertex stage
  const isVertexStage = /^#define varying out$/m.test(code);

  // Remove defines, ifdefs, and extensions
  code = code.replace(/^#define\s.+?\n/gm, "");
  code = code.replace(/^#if\s.+?#endif\n/gms, "");
  code = code.replace(/^#extension\s.+?\n/gm, "");

  // Replace varyings and attributes with $input/$output
  const varyingReplacement = isVertexStage ? "$output $1" : "$input $1";
  code = code.replace(/^[\s\w]*?varying\s.+? (\w+);$/gm, varyingReplacement);
  code = code.replace(/^[\s\w]*?attribute\s.+? (\w+);$/gm, "$input $1");

  // Remove version directive
  code = code.replace(/^#version\s.+?\n/, "");

  // Replace sampler uniforms with BGFX AUTOREG macros
  for (const [pattern, repl] of SAMPLERS) {
    const fullPattern = new RegExp(`^uniform ${pattern.source} (\\w+);`, "gm");
    code = code.replace(fullPattern, `${repl}_AUTOREG($1);`);
  }

  // Replace SSBO declarations
  code = code.replace(
    /^layout\(std430, .+?\) readonly buffer (\w+) { (\w+) .+? }/gm,
    "BUFFER_RO_AUTOREG($1, $2);",
  );
  code = code.replace(
    /^layout\(std430, .+?\) writeonly buffer (\w+) { (\w+) .+? }/gm,
    "BUFFER_WR_AUTOREG($1, $2);",
  );
  code = code.replace(
    /^layout\(std430, .+?\) buffer (\w+) { (\w+) .+? }/gm,
    "BUFFER_RW_AUTOREG($1, $2)",
  );

  // Replace image uniforms
  for (const { access, accessId } of IMAGE_ACCESSES) {
    for (const prefix of IMAGE_PREFIXES) {
      const upperPrefix = prefix.toUpperCase();
      for (const imageType of IMAGE_TYPES) {
        const macroBase = IMAGE_MACRO_NAMES[imageType]!;
        const name = `${upperPrefix}${macroBase}_${accessId}_AUTOREG`;
        const pattern = new RegExp(
          `^layout\\((.+?), .+?\\) ${access}uniform highp ${prefix}${imageType} (\\w+)`,
          "gm",
        );
        code = code.replace(pattern, `${name}($2, $1)`);
      }
    }
  }

  // Replace compute shader local_size layout
  code = code.replace(
    /^layout \(local_size_x = (\d+), local_size_y = (\d+), local_size_z = (\d+)\) in;/gm,
    "NUM_THREADS($1, $2, $3)",
  );

  return code;
}

/**
 * Post-processes plain text shader code to convert it from GLSL to BGFX SC.
 * Merges `$input` and `$output` declarations together and adds `// Attention!`
 * comment to potential array access and matrix multiplication operations.
 */
export function postprocessShader(shaderCode: string): string {
  const sourceLines = shaderCode.split("\n");
  const newShader: string[] = [];
  let args: string[] = [];
  let lineType = 0; // 0 = none, 1 = input, 2 = output
  let linePrefix = "";

  for (const line of sourceLines) {
    let currentLineType: number;
    if (line.startsWith("$input ")) {
      currentLineType = 1;
      linePrefix = "$input ";
    } else if (line.startsWith("$output ")) {
      currentLineType = 2;
      linePrefix = "$output ";
    } else {
      currentLineType = 0;
    }

    if (lineType) {
      if (lineType === currentLineType) {
        args.push(line.slice(linePrefix.length));
      } else {
        newShader.push(args.join(", "));
      }
    }

    if (!lineType || lineType !== currentLineType) {
      if (currentLineType) {
        args = [line];
      } else {
        newShader.push(line);
      }
    }

    lineType = currentLineType;
  }

  // Flush remaining args
  if (lineType) {
    newShader.push(args.join(", "));
  }

  // Add "// Attention!" comments for potential issues
  const result = newShader.map((line) => {
    if (line.includes(") * (") || line.includes("][")) {
      return `${line} // Attention!`;
    }
    return line;
  });

  return result.join("\n");
}

/**
 * Formats function name such that it can be safely inserted in code
 * and wouldn't conflict with valid GLSL.
 */
export function formatFunctionName(name: string): string {
  return `START_NAME|||${name}|||END_NAME`;
}

/**
 * Removes single line and multiline comments from GLSL code.
 */
export function stripComments(code: string): string {
  let result = code.replace(/\/\/.*\n/g, "");
  result = result.replace(/\/\*.*?\*\//gs, "");
  result = result.replace(/\n\n+/g, "\n");
  return result;
}
