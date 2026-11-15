export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logInfo } = await import("@/server/logger");
    logInfo("system", "runtime.started", {
      node: process.version,
      environment: process.env.NODE_ENV,
    });
  }
}

export const onRequestError: import("next").Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logError } = await import("@/server/logger");
    logError("server", "render.failed", error, {
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
    });
  }
};
