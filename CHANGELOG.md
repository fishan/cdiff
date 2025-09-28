# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-09-17

### Added

* **Initial Release** of `cdiff`.
* `CdiffService.createPatch()`: Generates a compact, single-coordinate patch from two text inputs.
* `CdiffService.applyPatch()`: Applies a patch to a text file.
    * Supports `strictMode` to handle content mismatches.
    * Supports `onWarning` callback for non-strict mode.
* `CdiffService.invertPatch()`: Inverts a patch to enable rollback operations.
* `CdiffService.applyInvertedPatch()`: A convenience alias for applying an inverted patch.
* Support for single-line (`A`/`D`) and block (`A+`/`D+`) patch commands.
* Optional `debug` parameter in all public methods for detailed logging.

## [1.1.0] - 2025-09-28

### Added
- **Character-level patching**: `createPatch` now generates compact intra-line diffs (`d`/`a` commands) when more efficient than full-line replacements.
- **Multi-line aligned block optimization**: When a block of N lines is replaced by another block of N lines, `cdiff` attempts to generate per-line character patches instead of verbose `D+`/`A+` blocks.
- Full support for applying and inverting character-level patches (`a`/`d` commands).

### Changed
- `CdiffService.createPatch()` now produces significantly smaller patches for typical code modifications (e.g., variable renames, value changes).
- Internal logic refactored to delegate character-level operations to `CdiffCharService`.

### Fixed
- Improved patch inversion accuracy for hybrid (line + character) patches.