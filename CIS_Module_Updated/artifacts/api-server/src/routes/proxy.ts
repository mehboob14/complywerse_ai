import { Router } from "express";
import { logger } from "../lib/logger";
import type { Request, Response } from "express";

const router = Router();

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://127.0.0.1:5000"
).replace(/\/$/, "");

function getProxyHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = req.headers.cookie;
  const auth = req.headers.authorization;
  const tenantSlug =
    (req.headers["x-tenant-slug"] as string) ||
    (req.headers["X-Tenant-Slug"] as string) ||
    "";
  if (cookie) headers["Cookie"] = cookie;
  if (auth) headers["Authorization"] = auth;
  if (tenantSlug) headers["X-Tenant-Slug"] = tenantSlug;
  return headers;
}

router.post("/compliance/assessments/upload", async (req: Request, res: Response) => {
  const targetUrl = `${BACKEND_URL}/grc/compliance/assessments/upload`;
  logger.info(`[Assessment Upload] Proxying to: ${targetUrl}`);

  try {
    const contentType = req.headers["content-type"] || "";
    const headers: Record<string, string> = getProxyHeaders(req);
    if (contentType) headers["Content-Type"] = contentType;

    const rawBody = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });

    const respContentType = response.headers.get("content-type") || "";
    let data: unknown;
    if (respContentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      logger.error({ text }, "Non-JSON response from backend for assessment upload");
      data = {
        detail: `Backend returned non-JSON response: ${text.substring(0, 200)}`,
      };
    }

    res.status(response.status).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error, targetUrl }, "[Assessment Upload] Proxy error");
    res.status(500).json({
      detail: `Upload failed: ${message}. Ensure backend is running on ${BACKEND_URL}`,
    });
  }
});

router.post(
  "/governance/documents/:documentId/parse-policy",
  async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const targetUrl = `${BACKEND_URL}/grc/governance/documents/${documentId}/parse-policy`;
    logger.info(`[Parse Policy] Proxying for document ${documentId} to: ${targetUrl}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      logger.warn("[Parse Policy] Request timeout after 15 minutes");
      controller.abort();
    }, 900_000);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...getProxyHeaders(req),
      };

      const startTime = Date.now();
      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      logger.info(
        { duration, status: response.status },
        "[Parse Policy] Request completed"
      );

      const data = await response.json();

      if (!response.ok) {
        logger.error({ data }, "[Parse Policy] Backend error");
        res.status(response.status).json(data);
        return;
      }

      res.json(data);
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      const err = error as { name?: string; message?: string };
      logger.error({ error }, "[Parse Policy] Proxy error");

      if (err.name === "AbortError") {
        res.status(504).json({ detail: "Request timeout - document parsing took too long" });
        return;
      }

      res.status(500).json({
        detail: err.message || "Failed to parse policy document",
      });
    }
  }
);

// Endpoints that legitimately take longer than the default ~5-min fetch
// timeout — usually because they iterate over many hosts serially.
const LONG_RUNNING_PATHS = [
  /\/compliance-plugins\/scan-all/,
  /\/compliance-plugins\/[0-9]+\/runs/,  // single plugin/asset scan
];

router.use(async (req: Request, res: Response) => {
  const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = `${BACKEND_URL}/grc${path}${query}`;
  const isLong = LONG_RUNNING_PATHS.some((re) => re.test(path));
  logger.info({ method: req.method, path, targetUrl, longRunning: isLong }, "[Proxy] Forwarding request");

  // Long ops (Scan All, per-asset scan) iterate over 424 WinRM/SSH calls
  // serially. With a single Windows host that's ~7 min; with multiple
  // hosts it can hit 30+ min. Give them 30 minutes; everything else uses
  // the default ~5 min undici timeout.
  const controller = new AbortController();
  const timeoutMs = isLong ? 30 * 60 * 1000 : 0;
  const timeoutId = timeoutMs
    ? setTimeout(() => {
        logger.warn({ path, timeoutMs }, "[Proxy] Long-running request hit timeout");
        controller.abort();
      }, timeoutMs)
    : null;

  try {
    const headers: Record<string, string> = getProxyHeaders(req);
    const contentType = req.headers["content-type"] || "";
    if (contentType) headers["Content-Type"] = contentType;

    const hasBody = ["POST", "PUT", "PATCH"].includes(req.method.toUpperCase());
    let body: Buffer | undefined;
    if (hasBody) {
      if (req.body !== undefined && req.body !== null) {
        body = Buffer.from(JSON.stringify(req.body));
      } else {
        body = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });
      }
      if (!headers["Content-Type"] && body.length > 0) {
        headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody && body && body.length > 0 ? body : undefined,
      signal: controller.signal,
      // @ts-expect-error — Node undici allows duplex for streaming bodies
      duplex: "half",
    });
    if (timeoutId) clearTimeout(timeoutId);

    // Forward Set-Cookie headers so the browser receives auth cookies
    const headersAny = response.headers as unknown as { getSetCookie?: () => string[] };
    const setCookies: string[] =
      typeof headersAny.getSetCookie === "function"
        ? headersAny.getSetCookie()
        : ([response.headers.get("set-cookie")].filter(Boolean) as string[]);
    if (setCookies.length > 0) {
      res.setHeader("Set-Cookie", setCookies);
    }

    const respContentType = response.headers.get("content-type") || "";
    if (respContentType.includes("application/json")) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).type(respContentType || "text/plain").send(text);
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : "Unknown error";
    const err = error as { name?: string };
    logger.error({ error, targetUrl }, "[Proxy] Request failed");
    if (err.name === "AbortError") {
      res.status(504).json({
        detail: "Scan exceeded 30 minutes. It may still be running in the background — check the Recent Runs tab.",
      });
      return;
    }
    res.status(502).json({
      detail: `Backend unreachable: ${message}. Ensure backend is running on ${BACKEND_URL}`,
    });
  }
});

export default router;
