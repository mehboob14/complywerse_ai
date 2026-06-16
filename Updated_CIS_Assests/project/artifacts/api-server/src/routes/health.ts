import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  "http://127.0.0.1:5000"
).replace(/\/$/, "");

router.get("/healthz", async (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", async (_req, res) => {
  const apiServerStatus = "healthy";
  let pythonBackendStatus: "healthy" | "unreachable" = "unreachable";
  let pythonBackendMessage = "";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${BACKEND_URL}/grc/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      pythonBackendStatus = "healthy";
    } else {
      pythonBackendMessage = `Backend returned HTTP ${response.status}`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    pythonBackendMessage = message;
    logger.warn({ BACKEND_URL, err }, "[Health] Python backend unreachable");
  }

  const isHealthy = pythonBackendStatus === "healthy";

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "degraded",
    services: {
      api_server: apiServerStatus,
      python_backend: {
        status: pythonBackendStatus,
        url: BACKEND_URL,
        ...(pythonBackendMessage ? { message: pythonBackendMessage } : {}),
      },
    },
  });
});

export default router;
