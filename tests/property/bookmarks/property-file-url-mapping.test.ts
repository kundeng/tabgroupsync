import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  canonicalize,
  localize,
  isFileUrl,
  isSyncableUrl,
} from '../../../src/lib/utils/pathMapper';
import type { PathMappingConfig } from '../../../src/lib/types/storage';

const arbPathSegment = fc.stringMatching(/^[a-z0-9_.-]{1,12}$/);

const arbPath = fc
  .array(arbPathSegment, { minLength: 1, maxLength: 5 })
  .map(segs => '/' + segs.join('/'));

const arbFileUrl = arbPath.map(p => 'file://' + p);

const arbConfig = fc
  .tuple(arbPath, arbPath)
  .map(([canonical, local]): PathMappingConfig => ({
    machineId: 'test',
    rules: [{ canonicalPrefix: canonical, localPrefix: local }],
  }));

const emptyConfig: PathMappingConfig = { machineId: '', rules: [] };

describe('Property: round-trip invariant', () => {
  it('localize(canonicalize(url, config), config) === url for matching paths', () => {
    fc.assert(
      fc.property(
        arbConfig,
        fc.array(arbPathSegment, { minLength: 1, maxLength: 3 }),
        (config, suffix) => {
          const localPath = config.rules[0].localPrefix + '/' + suffix.join('/');
          const url = 'file://' + localPath;
          const roundTripped = localize(canonicalize(url, config), config);
          expect(roundTripped).toBe(url);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property: canonicalization idempotency', () => {
  it('canonicalize(canonicalize(url, c), c) === canonicalize(url, c)', () => {
    fc.assert(
      fc.property(arbConfig, arbFileUrl, (config, url) => {
        const once = canonicalize(url, config);
        const twice = canonicalize(once, config);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });
});

describe('Property: http(s) passthrough', () => {
  it('canonicalize(httpUrl, anyConfig) === httpUrl', () => {
    const arbHttpUrl = fc.webUrl().filter(u => u.startsWith('http'));
    fc.assert(
      fc.property(arbConfig, arbHttpUrl, (config, url) => {
        expect(canonicalize(url, config)).toBe(url);
        expect(localize(url, config)).toBe(url);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property: no-mapping passthrough', () => {
  it('canonicalize(url, emptyConfig) === url', () => {
    fc.assert(
      fc.property(arbFileUrl, (url) => {
        expect(canonicalize(url, emptyConfig)).toBe(url);
        expect(localize(url, emptyConfig)).toBe(url);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property: isFileUrl and isSyncableUrl consistency', () => {
  it('every file:// URL is syncable', () => {
    fc.assert(
      fc.property(arbFileUrl, (url) => {
        expect(isFileUrl(url)).toBe(true);
        expect(isSyncableUrl(url)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
