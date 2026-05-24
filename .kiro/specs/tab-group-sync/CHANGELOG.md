# Spec Changelog

This document tracks changes to the Tab Group Sync specification.

## [Unreleased] - 2024-XX-XX

### Added - Requirement 15: Group Name Handling

**Motivation**: Property-based testing (Property 9) discovered that groups with whitespace-only titles caused unexpected behavior. This requirement formalizes how the extension handles edge cases in group names.

**Changes**:

#### Requirements Document
- **Added Requirement 15**: Group Name Handling
  - Criterion 15.1: Unnamed groups map to "Unnamed Group"
  - Criterion 15.2: Whitespace-only groups are NOT managed
  - Criterion 15.3: Multiple unnamed groups share single folder
  - Criterion 15.4: Skip whitespace-only groups during sync checks
  - Criterion 15.5: Log when groups are skipped

#### Design Document
- **Added Section**: "Group Name Handling"
  - Defined `resolveGroupName()` utility function
  - Specified behavior for unnamed groups
  - Specified behavior for whitespace-only groups
  - Documented implementation points for SyncEngine, BookmarkManager, StorageManager
  - Added edge case documentation
  - Added logging specifications
  - Added testing considerations

#### Tasks Document
- **Task 1.8**: Implement group name resolution utility
  - Create `resolveGroupName()` function
  - Return "Unnamed Group" for undefined/null/empty
  - Return null for whitespace-only (skip signal)
  - Add comprehensive logging
  - Write unit tests

- **Task 1.9**: Write unit tests for group name resolution
  - Test all edge cases
  - Test whitespace variations

- **Task 4.3**: Integrate group name resolution in BookmarkManager
  - Use `resolveGroupName()` in `ensureGroupFolder()`
  - Handle null return (skip group)
  - Log skipped groups

- **Task 8.2a**: Integrate group name resolution in SyncEngine
  - Use `resolveGroupName()` in event handlers
  - Skip whitespace-only groups
  - Handle "Unnamed Group" mapping

- **Task 8.8a**: Update property test for whitespace-only groups
  - Update Property 9 test
  - Verify whitespace groups are skipped
  - Verify logging

**Impact**:
- **Minimal code change**: Single utility function + integration points
- **Clear behavior**: Whitespace-only groups are explicitly not managed
- **Better UX**: Unnamed groups map to single logical group
- **Testable**: Property tests validate the behavior

**Rationale**:
1. **Simplicity**: Skipping whitespace-only groups is simpler than normalizing
2. **User Intent**: Whitespace-only names are likely accidental
3. **Unnamed Groups**: Treating all unnamed groups as one is intuitive
4. **Minimal Change**: Requires only a utility function and integration

**Testing**:
- Property test discovered the issue
- Unit tests will validate the utility function
- Property test will be updated to verify the fix
- E2E tests will validate real-world behavior

**Documentation**:
- KNOWN_ISSUES.md updated with resolution
- SPEC_UPDATES.md created with workflow guidance
- Design document includes comprehensive implementation guide

---

## Version History

### Initial Version
- Complete specification for Tab Group Sync extension
- 14 requirements covering all core functionality
- 30 correctness properties for property-based testing
- Comprehensive task breakdown with 17 major sections
- Three-tier testing strategy (unit, property, E2E)
