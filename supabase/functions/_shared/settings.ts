import type Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

export type Effort = NonNullable<NonNullable<Anthropic.MessageCreateParams["output_config"]>["effort"]>;
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export type ReadEnv = (name: string) => string | undefined;

// Setting readers. Error messages name the setting, never its value.
export function positiveIntegerSetting(env: ReadEnv, name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function modelSetting(env: ReadEnv, name: string, fallback: string): string {
  const model = (env(name) ?? fallback).trim();
  if (!model) throw new Error(`${name} must not be blank`);
  return model;
}

export function effortSetting(env: ReadEnv, name: string, fallback: Effort): Effort {
  const effort = env(name) ?? fallback;
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new Error(`${name} must be one of ${EFFORTS.join(", ")}`);
  }
  return effort as Effort;
}
