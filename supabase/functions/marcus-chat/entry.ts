import { internalError, preflight } from "./handler.ts";

export interface MarcusChatEntryDependencies {
  createHandler(): (request: Request) => Promise<Response>;
  logError(label: string, detail: unknown): void;
}

export function createMarcusChatEntryHandler(
  dependencies: MarcusChatEntryDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === "OPTIONS") return preflight();
    try {
      return await dependencies.createHandler()(request);
    } catch (error) {
      dependencies.logError("marcus-chat: setup", error);
      return internalError(error);
    }
  };
}
