import type { CodeLineGroup, GroupedShader } from "./grouped-shader.ts";
import type { FlagDefinition, FunctionName, FlagName } from "../types.ts";

/**
 * Separate flag definitions for each context (main code and functions).
 */
export interface LocalFlagDefinition {
  readonly mainShader: FlagDefinition;
  readonly functions: Readonly<Record<FunctionName, FlagDefinition>>;
}

/**
 * Builds a LocalFlagDefinition from a GroupedShader by collecting
 * all flag name/value pairs from line group conditions.
 */
export function localFlagDefinitionFromGroupedShader(
  shader: GroupedShader,
): LocalFlagDefinition {
  const mainShader = flagDefFromLineGroupList(shader.mainCode);
  const functions: Record<FunctionName, FlagDefinition> = {};

  for (const [funcName, func] of Object.entries(shader.functions)) {
    functions[funcName] = flagDefFromLineGroupList(func);
  }

  return { mainShader, functions };
}

function flagDefFromLineGroupList(
  lineList: readonly CodeLineGroup[],
): FlagDefinition {
  const flagDef: FlagDefinition = {};

  for (const lineGroup of lineList) {
    for (const flags of lineGroup.condition) {
      for (const [key, value] of Object.entries(flags)) {
        let valueList = flagDef[key];

        if (valueList === undefined) {
          valueList = [];
          flagDef[key] = valueList;
        }

        if (!valueList.includes(value)) {
          valueList.push(value);
        }
      }
    }
  }

  return flagDef;
}

/**
 * Removes flags that only have a single value (always set) and biases
 * boolean flags: On/Enabled first, Off/Disabled last.
 * Returns a new LocalFlagDefinition without mutating the input.
 */
export function filterAndBiasFlags(
  definition: LocalFlagDefinition,
): LocalFlagDefinition {
  const allDefs: FlagDefinition[] = [
    { ...definition.mainShader },
    ...Object.values(definition.functions).map((d) => ({ ...d })),
  ];

  for (const flagDef of allDefs) {
    const keysToRemove: FlagName[] = [];

    for (const [flagName, flagValues] of Object.entries(flagDef)) {
      if (flagValues.length <= 1) {
        keysToRemove.push(flagName);
        continue;
      }

      // Bias against disabling — move Off/Disabled to end
      for (const disableValue of ["Off", "Disabled"]) {
        const idx = flagValues.indexOf(disableValue);
        if (idx !== -1) {
          flagValues.splice(idx, 1);
          flagValues.push(disableValue);
        }
      }

      // Bias towards enabling — move On/Enabled to front
      for (const enableValue of ["On", "Enabled"]) {
        const idx = flagValues.indexOf(enableValue);
        if (idx !== -1) {
          flagValues.splice(idx, 1);
          flagValues.unshift(enableValue);
        }
      }
    }

    for (const key of keysToRemove) {
      delete flagDef[key];
    }
  }

  const [mainShader, ...funcDefs] = allDefs;
  const funcNames = Object.keys(definition.functions);
  const functions: Record<FunctionName, FlagDefinition> = {};
  for (let i = 0; i < funcNames.length; i++) {
    functions[funcNames[i]!] = funcDefs[i]!;
  }

  return { mainShader: mainShader!, functions };
}
