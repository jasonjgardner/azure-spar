/**
 * Form configuration types for the BetterRTX creator UI.
 *
 * These types define the JSON structure of form.json files that
 * describe which settings are available for a shader version and
 * how they should be presented in the creator form.
 *
 * Each version's shader archive can include a form.json file
 * following this schema.
 */

export type ShowWhen = {
  readonly field: string;
  readonly value: string | boolean | number;
};

export type ToggleField = {
  readonly type: "toggle";
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly default: boolean;
  readonly macro: string;
  readonly showWhen?: ShowWhen;
};

export type SliderField = {
  readonly type: "slider";
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  readonly default: number;
  readonly macro: string;
  readonly macroScale?: number;
  readonly showWhen?: ShowWhen;
  readonly consumedBy?: string;
};

export type SelectField = {
  readonly type: "select";
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly options: readonly string[];
  readonly default: string;
  readonly macro: string;
  readonly macroMap?: Readonly<Record<string, number>>;
  readonly showWhen?: ShowWhen;
};

export type ColorField = {
  readonly type: "color";
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly default: readonly [number, number, number];
  readonly macro: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly showWhen?: ShowWhen;
  readonly intensityField?: string;
};

export type FormField = ToggleField | SliderField | SelectField | ColorField;

export type FormCategory = {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly fields: readonly FormField[];
};

export type FormConfig = {
  readonly categories: readonly FormCategory[];
};
