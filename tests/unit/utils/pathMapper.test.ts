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
    expect(c).toBe(`https://${CARRIER_HOST}/open#/Users/foo/Dropbox/book/ch1.html`);
    expect(isCarrierUrl(c)).toBe(true);
  });

  it('decodes a carrier back to the original file:// URL', () => {
    const c = `https://${CARRIER_HOST}/open#/Users/foo/Dropbox/book/ch1.html`;
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
    expect(isCarrierUrl(`https://${CARRIER_HOST}/open#/x`)).toBe(true);
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
