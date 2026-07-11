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

// Single source of truth for the carrier host + path. Published fallback page
// lives at https://<CARRIER_HOST><CARRIER_PATH> (GitHub Pages project site).
// Trailing slash is REQUIRED: GitHub Pages serves /tabgroupsync/open/index.html
// and 301-redirects /open -> /open/. Encoding the canonical carrier WITH the
// slash avoids that redirect, so at-rest carrier tabs keep a URL that
// isCarrierUrl still matches (a redirect to /open/# would break recognition).
export const CARRIER_HOST = 'kundeng.github.io';
export const CARRIER_PATH = '/tabgroupsync/open/';
const CARRIER_PREFIX = `https://${CARRIER_HOST}${CARRIER_PATH}#`;

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

// ---------------------------------------------------------------------------
// HOME-RELATIVE auto-normalization (zero-config path handling).
//
// Every OS puts the user under a detectable home prefix, so instead of
// per-machine rules we can store carriers HOME-RELATIVE (`~/Dropbox/...`) and
// each machine strips/prepends its own home automatically. Files must be under
// a "synced root" (default Dropbox) so we never carrier-ize non-synced local
// files (Downloads, /etc, ...) that wouldn't exist on other machines.
// Manual path-mapping rules remain the fallback for exotic (non-home) paths.
// ---------------------------------------------------------------------------

export const DEFAULT_CARRIER_ROOTS = ['Dropbox'];

const HOME_PATTERNS = [
  /^(\/Users\/[^/]+)/,           // macOS   /Users/<user>
  /^(\/home\/[^/]+)/,            // Linux   /home/<user>
  /^(\/[A-Za-z]:\/Users\/[^/]+)/, // Windows /C:/Users/<user>
];

/** Detect the home prefix from a file path (the part after `file://`). */
export function detectHome(path: string): string | null {
  for (const re of HOME_PATTERNS) {
    const m = path.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Detect this machine's home prefix from a file:// URL (null if not a file URL). */
export function homeFromFileUrl(fileUrl: string): string | null {
  if (!isFileUrl(fileUrl)) return null;
  return detectHome(decodePath(extractPath(fileUrl)));
}

/**
 * If `path` is under home AND under one of the synced roots, return its
 * home-relative canonical form (`~/Dropbox/...`); otherwise null.
 */
function homeRelativePath(
  path: string,
  localHome: string | null,
  roots: string[],
): string | null {
  const decoded = decodePath(path);
  const home = detectHome(decoded) || localHome;
  if (!home) return null;
  if (decoded !== home && !decoded.startsWith(home + '/')) return null;
  const rel = decoded.slice(home.length); // "/Dropbox/x" or ""
  for (const root of roots) {
    if (rel === '/' + root || rel.startsWith('/' + root + '/')) return '~' + rel;
  }
  return null;
}

/**
 * Should this file:// tab be rewritten to a carrier? True if it's under a
 * synced home root (zero-config) OR matches a manual mapping rule (fallback).
 */
export function shouldCarrier(
  fileUrl: string,
  localHome: string | null,
  config: PathMappingConfig,
  roots: string[] = DEFAULT_CARRIER_ROOTS,
): boolean {
  if (!isFileUrl(fileUrl)) return false;
  if (homeRelativePath(extractPath(fileUrl), localHome, roots) !== null) return true;
  return pathHasMapping(fileUrl, config);
}

/**
 * file:// URL -> carrier. Prefers home-relative (`~/...`); falls back to manual
 * canonicalize when the path isn't under a synced home root.
 */
export function fileUrlToCarrier(
  fileUrl: string,
  localHome: string | null,
  config: PathMappingConfig,
  roots: string[] = DEFAULT_CARRIER_ROOTS,
): string {
  if (!isFileUrl(fileUrl)) return fileUrl;
  const path = extractPath(fileUrl);
  const suffix = fileUrl.slice(FILE_PROTOCOL.length + path.length); // own query/#frag
  const rel = homeRelativePath(path, localHome, roots);
  if (rel) return CARRIER_PREFIX + rel + suffix;
  return encodeCarrier(canonicalize(fileUrl, config)); // rule-based fallback
}

/**
 * carrier -> file:// URL for THIS machine. Home-relative (`~/...`) carriers use
 * this machine's `localHome`; absolute carriers use manual localize. Returns
 * null if a home-relative carrier arrives before this machine's home is known
 * (bootstrap gap) — caller should fall back to the opener page.
 */
export function carrierToFileUrl(
  carrierUrl: string,
  localHome: string | null,
  config: PathMappingConfig,
): string | null {
  if (!isCarrierUrl(carrierUrl)) return carrierUrl;
  const frag = carrierUrl.slice(carrierUrl.indexOf('#') + 1);
  const cpath = frag.split(/[?#]/)[0];        // canonical/relative path portion
  const suffix = frag.slice(cpath.length);    // file's own query/#frag
  if (cpath.startsWith('~')) {
    if (!localHome) return null;              // bootstrap: home not learned yet
    return FILE_PROTOCOL + localHome + cpath.slice(1) + suffix;
  }
  return localize(FILE_PROTOCOL + cpath + suffix, config); // absolute -> rules
}
