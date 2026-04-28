import http from "http";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 3000;

const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;

const FILE_EXTENSIONS =
  /\.(favicon|ico|css|scss|js|pdf|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|mp4|mp3|zip|json|xml|txt|webp)/i;

const STATIC_PATH_PREFIXES = [
  "_next",
  "api",
  ".well-known",
  ".vscode",
  "robots.txt",
  ".git",
  ".env",
  ".DS_Store",
  "@vite",
];

const fetchTranslatedHtml = async (domain, pagePath, queryParams, hash) => {
  try {
    console.log(
      "Fetching translated HTML for domain:",
      domain,
      pagePath,
      queryParams,
      hash,
    );
    const response = await fetch(
      "https://translations-server-production.up.railway.app/translations-and-project-domain",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, pagePath, queryParams, hash }),
      },
    );
    const data = await response.json();
    console.log("Translated HTML:", data);
    return data?.html ?? null;
  } catch (error) {
    console.error("Error fetching translated HTML:", error);
    return null;
  }
};

const sendResponse = (
  res,
  body,
  contentType,
  status = 200,
  extraHeaders = {},
) => {
  res.writeHead(status, {
    "Content-Type": contentType,
    ...extraHeaders,
  });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const forwardedHostHeader = req.headers["x-forwarded-host"];
  const forwardedHost = forwardedHostHeader
    ? forwardedHostHeader.split(",")[0].trim()
    : null;

  console.log("forwardedHost", forwardedHost);
  console.log("req.headers.host", req.headers.host);

  const host = (forwardedHost || url.hostname).replace(/^www\./i, "");

  console.log("host", host);

  if (
    host === "subdirectory-translations.lingrix.com" ||
    host.endsWith(".lingrix.com") ||
    host.includes("lingrix.com")
  ) {
    return sendResponse(res, "Visit Lingrix.com", "text/plain");
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  const languageKey =
    pathSegments.length > 0 && LANGUAGE_PATTERN.test(pathSegments[0])
      ? pathSegments[0].toLowerCase()
      : null;
  const pagePath =
    languageKey && pathSegments.length > 1
      ? `/${pathSegments.slice(1).join("/")}`
      : languageKey
        ? "/"
        : url.pathname || "/";
  const apexDomain = host;

  const htmlCacheKey = host + pagePath + "-html";

  if (url.pathname.includes("9874-8927-reset-site-cache-env")) {
    cache.del(htmlCacheKey);
    return sendResponse(res, "Cache reset", "text/plain");
  }

  console.log("apexDomain", apexDomain);
  console.log("languageKey", languageKey);
  console.log("pagePath", pagePath);

  const bareOriginalDomain = apexDomain;
  const originUrl = new URL(
    `https://${bareOriginalDomain}${pagePath}${url.search}`,
  );

  const originHostHeader = !bareOriginalDomain.startsWith("www.")
    ? `www.${bareOriginalDomain}`
    : bareOriginalDomain;

  console.log("originUrl", originUrl.toString());

  const isStaticPath = STATIC_PATH_PREFIXES.some(
    (prefix) =>
      url.pathname.startsWith(`/${prefix}`) || url.pathname.includes(prefix),
  );

  if (FILE_EXTENSIONS.test(url.pathname) || isStaticPath) {
    console.log("Proxying static asset");
    try {
      const assetRes = await fetch(originUrl.toString(), {
        headers: { Host: originHostHeader },
        redirect: "manual",
      });
      const buffer = await assetRes.arrayBuffer();
      res.writeHead(assetRes.status, {
        "Content-Type":
          assetRes.headers.get("content-type") || "application/octet-stream",
        "Cache-Control":
          assetRes.headers.get("cache-control") || "public, max-age=3600",
      });
      return res.end(Buffer.from(buffer));
    } catch (err) {
      console.error("Error fetching static asset:", err);
      return sendResponse(res, "Error fetching asset", "text/plain", 502);
    }
  }

  console.log("html cache key", htmlCacheKey);

  const cachedHtml = cache.get(htmlCacheKey);
  if (cachedHtml) {
    console.log("Returning cached response");
    return sendResponse(res, cachedHtml, "text/html", 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  const html = await fetchTranslatedHtml(
    apexDomain,
    pagePath,
    url.search,
    url.hash,
  );

  if (!html) {
    console.log("No translated HTML, fetching original domain content", {
      originHostHeader,
      originUrl: originUrl.toString(),
    });
    try {
      const originRes = await fetch(originUrl.toString(), {
        headers: { Host: originHostHeader },
        redirect: "manual",
      });
      const originHtml = await originRes.text();
      return sendResponse(res, originHtml, "text/html", 200, {
        "Cache-Control": "public, max-age=3600",
      });
    } catch (err) {
      console.error("Error fetching original domain content:", err);
      return sendResponse(res, "Error fetching origin", "text/plain", 502);
    }
  }

  console.log("Returning translated HTML");
  cache.set(htmlCacheKey, html);
  return sendResponse(res, html, "text/html", 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

server.listen(PORT, () => {
  console.log(`Subdirectories proxy server running on port ${PORT}`);
});
