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