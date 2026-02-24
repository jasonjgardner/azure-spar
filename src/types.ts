export type FlagName = string;
export type FlagValue = string;
export type ShaderFlags = Readonly<Record<FlagName, FlagValue>>;
export type FlagDefinition = Record<FlagName, FlagValue[]>;

export type ShaderCode = string;
export type FunctionName = string;
export type ShaderLineIndex = number;
export type ShaderLine = string;
