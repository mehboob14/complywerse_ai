import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const BACKEND_URL = (
  process.env.BACKEND_URL || "http://127.0.0.1:5000"
).replace(/\/$/, "");

async function checkPythonBackend(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${BACKEND_URL}/grc/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      const aiStatus = (data as Record<string, string>)["ai_features"] ?? "unknown";
      logger.info({ BACKEND_URL, ai_features: aiStatus }, "Python FastAPI backend reachable");
      if (aiStatus !== "enabled") {
        logger.warn(
          "AI features are DISABLED — OPENAI_API_KEY is not set. " +
          "Policy generation, risk recommendations, compliance gap analysis, and ComplyChatBot will not work."
        );
      }
    } else {
      logger.warn(
        { BACKEND_URL, status: response.status },
        "Python FastAPI backend responded with non-OK status"
      );
    }
  } catch {
    logger.warn(
      { BACKEND_URL },
      "Python FastAPI backend not yet reachable — proxy requests will fail until it starts"
    );
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  logger.info(
    { BACKEND_URL },
    "Proxying /api/* → Python FastAPI at BACKEND_URL/grc/*"
  );

  await checkPythonBackend();
});
