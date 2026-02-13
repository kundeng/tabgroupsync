# Known Issues and Limitations

This document tracks known issues, edge cases, and limitations discovered through property-based testing and real-world usage.

## Group Name Handling

### Issue: Whitespace-Only Group Names
**Status**: ~~Discovered via Property-Based Testing~~ **RESOLVED - Spec Updated**  
**Severity**: Low  
**Discovered**: Property 9 test (Auto-Sync Behavior)  
**Resolution**: Requirement 15 added - whitespace-only groups are not managed

**Description**:
Tab groups with whitespace-only titles (e.g., " " single space) are now explicitly not managed by the extension. This is by design to avoid edge cases and ensure reliable sync behavior.

**Impact**:
- Groups with whitespace-only names will not be synced
- This is intentional and documented behavior
- Edge case that's unlikely in normal usage

**Current Behavior** (After Fix):
- Groups with whitespace-only titles are skipped during sync operations
- No bookmark folders are created for these groups
- Auto-sync does not enable for these groups
- Logging indicates when groups are skipped

**Solution Implemented**:
1. **New Requirement 15**: Group Name Handling
2. **Design Update**: Added "Group Name Handling" section with `resolveGroupName()` utility
3. **Tasks Added**: Implementation tasks for utility and integration
4. **Minimal Code Change**: Simple check for whitespace-only titles

**Implementation**:
```typescript
function resolveGroupName(title: string | undefined): string | null {
  if (!title) return 'Unnamed Group';
  if (title.trim().length === 0) return null; // Skip whitespace-only
  return title;
}
```

**Related Code**:
- `src/lib/utils/groupNameResolver.ts` - Group name resolution utility
- `src/lib/sync/syncEngine.ts` - Integration in event handlers
- `src/lib/bookmarks/bookmarkManager.ts` - Integration in folder operations
- `src/lib/storage/storageManager.ts` - Integration in settings lookup

**Test Coverage**:
- Property test: `tests/property/sync/property-09-auto-sync.test.ts` (to be updated)
- Unit tests: Task 1.9 - test all edge cases
- Counterexample: `{"id":1,"title":" ","color":"grey","windowId":1,"collapsed":false}`

**Documentation**:
- Requirements: Requirement 13 (Group Name Handling)
- Design: "Group Name Handling" section in design.md

---

### Issue: Duplicate Group Names
**Status**: Known Limitation  
**Severity**: Medium

**Description**:
The system uses group names (titles) as primary identifiers. Two tab groups with the same name will share the same bookmark folder and sync settings.

**Why This Design**:
- Group IDs are local to each browser instance and change across devices/restarts
- Cross-device sync requires stable identifiers
- Bookmark folder names are the natural stable identifier for Chrome's bookmark sync

**Impact**:
- Multiple groups with identical names will sync to the same bookmark folder
- Sync settings apply to all groups with the same name
- Last-write-wins for bookmark folder content

**Current Behavior**:
- Groups are identified by their title property
- Fallback to "Unnamed Group" for groups without titles
- No deduplication or conflict detection

**Potential Solutions**:
1. **Append suffix**: Add numeric suffix for duplicate names (e.g., "Work (2)")
2. **User warning**: Detect and warn users about duplicate names
3. **Hybrid identifier**: Combine name with other stable properties (color, window)

**Workaround**:
Users should ensure tab groups have unique names to avoid conflicts.

**Related Code**:
- `src/lib/storage/storageManager.ts` - Uses name as key
- `src/lib/bookmarks/bookmarkManager.ts` - Uses name for folder lookup
- `src/lib/sync/syncEngine.ts` - Uses name throughout

---

## Storage and Sync

### Limitation: Chrome Storage Quota
**Status**: Known Limitation  
**Severity**: Low

**Description**:
Chrome sync storage has a quota limit (100KB total, 8KB per item). Large numbers of tab groups or very long URLs may approach these limits.

**Current Mitigation**:
- Only essential data is stored
- History limited to last 50 entries
- Only user-modified preferences are saved
- Atomic storage operations

**Monitoring**:
- Storage usage is not currently tracked
- No user-facing quota warnings

**Potential Enhancements**:
1. Add storage usage monitoring
2. Warn users approaching quota limits
3. Implement more aggressive cleanup strategies
4. Compress stored data

---

## Testing Discoveries

### Property-Based Testing Insights

Property-based testing has been valuable for discovering edge cases:

1. **Whitespace handling**: Discovered groups with unusual names
2. **Empty states**: Tested with zero tabs, empty titles
3. **Boundary conditions**: Large numbers of tabs, long URLs
4. **Concurrent operations**: Multiple rapid state changes

**Test Coverage** (see spec NF 1 for requirements):
- 30 correctness properties implemented (fast-check)
- 281+ unit/property tests (Vitest)
- 10 E2E test files (Playwright)
- 100+ iterations per property test
- Randomized input generation with shrinking to minimal counterexamples

---

## Future Considerations

### Areas for Investigation

1. **Group name normalization**: Should we normalize/sanitize group names?
2. **Conflict detection**: Should we detect and warn about duplicate names?
3. **Storage optimization**: Can we reduce storage footprint further?
4. **Sync conflict resolution**: How to handle simultaneous edits across devices?

### Enhancement Opportunities

1. **Better fallback names**: More descriptive than "Unnamed Group"
2. **User education**: In-app guidance about naming best practices
3. **Validation**: Proactive validation of group names
4. **Monitoring**: Storage usage and sync health metrics

---

## Contributing

If you discover new issues or edge cases:

1. Document the issue in this file
2. Add property-based tests to verify the behavior
3. Propose solutions or workarounds
4. Update related documentation

## References

- [Spec: requirements.md](.kiro/specs/tab-group-sync/requirements.md) — system of record
- [Spec: design.md](.kiro/specs/tab-group-sync/design.md)
- [Property Tests](tests/property/)
- [Property Coverage](tests/property/PROPERTY_COVERAGE.md)
