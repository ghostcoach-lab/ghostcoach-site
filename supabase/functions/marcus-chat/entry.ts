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
      // Setup runs before authentication: the detail goes to the log, never the response.
      dependencies.logError("marcus-chat: setup", error);
      return internalError("Configuration error");
    }
  };
}
