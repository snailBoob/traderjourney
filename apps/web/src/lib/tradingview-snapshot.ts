import { RequestError, requireValue } from "@/server/api";
import { attachmentMime, MAX_ATTACHMENT_SIZE } from "@/lib/attachment-validation";

const TRADINGVIEW_SNAPSHOT = /^\/x\/([A-Za-z0-9_-]+)\/?$/;
const isAllowedTradingViewHost = (value: string) => {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "tradingview.com" || hostname.endsWith(".tradingview.com");
};
export const validTradingViewUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      isAllowedTradingViewHost(value) &&
      TRADINGVIEW_SNAPSHOT.test(url.pathname)
    );
  } catch {
    return false;
  }
};

async function fetchAllowed(url: string, maxBytes: number) {
  let current = url;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parsed = new URL(current);
    requireValue(
      parsed.protocol === "https:" && isAllowedTradingViewHost(current),
      "TradingView URL is not allowed.",
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "TraderJourney",
          Accept: "text/html,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
    } catch {
      throw new RequestError("Could not fetch the TradingView snapshot.");
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      requireValue(location, "TradingView snapshot redirect is invalid.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok)
      throw new RequestError(`TradingView snapshot could not be fetched (${response.status}).`);
    const length = Number(response.headers.get("content-length") ?? 0);
    requireValue(!length || length <= maxBytes, "TradingView snapshot is larger than 8 MB.");
    const bytes = Buffer.from(await response.arrayBuffer());
    requireValue(bytes.length <= maxBytes, "TradingView snapshot is larger than 8 MB.");
    return { response, bytes, url: current };
  }
  throw new RequestError("TradingView snapshot redirected too many times.");
}

export async function fetchTradingViewSnapshot(url: string) {
  requireValue(validTradingViewUrl(url), "Enter a valid TradingView snapshot URL.");

  // TradingView's public snapshot page may expose metadata differently between
  // responses. Try its stable direct PNG URL first, then fall back to the page
  // and its Open Graph/Twitter image metadata. This helper is shared by Trades
  // and Missed Trades, so both use the same retrieval sequence.
  const snapshotId = new URL(url).pathname.match(TRADINGVIEW_SNAPSHOT)?.[1];
  if (snapshotId) {
    const snapshotPrefix = snapshotId.charAt(0).toLowerCase();
    const directImageUrl = `https://s3.tradingview.com/snapshots/${snapshotPrefix}/${snapshotId}.png`;
    try {
      const directImage = await fetchAllowed(directImageUrl, MAX_ATTACHMENT_SIZE);
      const directMime = attachmentMime(directImage.bytes);
      if (directMime?.startsWith("image/")) {
        return { bytes: directImage.bytes, mime: directMime };
      }
    } catch {
      // Some snapshots are only discoverable through page metadata; continue
      // with the same HTML fallback used previously.
    }
  }

  const page = await fetchAllowed(url, 2 * 1024 * 1024);
  const pageMime = attachmentMime(page.bytes);
  if (pageMime?.startsWith("image/")) return { bytes: page.bytes, mime: pageMime };
  const contentType = page.response.headers.get("content-type")?.toLowerCase() ?? "";
  requireValue(
    contentType.includes("text/html"),
    "The TradingView URL did not return a snapshot page.",
  );
  const html = page.bytes.toString("utf8");
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  // HTML attribute order is not fixed. Parse each attribute independently so
  // `content` works whether it appears before or after `property`/`name`.
  const imageValue = metaTags
    .map((tag) => {
      const attributes = new Map<string, string>();
      for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) {
        const attributeName = match[1];
        const attributeValue = match[3];
        if (attributeName !== undefined && attributeValue !== undefined) {
          attributes.set(attributeName.toLowerCase(), attributeValue);
        }
      }
      const property = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
      const content = attributes.get("content")?.replace(/&amp;/g, "&");
      return property === "og:image" || property === "twitter:image" ? content : undefined;
    })
    .find(Boolean);
  requireValue(imageValue, "Could not find the TradingView snapshot image.");
  const imageUrl = new URL(imageValue!, page.url).toString();
  requireValue(
    isAllowedTradingViewHost(imageUrl),
    "TradingView snapshot image host is not allowed.",
  );
  const image = await fetchAllowed(imageUrl, MAX_ATTACHMENT_SIZE);
  const mime = attachmentMime(image.bytes);
  requireValue(mime?.startsWith("image/"), "The TradingView snapshot is not a supported image.");
  return { bytes: image.bytes, mime: mime! };
}
