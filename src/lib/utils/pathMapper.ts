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

// NOTE: the naive `decodeCarrier` (file://` + everything-after-#) was REMOVED —
// it produced un-openable `file://~/…` for home-relative carriers. Decode goes
// through `carrierToFileUrl` (home-swap + rules), never a raw prefix strip.

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

export type LocalOs = 'mac' | 'linux' | 'win';

/** This machine's OS family from a userAgent string (pure; caller passes navigator.userAgent). */
export function osFromUserAgent(ua: string): LocalOs | null {
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'win';
  if (/Linux|X11|CrOS/.test(ua)) return 'linux';
  return null;
}

const OS_HOME_PREFIX: Record<LocalOs, string> = {
  mac: '/Users/',
  linux: '/home/',
  win: '/C:/Users/',
};

/**
 * Bootstrap fallback: infer THIS machine's home for the SAME username when we
 * haven't learned it from a local file yet. e.g. source `/Users/alice` on a
 * Linux box → `/home/alice`. Lets a fresh machine open a cross-OS carrier before
 * the user has opened any local file. Only sound when usernames match across
 * machines (the common case); a learned `localHome` always wins over this.
 */
/**
 * Normalize a file:// OR carrier URL to a home-relative KEY, so a local tab and
 * its carrier sibling pair up even across machines/OSes. Both
 * `file:///Users/kundeng/Dropbox/x` and `…/open/#/home/kundeng/Dropbox/x`
 * → `~/Dropbox/x`. Returns null for non-file/non-carrier URLs. Files outside a
 * synced home root fall back to their absolute path (still a stable key).
 */
export function pairKey(
  url: string,
  localHome: string | null,
  roots: string[] = DEFAULT_CARRIER_ROOTS,
): string | null {
  let path: string | null = null;
  if (isFileUrl(url)) {
    path = extractPath(url);
  } else if (isCarrierUrl(url)) {
    const frag = url.slice(url.indexOf('#') + 1);
    const cpath = frag.split(/[?#]/)[0];
    if (cpath.startsWith('~')) return decodePath(cpath); // legacy ~ carrier: already relative
    path = cpath;
  } else {
    return null;
  }
  const decoded = decodePath(path);
  return homeRelativePath(decoded, localHome, roots) ?? decoded;
}

export function inferLocalHome(sourceHome: string, localOs: LocalOs | null): string | null {
  if (!localOs) return null;
  const prefix = OS_HOME_PREFIX[localOs];
  if (!prefix) return null;
  const user = sourceHome.split('/').filter(Boolean).pop();
  return user ? prefix + user : null;
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
  // Gate: only carrier-ize files under a synced home root (zero-config) or a
  // manual rule — never unrelated local files.
  if (homeRelativePath(extractPath(fileUrl), localHome, roots) !== null) {
    // Emit an ABSOLUTE carrier (full source path), NOT `~/…`. An absolute path
    // always naively decodes to a valid file:// — even by an older/dumber peer
    // that can't expand `~` (which would strand an un-openable `file://~/…`).
    // Cross-OS / cross-user home remapping happens at DECODE time instead.
    return encodeCarrier(fileUrl);
  }
  return encodeCarrier(canonicalize(fileUrl, config)); // manual-rule fallback
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
  localOs: LocalOs | null = null,
): string | null {
  if (!isCarrierUrl(carrierUrl)) return carrierUrl;
  const frag = carrierUrl.slice(carrierUrl.indexOf('#') + 1);
  const cpath = frag.split(/[?#]/)[0];        // path portion of the fragment
  const suffix = frag.slice(cpath.length);    // file's own query/#frag
  // Legacy home-relative carriers (`~/…`) from older builds: expand with our
  // home. If our home isn't known yet, signal the caller (opener page) rather
  // than emit an un-openable `file://~/…`.
  if (cpath.startsWith('~')) {
    if (!localHome) return null;
    return FILE_PROTOCOL + localHome + cpath.slice(1) + suffix;
  }
  // Absolute carrier → reconstruct the file:// and localize it to this machine.
  return localizeFileUrl(FILE_PROTOCOL + cpath + suffix, localHome, config, localOs);
}

/**
 * Map ANY file:// URL to THIS machine's local path. Shared by carrier decode
 * (absolute branch) AND bookmark restore, so saved `file://` bookmarks are
 * portable ZERO-CONFIG. Order of precedence:
 *   1. explicit manual mapping rule (user config wins);
 *   2. home-swap the detected source-home prefix → this machine's `localHome`
 *      (/home/<u> ⇄ /Users/<u> ⇄ /C:/Users/<u>, incl. differing usernames);
 *   3. if home not learned yet, infer it from this machine's OS + source username;
 *   4. else return as-is (still valid on a same-layout peer).
 */
export function localizeFileUrl(
  fileUrl: string,
  localHome: string | null,
  config: PathMappingConfig,
  localOs: LocalOs | null = null,
): string {
  if (!isFileUrl(fileUrl)) return fileUrl;
  const ruled = localize(fileUrl, config);
  if (ruled !== fileUrl) return ruled;                 // a manual rule matched
  const path = extractPath(fileUrl);
  const suffix = fileUrl.slice(FILE_PROTOCOL.length + path.length);
  const srcHome = detectHome(path);
  if (srcHome) {
    const target = localHome || inferLocalHome(srcHome, localOs);
    if (target && target !== srcHome) {
      return FILE_PROTOCOL + target + path.slice(srcHome.length) + suffix;
    }
  }
  return fileUrl;
}
