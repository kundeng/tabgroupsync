import { describe, it, expect } from 'vitest';
import {
  isFileUrl,
  isSyncableUrl,
  extractFilename,
  canonicalize,
  localize,
  areSameFile,
  encodeCarrier,
  decodeCarrier,
  isCarrierUrl,
  pathHasMapping,
  CARRIER_HOST,
  CARRIER_PATH,
  detectHome,
  homeFromFileUrl,
  fileUrlToCarrier,
  carrierToFileUrl,
  inferLocalHome,
  shouldCarrier,
} from '../../../src/lib/utils/pathMapper';
import type { PathMappingConfig } from '../../../src/lib/types/storage';

const emptyConfig: PathMappingConfig = { machineId: '', rules: [] };

const linuxConfig: PathMappingConfig = {
  machineId: 'linux-home',
  rules: [
    { canonicalPrefix: '/Users/foo/Dropbox', localPrefix: '/home/bar/Dropbox' },
  ],
};

const multiRuleConfig: PathMappingConfig = {
  machineId: 'linux-home',
  rules: [
    { canonicalPrefix: '/Users/foo/Dropbox', localPrefix: '/home/bar/Dropbox' },
    { canonicalPrefix: '/Users/foo/Dropbox/Work', localPrefix: '/home/bar/Work' },
  ],
};

const canonicalMachineConfig: PathMappingConfig = {
  machineId: 'macbook-work',
  rules: [
    { canonicalPrefix: '/Users/foo/Dropbox', localPrefix: '/Users/foo/Dropbox' },
  ],
};

describe('isFileUrl', () => {
  it('returns true for file:// URLs', () => {
    expect(isFileUrl('file:///home/user/doc.pdf')).toBe(true);
    expect(isFileUrl('file:///C:/Users/foo/doc.pdf')).toBe(true);
  });

  it('returns false for non-file URLs', () => {
    expect(isFileUrl('http://example.com')).toBe(false);
    expect(isFileUrl('https://example.com')).toBe(false);
    expect(isFileUrl('chrome://extensions')).toBe(false);
    expect(isFileUrl('')).toBe(false);
  });
});

describe('isSyncableUrl', () => {
  it('allows http, https, and file', () => {
    expect(isSyncableUrl('http://example.com')).toBe(true);
    expect(isSyncableUrl('https://example.com')).toBe(true);
    expect(isSyncableUrl('file:///path')).toBe(true);
  });

  it('rejects browser-internal URLs', () => {
    expect(isSyncableUrl('chrome://extensions')).toBe(false);
    expect(isSyncableUrl('edge://settings')).toBe(false);
    expect(isSyncableUrl('about:blank')).toBe(false);
    expect(isSyncableUrl('brave://flags')).toBe(false);
    expect(isSyncableUrl('')).toBe(false);
  });
});

describe('extractFilename', () => {
  it('extracts filename from normal paths', () => {
    expect(extractFilename('file:///home/user/book/ch1.html')).toBe('ch1.html');
  });

  it('handles URL-encoded paths', () => {
    expect(extractFilename('file:///Users/foo/My%20Documents/file.pdf')).toBe('file.pdf');
  });

  it('handles deep paths', () => {
    expect(extractFilename('file:///a/b/c/d/e/doc.txt')).toBe('doc.txt');
  });

  it('handles trailing slashes', () => {
    expect(extractFilename('file:///home/user/folder/')).toBe('folder');
  });

  it('handles fragments and query strings', () => {
    expect(extractFilename('file:///path/file.html#section')).toBe('file.html');
    expect(extractFilename('file:///path/file.html?q=1')).toBe('file.html');
  });
});

describe('canonicalize', () => {
  it('rewrites local prefix to canonical', () => {
    const result = canonicalize('file:///home/bar/Dropbox/book/ch1.html', linuxConfig);
    expect(result).toBe('file:///Users/foo/Dropbox/book/ch1.html');
  });

  it('returns unchanged when no mapping matches', () => {
    const result = canonicalize('file:///other/path/doc.pdf', linuxConfig);
    expect(result).toBe('file:///other/path/doc.pdf');
  });

  it('returns unchanged with empty config', () => {
    const result = canonicalize('file:///home/bar/Dropbox/doc.pdf', emptyConfig);
    expect(result).toBe('file:///home/bar/Dropbox/doc.pdf');
  });

  it('returns unchanged for non-file URLs', () => {
    const result = canonicalize('https://example.com', linuxConfig);
    expect(result).toBe('https://example.com');
  });

  it('applies longest-prefix match', () => {
    const result = canonicalize('file:///home/bar/Work/project/file.ts', multiRuleConfig);
    expect(result).toBe('file:///Users/foo/Dropbox/Work/project/file.ts');
  });

  it('is a no-op on the canonical machine', () => {
    const result = canonicalize('file:///Users/foo/Dropbox/doc.pdf', canonicalMachineConfig);
    expect(result).toBe('file:///Users/foo/Dropbox/doc.pdf');
  });

  it('preserves fragments', () => {
    const result = canonicalize('file:///home/bar/Dropbox/doc.html#section', linuxConfig);
    expect(result).toBe('file:///Users/foo/Dropbox/doc.html#section');
  });

  it('handles prefix-only paths', () => {
    const result = canonicalize('file:///home/bar/Dropbox', linuxConfig);
    expect(result).toBe('file:///Users/foo/Dropbox');
  });
});

describe('localize', () => {
  it('rewrites canonical prefix to local', () => {
    const result = localize('file:///Users/foo/Dropbox/book/ch1.html', linuxConfig);
    expect(result).toBe('file:///home/bar/Dropbox/book/ch1.html');
  });

  it('returns unchanged when no mapping matches', () => {
    const result = localize('file:///other/path/doc.pdf', linuxConfig);
    expect(result).toBe('file:///other/path/doc.pdf');
  });

  it('returns unchanged with empty config', () => {
    const result = localize('file:///Users/foo/Dropbox/doc.pdf', emptyConfig);
    expect(result).toBe('file:///Users/foo/Dropbox/doc.pdf');
  });

  it('preserves fragments', () => {
    const result = localize('file:///Users/foo/Dropbox/doc.html#section', linuxConfig);
    expect(result).toBe('file:///home/bar/Dropbox/doc.html#section');
  });
});

describe('areSameFile', () => {
  it('recognizes same file across machines', () => {
    const mac = 'file:///Users/foo/Dropbox/doc.pdf';
    const linux = 'file:///home/bar/Dropbox/doc.pdf';
    expect(areSameFile(mac, linux, linuxConfig)).toBe(true);
  });

  it('recognizes different files', () => {
    const a = 'file:///Users/foo/Dropbox/a.pdf';
    const b = 'file:///Users/foo/Dropbox/b.pdf';
    expect(areSameFile(a, b, linuxConfig)).toBe(false);
  });

  it('uses string comparison for non-file URLs', () => {
    expect(areSameFile('https://a.com', 'https://a.com', linuxConfig)).toBe(true);
    expect(areSameFile('https://a.com', 'https://b.com', linuxConfig)).toBe(false);
  });

  it('returns false when mixing file and non-file', () => {
    expect(areSameFile('file:///a', 'https://a', linuxConfig)).toBe(false);
  });
});

describe('round-trip invariant', () => {
  it('localize(canonicalize(url)) === url', () => {
    const urls = [
      'file:///home/bar/Dropbox/book/ch1.html',
      'file:///home/bar/Dropbox/My%20Documents/file.pdf',
      'file:///home/bar/Dropbox/doc.html#section',
    ];
    for (const url of urls) {
      expect(localize(canonicalize(url, linuxConfig), linuxConfig)).toBe(url);
    }
  });
});

describe('idempotency', () => {
  it('canonicalize(canonicalize(url)) === canonicalize(url)', () => {
    const urls = [
      'file:///home/bar/Dropbox/doc.pdf',
      'file:///other/path/doc.pdf',
      'https://example.com',
    ];
    for (const url of urls) {
      const once = canonicalize(url, linuxConfig);
      const twice = canonicalize(once, linuxConfig);
      expect(twice).toBe(once);
    }
  });
});

describe('carrier encode/decode', () => {
  it('encodes file:// into an https carrier under CARRIER_HOST with the path in the fragment', () => {
    const c = encodeCarrier('file:///Users/foo/Dropbox/book/ch1.html');
    expect(c).toBe(`https://${CARRIER_HOST}${CARRIER_PATH}#/Users/foo/Dropbox/book/ch1.html`);
    expect(isCarrierUrl(c)).toBe(true);
  });

  it('decodes a carrier back to the original file:// URL', () => {
    const c = `https://${CARRIER_HOST}${CARRIER_PATH}#/Users/foo/Dropbox/book/ch1.html`;
    expect(decodeCarrier(c)).toBe('file:///Users/foo/Dropbox/book/ch1.html');
  });

  it('is a lossless bijection for arbitrary file:// URLs (incl. windows, encoded, fragments-in-name)', () => {
    const urls = [
      'file:///home/bar/Dropbox/doc.pdf',
      'file:///C:/Users/foo/My%20Documents/a.html',
      'file:///Users/foo/Dropbox/note%23draft.md', // literal # already encoded
      'file:///a/b/c.html',
    ];
    for (const u of urls) {
      expect(decodeCarrier(encodeCarrier(u))).toBe(u);
    }
  });

  it('is a no-op on non-file URLs (encode) and non-carrier URLs (decode)', () => {
    expect(encodeCarrier('https://example.com/x')).toBe('https://example.com/x');
    expect(encodeCarrier('edge://settings')).toBe('edge://settings');
    expect(decodeCarrier('https://example.com/x')).toBe('https://example.com/x');
    expect(decodeCarrier('file:///a/b')).toBe('file:///a/b');
  });

  it('isCarrierUrl only matches the carrier host + /open# prefix', () => {
    expect(isCarrierUrl(`https://${CARRIER_HOST}${CARRIER_PATH}#/x`)).toBe(true);
    expect(isCarrierUrl(`https://${CARRIER_HOST}/other#/x`)).toBe(false);
    expect(isCarrierUrl('https://evil.com/open#/x')).toBe(false);
    expect(isCarrierUrl('file:///x')).toBe(false);
  });
});

describe('pathHasMapping (rewrite scope guard)', () => {
  it('true when the file path is under a local prefix', () => {
    expect(pathHasMapping('file:///home/bar/Dropbox/book.html', linuxConfig)).toBe(true);
  });
  it('true when the file path is under a canonical prefix (pre-canonicalization)', () => {
    expect(pathHasMapping('file:///Users/foo/Dropbox/book.html', linuxConfig)).toBe(true);
  });
  it('false for unmapped local files (Downloads, system paths)', () => {
    expect(pathHasMapping('file:///home/bar/Downloads/x.pdf', linuxConfig)).toBe(false);
    expect(pathHasMapping('file:///etc/hosts', linuxConfig)).toBe(false);
  });
  it('false for non-file URLs and empty config', () => {
    expect(pathHasMapping('https://example.com', linuxConfig)).toBe(false);
    expect(pathHasMapping('file:///home/bar/Dropbox/x', emptyConfig)).toBe(false);
  });
});

describe('detectHome / homeFromFileUrl (OS home patterns)', () => {
  it('detects macOS, Linux, and Windows home prefixes', () => {
    expect(detectHome('/Users/kundeng/Dropbox/x.html')).toBe('/Users/kundeng');
    expect(detectHome('/home/kundeng/Dropbox/x.html')).toBe('/home/kundeng');
    expect(detectHome('/C:/Users/kundeng/Dropbox/x.html')).toBe('/C:/Users/kundeng');
  });
  it('returns null for non-home paths', () => {
    expect(detectHome('/mnt/data/x')).toBe(null);
    expect(detectHome('/etc/hosts')).toBe(null);
  });
  it('homeFromFileUrl works on file URLs, null otherwise', () => {
    expect(homeFromFileUrl('file:///Users/kundeng/Dropbox/x.html')).toBe('/Users/kundeng');
    expect(homeFromFileUrl('https://example.com')).toBe(null);
  });
});

describe('fileUrlToCarrier — absolute carrier under synced root (zero-config)', () => {
  const CARRIER = `https://${CARRIER_HOST}${CARRIER_PATH}#`;
  it('emits the ABSOLUTE source path for a Dropbox file (per-OS; normalized at decode)', () => {
    // Each machine carries its own absolute path — an absolute path always
    // decodes to a valid file:// even by a peer that cannot expand `~`. The
    // cross-OS/cross-user remap happens in carrierToFileUrl, not here.
    expect(fileUrlToCarrier('file:///Users/kundeng/Dropbox/Projects/X/file.html', null, emptyConfig))
      .toBe(`${CARRIER}/Users/kundeng/Dropbox/Projects/X/file.html`);
    expect(fileUrlToCarrier('file:///home/kundeng/Dropbox/Projects/X/file.html', null, emptyConfig))
      .toBe(`${CARRIER}/home/kundeng/Dropbox/Projects/X/file.html`);
    expect(fileUrlToCarrier('file:///C:/Users/kundeng/Dropbox/Projects/X/file.html', null, emptyConfig))
      .toBe(`${CARRIER}/C:/Users/kundeng/Dropbox/Projects/X/file.html`);
  });
  it('does NOT carrier-ize non-synced home files (Downloads) with no rule', () => {
    // falls back to encodeCarrier(canonicalize) which, with empty config, is the raw path
    const r = fileUrlToCarrier('file:///Users/kundeng/Downloads/x.pdf', null, emptyConfig);
    expect(r).toBe(`${CARRIER}/Users/kundeng/Downloads/x.pdf`); // absolute, not ~-relative
  });
  it('falls back to a manual rule for non-home paths', () => {
    const cfg: PathMappingConfig = { machineId: 'm', rules: [{ canonicalPrefix: '/data/shared', localPrefix: '/mnt/data/shared' }] };
    expect(fileUrlToCarrier('file:///mnt/data/shared/y.html', null, cfg)).toBe(`${CARRIER}/data/shared/y.html`);
  });
});

describe('carrierToFileUrl — home-expand per machine', () => {
  const CARRIER = `https://${CARRIER_HOST}${CARRIER_PATH}#`;
  const c = `${CARRIER}~/Dropbox/Projects/X/file.html`;
  it('expands the same carrier to each machine\'s local path', () => {
    expect(carrierToFileUrl(c, '/Users/kundeng', emptyConfig)).toBe('file:///Users/kundeng/Dropbox/Projects/X/file.html');
    expect(carrierToFileUrl(c, '/home/kundeng', emptyConfig)).toBe('file:///home/kundeng/Dropbox/Projects/X/file.html');
    expect(carrierToFileUrl(c, '/C:/Users/kundeng', emptyConfig)).toBe('file:///C:/Users/kundeng/Dropbox/Projects/X/file.html');
  });
  it('returns null when the home isn\'t learned yet (bootstrap gap)', () => {
    expect(carrierToFileUrl(c, null, emptyConfig)).toBe(null);
  });
  it('localizes ABSOLUTE (non-~) carriers via manual rules', () => {
    const abs = `${CARRIER}/data/shared/y.html`;
    const cfg: PathMappingConfig = { machineId: 'm', rules: [{ canonicalPrefix: '/data/shared', localPrefix: '/mnt/data/shared' }] };
    expect(carrierToFileUrl(abs, null, cfg)).toBe('file:///mnt/data/shared/y.html');
  });
});

describe('home-relative round-trip (cross-OS)', () => {
  it('Mac encodes -> Linux decodes to the Linux path (no rules, no machine IDs)', () => {
    const macFile = 'file:///Users/kundeng/Dropbox/book/ch1.html';
    const carrier = fileUrlToCarrier(macFile, null, emptyConfig);
    expect(carrierToFileUrl(carrier, '/home/kundeng', emptyConfig)).toBe('file:///home/kundeng/Dropbox/book/ch1.html');
  });
});

describe('carrier decode robustness — never strand an un-openable URL', () => {
  const CARRIER = `https://${CARRIER_HOST}${CARRIER_PATH}#`;
  it('absolute carrier + home known but DIFFERENT username → swaps whole home prefix', () => {
    const c = `${CARRIER}/Users/alice/Dropbox/x.html`;
    expect(carrierToFileUrl(c, '/home/bob', emptyConfig)).toBe('file:///home/bob/Dropbox/x.html');
  });
  it('absolute carrier + home unknown → falls back to the raw absolute file:// (valid, openable on a same-layout peer)', () => {
    const c = `${CARRIER}/Users/kundeng/Dropbox/x.html`;
    expect(carrierToFileUrl(c, null, emptyConfig)).toBe('file:///Users/kundeng/Dropbox/x.html');
  });
  it('absolute carrier + SAME home → returned unchanged (no rules needed)', () => {
    const c = `${CARRIER}/home/kundeng/Dropbox/x.html`;
    expect(carrierToFileUrl(c, '/home/kundeng', emptyConfig)).toBe('file:///home/kundeng/Dropbox/x.html');
  });
  it('new encode NEVER produces a `~` carrier (so no peer can strand file://~/)', () => {
    expect(fileUrlToCarrier('file:///Users/kundeng/Dropbox/x.html', null, emptyConfig)).not.toContain('#~');
    expect(fileUrlToCarrier('file:///home/kundeng/Dropbox/x.html', '/home/kundeng', emptyConfig)).not.toContain('#~');
  });
  it('legacy `~` carrier with unknown home → null (opener page), NOT file://~/', () => {
    const legacy = `${CARRIER}~/Dropbox/x.html`;
    expect(carrierToFileUrl(legacy, null, emptyConfig)).toBe(null);
  });
});

describe('bootstrap OS-inference (home not learned yet, cross-OS same user)', () => {
  const CARRIER = `https://${CARRIER_HOST}${CARRIER_PATH}#`;
  const macCarrier = `${CARRIER}/Users/kundeng/Dropbox/book/ch1.html`;
  const linuxCarrier = `${CARRIER}/home/kundeng/Dropbox/book/ch1.html`;
  it('infers this machine\'s home from OS + source username when localHome is null', () => {
    // Mac-origin carrier, opened on a Linux box that has not learned its home:
    expect(carrierToFileUrl(macCarrier, null, emptyConfig, 'linux')).toBe('file:///home/kundeng/Dropbox/book/ch1.html');
    // Linux-origin carrier, opened on a Mac that has not learned its home:
    expect(carrierToFileUrl(linuxCarrier, null, emptyConfig, 'mac')).toBe('file:///Users/kundeng/Dropbox/book/ch1.html');
    // Windows:
    expect(carrierToFileUrl(macCarrier, null, emptyConfig, 'win')).toBe('file:///C:/Users/kundeng/Dropbox/book/ch1.html');
  });
  it('learned localHome always wins over OS inference', () => {
    expect(carrierToFileUrl(macCarrier, '/home/otheruser', emptyConfig, 'linux')).toBe('file:///home/otheruser/Dropbox/book/ch1.html');
  });
  it('same-OS carrier is unchanged even via inference', () => {
    expect(carrierToFileUrl(linuxCarrier, null, emptyConfig, 'linux')).toBe('file:///home/kundeng/Dropbox/book/ch1.html');
  });
  it('no OS + no home → raw absolute path (still valid), never broken', () => {
    expect(carrierToFileUrl(macCarrier, null, emptyConfig, null)).toBe('file:///Users/kundeng/Dropbox/book/ch1.html');
  });
  it('inferLocalHome maps username across OSes', () => {
    expect(inferLocalHome('/Users/alice', 'linux')).toBe('/home/alice');
    expect(inferLocalHome('/home/bob', 'mac')).toBe('/Users/bob');
    expect(inferLocalHome('/C:/Users/carol', 'linux')).toBe('/home/carol');
    expect(inferLocalHome('/Users/dave', null)).toBe(null);
  });
});

describe('shouldCarrier (home OR manual gate)', () => {
  it('true for synced home files even with empty config', () => {
    expect(shouldCarrier('file:///Users/kundeng/Dropbox/x', null, emptyConfig)).toBe(true);
    expect(shouldCarrier('file:///home/kundeng/Dropbox/x', null, emptyConfig)).toBe(true);
  });
  it('false for non-synced home files (Downloads) with no rule', () => {
    expect(shouldCarrier('file:///Users/kundeng/Downloads/x.pdf', null, emptyConfig)).toBe(false);
  });
  it('true for non-home paths that match a manual rule', () => {
    const cfg: PathMappingConfig = { machineId: 'm', rules: [{ canonicalPrefix: '/data', localPrefix: '/mnt/data' }] };
    expect(shouldCarrier('file:///mnt/data/x', null, cfg)).toBe(true);
  });
  it('false for non-file and unmapped', () => {
    expect(shouldCarrier('https://example.com', null, emptyConfig)).toBe(false);
    expect(shouldCarrier('file:///etc/hosts', null, emptyConfig)).toBe(false);
  });
});
