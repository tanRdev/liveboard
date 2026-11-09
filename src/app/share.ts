const GZIP_PREFIX = "v1z.";
const RAW_PREFIX = "v1.";
const MAX_LINK = 12_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeBoardLink(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const token =
    typeof CompressionStream === "undefined"
      ? RAW_PREFIX + bytesToBase64Url(bytes)
      : GZIP_PREFIX + bytesToBase64Url(await gzip(bytes));
  if (token.length > MAX_LINK)
    throw new Error(
      "This board is too large to share as a link. Download the JSON file instead.",
    );
  return token;
}

export async function decodeBoardLink(token: string): Promise<string> {
  const value = token.replace(/^#/, "").trim();
  try {
    if (value.startsWith(GZIP_PREFIX)) {
      const bytes = await gunzip(base64UrlToBytes(value.slice(GZIP_PREFIX.length)));
      const text = new TextDecoder().decode(bytes);
      if (!text) throw new Error("empty");
      return text;
    }
    if (value.startsWith(RAW_PREFIX)) {
      const text = new TextDecoder().decode(
        base64UrlToBytes(value.slice(RAW_PREFIX.length)),
      );
      if (!text) throw new Error("empty");
      return text;
    }
  } catch {
    throw new Error("This board link could not be opened.");
  }
  throw new Error("This board link could not be opened.");
}

export function boardShareUrl(origin: string, path: string, token: string): string {
  return `${origin}${path}#${token}`;
}
