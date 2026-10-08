export interface MarcusChatPromptValues {
  first_name: string;
  product: string;
  stage: string;
  goal_90_day: string;
  goal_progress: string | number;
  session_history: string;
  audit_block: string;
}

export function renderMarcusChatPrompt(
  template: string,
  values: MarcusChatPromptValues,
): string {
  return template.replace(
    /{{([^{}]*)}}/g,
    (_placeholder, name: string) => {
      if (!Object.hasOwn(values, name)) {
        throw new Error(`unknown placeholder: ${name}`);
      }
      return String(values[name as keyof MarcusChatPromptValues]);
    },
  );
}
