import type { PathMappingConfig, PathMappingRule } from '../types/storage';

const FILE_PROTOCOL = 'file://';
const SYNCABLE_PREFIXES = ['http://', 'https://', 'file://'];

export function isFileUrl(url: string): boolean {
  return url.startsWith(FILE_PROTOCOL);
}

export function isSyncableUrl(url: string): boolean {
  return SYNCABLE_PREFIXES.some(prefix => url.startsWith(prefix));
}

export function extractFilename(fileUrl: string): string {
  try {
    const decoded = decodeURIComponent(fileUrl);
    const pathPart = decoded.replace(/[?#].*$/, '');
    const segments = pathPart.split('/');
    const filename = segments.pop() || segments.pop() || fileUrl;
    return filename;
  } catch {
    const segments = fileUrl.split('/');
    return segments.pop() || fileUrl;
  }
}

function extractPath(fileUrl: string): string {
  return fileUrl.slice(FILE_PROTOCOL.length).split(/[?#]/)[0];
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function normalizeTrailingSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function findMatchingRule(
  path: string,
  rules: PathMappingRule[],
  getPrefix: (rule: PathMappingRule) => string
): PathMappingRule | null {
  const decoded = decodePath(path);
  let bestMatch: PathMappingRule | null = null;
  let bestLength = 0;

  for (const rule of rules) {
    const prefix = normalizeTrailingSlash(getPrefix(rule));
    const normalizedDecoded = normalizeTrailingSlash(decoded);
    if (normalizedDecoded === prefix || decoded.startsWith(prefix + '/')) {
      if (prefix.length > bestLength) {
        bestMatch = rule;
        bestLength = prefix.length;
      }
    }
  }

  return bestMatch;
}

function rewritePath(
  path: string,
  fromPrefix: string,
  toPrefix: string
): string {
  const normalizedFrom = normalizeTrailingSlash(fromPrefix);
  const decoded = decodePath(path);

  if (normalizeTrailingSlash(decoded) === normalizedFrom) {
    return normalizeTrailingSlash(toPrefix);
  }

  // Preserve original encoding in the suffix by slicing from the raw path
  // The decoded prefix length may differ from encoded, so find the encoded boundary
  const encodedFrom = normalizedFrom.replace(/ /g, '%20');
  const normalizedPath = normalizeTrailingSlash(path);
  let suffix: string;
  if (path.startsWith(encodedFrom + '/') || normalizedPath === encodedFrom) {
    suffix = path.slice(encodedFrom.length);
  } else if (decoded.startsWith(normalizedFrom + '/')) {
    suffix = decoded.slice(normalizedFrom.length);
  } else {
    suffix = decoded.slice(normalizedFrom.length);
  }
  return normalizeTrailingSlash(toPrefix) + suffix;
}

export function canonicalize(fileUrl: string, config: PathMappingConfig): string {
  if (!isFileUrl(fileUrl) || config.rules.length === 0) return fileUrl;

  const path = extractPath(fileUrl);
  const rule = findMatchingRule(path, config.rules, r => r.localPrefix);
  if (!rule) return fileUrl;

  const newPath = rewritePath(path, rule.localPrefix, rule.canonicalPrefix);
  const afterPath = fileUrl.slice(FILE_PROTOCOL.length + path.length);
  return FILE_PROTOCOL + newPath + afterPath;
}

export function localize(fileUrl: string, config: PathMappingConfig): string {
  if (!isFileUrl(fileUrl) || config.rules.length === 0) return fileUrl;

  const path = extractPath(fileUrl);
  const rule = findMatchingRule(path, config.rules, r => r.canonicalPrefix);
  if (!rule) return fileUrl;

  const newPath = rewritePath(path, rule.canonicalPrefix, rule.localPrefix);
  const afterPath = fileUrl.slice(FILE_PROTOCOL.length + path.length);
  return FILE_PROTOCOL + newPath + afterPath;
}

export function areSameFile(
  url1: string,
  url2: string,
  config: PathMappingConfig
): boolean {
  if (!isFileUrl(url1) || !isFileUrl(url2)) return url1 === url2;
  return canonicalize(url1, config) === canonicalize(url2, config);
}

// ---------------------------------------------------------------------------
// HTTPS carrier (design-carrier-v3): rewrite file:// <-> https so the URL
// survives Edge Workspace sync (which mangles every non-http(s) scheme into
// "workspace-unsupported"). The local path rides in the URL #fragment, which
// Edge preserves across sync (verified 2026-07-11) and which is never sent to
// the carrier host's server (private). Encode/decode is a pure bijection: the
// substring after `file://` is already percent-encoded and fragment-safe.
// ---------------------------------------------------------------------------

// Single source of truth for the carrier host. Swap this for the real
// GitHub-Pages URL once the /open fallback page is published.
export const CARRIER_HOST = 'tabgroupsync.github.io';
const CARRIER_PREFIX = `https://${CARRIER_HOST}/open#`;

export function isCarrierUrl(url: string): boolean {
  return url.startsWith(CARRIER_PREFIX);
}

// file:///Users/a/b.html  ->  https://HOST/open#/Users/a/b.html
export function encodeCarrier(fileUrl: string): string {
  if (!isFileUrl(fileUrl)) return fileUrl;
  return CARRIER_PREFIX + fileUrl.slice(FILE_PROTOCOL.length);
}

// https://HOST/open#/Users/a/b.html  ->  file:///Users/a/b.html
export function decodeCarrier(carrierUrl: string): string {
  if (!isCarrierUrl(carrierUrl)) return carrierUrl;
  const hashIdx = carrierUrl.indexOf('#');
  return FILE_PROTOCOL + carrierUrl.slice(hashIdx + 1);
}

/**
 * Scope guard (ratified decision 2): only rewrite file:// tabs whose path is
 * under a configured mapping prefix — never touch unrelated local files
 * (Downloads, system paths). True if the path matches a local OR canonical
 * prefix of any rule (so it works before/after canonicalization).
 */
export function pathHasMapping(fileUrl: string, config: PathMappingConfig): boolean {
  if (!isFileUrl(fileUrl) || config.rules.length === 0) return false;
  const path = extractPath(fileUrl);
  return (
    findMatchingRule(path, config.rules, r => r.localPrefix) !== null ||
    findMatchingRule(path, config.rules, r => r.canonicalPrefix) !== null
  );
}
