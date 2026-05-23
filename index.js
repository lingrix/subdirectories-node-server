import http from "http";
import https from "https";
// import NodeCache from "node-cache";

// const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 3000;
const BACKEND_API_URL =
  process.env.BACKEND_API_URL || "https://api.lingrix.com";
const TRANSLATIONS_SERVER_URL =
  process.env.TRANSLATIONS_SERVER_URL ||
  "https://translations-server-production.up.railway.app";

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

const isIpAddress = (hostname) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");

const normalizePagePath = (pagePath) => {
  if (!pagePath || pagePath === "/") return "/";
  return pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
};

const stripLanguagePrefix = (pathname, languageCodes) => {
  const normalized = normalizePagePath(pathname);
  if (normalized === "/") return "/";

  const codes = languageCodes
    .filter(Boolean)
    .map((code) => code.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (codes.length === 0) return normalized;

  const pattern = new RegExp(`^/(${codes.join("|")})(/|$)`, "i");
  const stripped = normalized.replace(pattern, "/");
  return stripped === "" ? "/" : stripped;
};

const fetchProjectInfo = async (apexDomain) => {
  try {
    const response = await fetch(
      `${BACKEND_API_URL}/api/public/project-information-subdirectory/${encodeURIComponent(apexDomain)}`,
    );
    if (!response.ok) return null;
    const data = await response.json();
    return {
      languages: data.languages || [],
      dnsConnectionConfig: data.dnsConnectionConfig || null,
    };
  } catch (error) {
    console.error("Error fetching project info:", error);
    return null;
  }
};

const parseRequestPath = (pathname, languages) => {
  const pathSegments = pathname.split("/").filter(Boolean);
  const firstSegment = pathSegments[0]?.toLowerCase() ?? null;

  const translationLanguages = (languages || []).filter(
    (lang) => !lang.isSource && lang.isEnabled !== false,
  );

  const matchedLang = translationLanguages.find(
    (lang) => lang.code?.toLowerCase() === firstSegment,
  );

  const languageCodes = (languages || []).map((lang) => lang.code).filter(Boolean);
  const originPath = stripLanguagePrefix(pathname, languageCodes);

  if (matchedLang) {
    const languageKey = matchedLang.code.toLowerCase();
    const pagePath =
      pathSegments.length > 1
        ? `/${pathSegments.slice(1).join("/")}`
        : "/";
    return { languageKey, pagePath, originPath, isTranslationRequest: true };
  }

  return {
    languageKey: null,
    pagePath: normalizePagePath(pathname),
    originPath,
    isTranslationRequest: false,
  };
};

const resolveOriginTarget = (apexDomain, dnsConnectionConfig) => {
  if (dnsConnectionConfig?.connectHostname && dnsConnectionConfig?.hostHeader) {
    return {
      connectHostname: dnsConnectionConfig.connectHostname,
      hostHeader: dnsConnectionConfig.hostHeader,
    };
  }

  const connectHostname = apexDomain.replace(/^www\./i, "");
  const isSubdomain = connectHostname.split(".").length > 2;
  const hostHeader = isSubdomain
    ? apexDomain
    : apexDomain.startsWith("www.")
      ? apexDomain
      : `www.${connectHostname}`;

  return { connectHostname, hostHeader };
};

const fetchTranslatedHtml = async (
  apexDomain,
  languageKey,
  pagePath,
  search,
  hash,
) => {
  try {
    console.log(
      "Fetching translated HTML for domain:",
      apexDomain,
      languageKey,
      pagePath,
      search,
      hash,
    );
    const response = await fetch(
      `${TRANSLATIONS_SERVER_URL}/subdirectory/translations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: apexDomain,
          languageKey,
          pagePath,
          queryParams: search,
          hash,
        }),
      },
    );
    const data = await response.json();
    console.log("Translated HTML response status:", response.status);
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

const httpsGetOrigin = (connectHostname, pathAndQuery, hostHeader) =>
  new Promise((resolve, reject) => {
    console.log("httpsGetOrigin", {
      connectHostname,
      pathAndQuery,
      hostHeader,
    });
    const req = https.request(
      {
        hostname: connectHostname,
        port: 443,
        path: pathAndQuery,
        method: "GET",
        servername: isIpAddress(connectHostname) ? hostHeader : connectHostname,
        headers: {
          Host: hostHeader,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "identity",
          "User-Agent": "subdirectories-node-server/1.0",
        },
      },
      (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", () => {
          resolve({
            statusCode: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy(
        new Error(`Request timeout fetching ${hostHeader}${pathAndQuery}`),
      );
    });
    req.end();
  });

const proxyOriginHtml = async (res, originTarget, originPath, search) => {
  const pathAndQuery = `${originPath || "/"}${search || ""}`;
  try {
    const originRes = await httpsGetOrigin(
      originTarget.connectHostname,
      pathAndQuery,
      originTarget.hostHeader,
    );
    const originHtml = originRes.body.toString("utf8");
    const status = originRes.statusCode >= 400 ? originRes.statusCode : 200;
    return sendResponse(res, originHtml, "text/html", status, {
      "Cache-Control": "public, max-age=3600",
    });
  } catch (err) {
    console.error("Error fetching original domain content:", err);
    return sendResponse(res, "Error fetching origin", "text/plain", 502);
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const forwardedHostHeader = req.headers["x-forwarded-host"];
  const forwardedHost = forwardedHostHeader
    ? forwardedHostHeader.split(",")[0].trim()
    : null;

  const host = (forwardedHost || url.hostname).replace(/^www\./i, "");
  const apexDomain = host;

  if (
    host === "subdirectory-translations.lingrix.com" ||
    host.endsWith(".lingrix.com") ||
    host.includes("lingrix.com")
  ) {
    return sendResponse(res, "Visit Lingrix.com", "text/plain");
  }

  if (url.pathname.includes("9874-8927-reset-site-cache-env")) {
    return sendResponse(res, "Cache disabled", "text/plain");
  }

  const projectInfo = await fetchProjectInfo(apexDomain);
  if (!projectInfo) {
    console.error("Project info not found for domain:", apexDomain);
    return sendResponse(res, "Not Found", "text/plain", 404);
  }

  const { languages, dnsConnectionConfig } = projectInfo;
  const { languageKey, pagePath, originPath, isTranslationRequest } =
    parseRequestPath(url.pathname, languages);
  const originTarget = resolveOriginTarget(apexDomain, dnsConnectionConfig);

  console.log("request", {
    apexDomain,
    languageKey,
    pagePath,
    originPath,
    isTranslationRequest,
    originTarget,
  });

  const isStaticPath = STATIC_PATH_PREFIXES.some(
    (prefix) =>
      url.pathname.startsWith(`/${prefix}`) || url.pathname.includes(prefix),
  );

  if (FILE_EXTENSIONS.test(url.pathname) || isStaticPath) {
    console.log("Proxying static asset");
    try {
      const staticPathAndQuery = `${originPath}${url.search || ""}`;
      const assetRes = await httpsGetOrigin(
        originTarget.connectHostname,
        staticPathAndQuery,
        originTarget.hostHeader,
      );
      const ct = assetRes.headers["content-type"] || "application/octet-stream";
      const cc = assetRes.headers["cache-control"] || "public, max-age=3600";
      res.writeHead(assetRes.statusCode, {
        "Content-Type": Array.isArray(ct) ? ct[0] : ct,
        "Cache-Control": Array.isArray(cc) ? cc[0] : cc,
      });
      return res.end(assetRes.body);
    } catch (err) {
      console.error("Error fetching static asset:", err);
      return sendResponse(res, "Error fetching asset", "text/plain", 502);
    }
  }

  if (!isTranslationRequest) {
    console.log("Source-language request, proxying origin");
    return proxyOriginHtml(res, originTarget, originPath, url.search);
  }

  const html = await fetchTranslatedHtml(
    apexDomain,
    languageKey,
    pagePath,
    url.search,
    url.hash,
  );

  if (!html) {
    console.log("No translated HTML, fetching original domain content", {
      originTarget,
      originPath,
      search: url.search,
    });
    return proxyOriginHtml(res, originTarget, originPath, url.search);
  }

  console.log("Returning translated HTML");
  return sendResponse(res, html, "text/html", 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

server.listen(PORT, () => {
  console.log(`Subdirectories proxy server running on port ${PORT}`);
});
