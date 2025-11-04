# @fishan/cdiff

[![NPM Version](https://img.shields.io/npm/v/@fishan/cdiff.svg?style=flat)](https://www.npmjs.com/package/@fishan/cdiff)
[![Build Status](https://img.shields.io/github/actions/workflow/status/fishan/cdiff/ci.yml?branch=main)](https://github.com/fishan/cdiff/actions)
[![License](https://img.shields.io/npm/l/@fishan/cdiff.svg)](./LICENSE)

**A robust library for creating, applying, and inverting compact, single-coordinate diff patches. Features advanced options including char-level operations, patch compression, and configurable safety levels ('unsafe' mode).**

This tool is designed for maximum efficiency, generating highly optimized, invertible (or one-way) patches suitable for any text or binary data.

---

## Table of Contents

- [Key Features](#key-features)
- [Core Engine: `@fishan/myers-core-diff`](#core-engine--fishanmyers-core-diff)
- [Benchmarks](#benchmarks)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Advanced Usage & Examples](#advanced-usage--examples)
  - [Example 1: Patch Compression](#example-1-patch-compression)
  - [Example 2: "Unsafe" Deletions (One-Way Patch)](#example-2-unsafe-deletions-one-way-patch)
  - [Example 3: Binary Mode](#example-3-binary-mode)
  - [Example 4: Using a Different Core Strategy](#example-4-using-a-different-core-strategy)
- [Patch Format](#patch-format)
  - [Line-Level Commands (A/D/X/E)](#line-level-commands-adxe)
  - [Character-Level Commands (a/d/x/e)](#character-level-commands-adxe)
  - [Compressed Format (`~`)](#compressed-format-)
- [API Reference](#api-reference)
  - [`CdiffService.createPatch(...)`](#cdiffservicecreatepatch)
  - [`CdiffService.applyPatch(...)`](#cdiffserviceapplypatch)
  - [`CdiffService.invertPatch(...)`](#cdiffserviceinvertpatch)
  - [`CdiffService.applyInvertedPatch(...)`](#cdiffserviceapplyinvertedpatch)
- [Options Reference](#options-reference)
  - [`CdiffOptions`](#cdiffoptions)
  - [`ApplyOptions`](#applyoptions)
- [Test Suite](#test-suite)
- [License](#license)

---

## Key Features

* **Compact Single-Coordinate Patches**: Generates easy-to-parse patches (`A`, `D`) that don't rely on complex headers or hunk ranges.
* **Character-Level Precision**: Automatically optimizes line changes into fine-grained character operations (`a`, `d`, `e`) and groups them for maximum efficiency (`a*`, `d*`).
* **Built-in Patch Compression**: A hybrid (String/Char Deduplication + Seed/Extend/Mask) algorithm can be enabled (`compress: true`) to drastically reduce patch size, replacing common fragments with `@variables`.
* **"Unsafe" Deletions**: Supports `deletionStrategy: 'unsafe'` to generate `X`/`x` commands (which omit deleted content), creating minimal-sized "one-way" patches perfect for software updates.
* **Fully Invertible**: "Safe" patches (the default) are 100% invertible, allowing you to move both forward (A -> B) and backward (B -> A).
* **Pluggable Core Engine**: Leverages `@fishan/myers-core-diff`, allowing you to *change the underlying diff algorithm* (e.g., `patienceDiff`, `preserveStructure`) via options.
* **Configurable Validation**: Built-in validation (`validationLevel`) to ensure patch integrity during creation.
* **Binary Mode**: Capable of diffing binary content (`mode: 'binary'`) by treating files as base64-encoded character streams.

---

## Core Engine: `@fishan/myers-core-diff`

`cdiff` v2.0.0 is powered by the **`@fishan/myers-core-diff`** engine.

* **GitHub:** [https://github.com/fishan/myers-core-diff](https://github.com/fishan/myers-core-diff)
* **NPM:** `npm install @fishan/myers-core-diff`

This core engine is responsible for the high performance and precision of `cdiff`. It tokenizes sequences into integers and uses highly optimized algorithms (like Myers O(ND), Patience, etc.) to find the diff.

`cdiff` acts as the high-level orchestrator that:
1. Passes text lines to the core engine.
2. Receives a list of changes.
3. Optimizes those changes into `A+`, `D+`, `a*`, `d*`, etc.
4. Applies compression and unsafe strategies.
5. Handles patch application and inversion.

You can control which algorithm the core uses by passing the `diffStrategyName` option to `createPatch`.

---

## Benchmarks

The key metric is **Patch Size (B)**, where `cdiff v2` (especially with compression and unsafe settings) consistently produces the smallest patches (🥇).

The benchmarks also highlight the stability of `v2`: the legacy `cdiff v1` (which used `jsdiff` as its core) failed (`❌ FAILED`) on complex scenarios like **Block Move**, **Whitespace Change**, **Binary Data**, and **Swapped Blocks**. `cdiff v2` (powered by `@fishan/myers-core-diff`) handles all scenarios correctly.

`cdiff v2 (Unsafe+Compress)` represents the "Software Update" use-case, generating the smallest possible one-way patch.

<details>
<summary><b>View All Benchmark Tables</b></summary>

### Standard Benchmarks

**Realistic change in small (package source code)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 63 | '3.17' | '1.42' | '4.59' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 50 | '7.76' | '3.56' | '11.32' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 42 | '1.22' | '0.20' | '1.42 🥇' | '✅ OK' |
| 'jsdiff (unified)' | 259 | '1.81' | '1.81' | '3.62' | '✅ OK' |
| 'diff-match-patch' | 62 | '3.56' | '1.16' | '4.71' | '✅ OK' |

**Realistic change in medium (source code)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy) 🥇' | 20 | '6.70' | '0.47' | '7.18' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 26 | '0.94' | '0.25' | '1.19' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress)' | 26 | '1.77' | '0.49' | '2.26' | '✅ OK' |
| 'jsdiff (unified)' | 401 | '4.52' | '0.62' | '5.14' | '✅ OK' |
| 'diff-match-patch' | 54 | '0.32' | '0.03' | '0.35 🥇' | '✅ OK' |

**Realistic change in large (source code)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy) 🥇' | 33 | '229.35' | '5.01' | '234.36' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 41 | '18.46' | '4.37' | '22.83' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress)' | 41 | '13.73' | '6.62' | '20.35' | '✅ OK' |
| 'jsdiff (unified)' | 197 | '164.27' | '2.61' | '166.88' | '✅ OK' |
| 'diff-match-patch' | 59 | '0.43' | '0.35' | '0.78 🥇' | '✅ OK' |

### Advanced Scenarios

**Multiple Small Changes (large file)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 1258 | '196.21' | '5.78' | '201.99' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 855 | '70.14' | '4.36' | '74.49' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 833 | '33.67' | '7.29' | '40.95 🥇' | '✅ OK' |
| 'jsdiff (unified)' | 16942 | '168.95' | '6.91' | '175.86' | '✅ OK' |
| 'diff-match-patch' | 3473 | '63.30' | '9.52' | '72.82' | '✅ OK' |

**Block Move (structural shift in large.js)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 2848 | '198.68' | '9.42' | '208.10' | '❌ FAILED' |
| 'cdiff v2 (Safe+Compress) 🥇' | 1830 | '35.59' | '5.35' | '40.94' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 1366 | '50.85' | '4.26' | '55.11' | '✅ OK' |
| 'jsdiff (unified)' | 2938 | '174.30' | '2.85' | '177.15' | '✅ OK' |
| 'diff-match-patch' | 3229 | '2.18' | '0.42' | '2.59 🥇' | '✅ OK' |

**Whitespace Change (indentation in medium.js)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 10038 | '14.88' | '0.71' | '15.59 🥇' | '❌ FAILED' |
| 'cdiff v2 (Safe+Compress) 🥇 🥇' | 989 | '8.22' | '10.38' | '18.60' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 989 | '16.40' | '2.16' | '18.56' | '✅ OK' |
| 'jsdiff (unified)' | 10834 | '14.12' | '3.10' | '17.22' | '✅ OK' |
| 'diff-match-patch' | 7500 | '75.77' | '1.40' | '77.17' | '✅ OK' |

### Inversion Benchmarks (Refactoring Scenario)

**Invert Patch from Refactoring**
| Library | Invert+Apply (ms) | Correctness |
| :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | '5.79' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇 🥇' | '5.31' | '✅ OK' |
| 'jsdiff (unified)' | '170.03' | '✅ OK' |
| 'diff-match-patch' | '52.29' | '✅ OK' |

### Core Strength Benchmarks

**Huge File (50k lines)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 357 | '5513.01' | '287.15' | '5800.16' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 281 | '137.03' | '31.51' | '168.55' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 122 | '163.22' | '30.86' | '194.08' | '✅ OK' |
| 'jsdiff (unified)' | 2222 | '2375.74' | '9.58' | '2385.32' | '✅ OK' |
| 'diff-match-patch' | 470 | '26.30' | '13.74' | '40.04 🥇' | '✅ OK' |

**Binary Data (1KB)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 55 | '0.81' | '0.13' | '0.94' | '❌ FAILED' |
| 'cdiff v2 (Safe+Compress) 🥇' | 57 | '0.80' | '0.75' | '1.55' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 47 | '0.99' | '0.34' | '1.33' | '✅ OK' |
| 'jsdiff (unified)' | 1672 | '1.12' | '1.10' | '2.22' | '✅ OK' |
| 'diff-match-patch' | 296 | '0.23' | '0.05' | '0.29 🥇' | '✅ OK' |

**"Dirty" Data (Large common prefix/suffix)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 41 | '66.67' | '0.21' | '66.87' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 47 | '0.49' | '0.23' | '0.72' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 38 | '0.41' | '0.18' | '0.59' | '✅ OK' |
| 'jsdiff (unified)' | 100206 | '66.00' | '34.02' | '100.02' | '✅ OK' |
| 'diff-match-patch' | 58 | '0.15' | '0.03' | '0.18 🥇' | '✅ OK' |

### Edge Case & Stress Test Scenarios

**Low Entropy (Repeating Data)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 358 | '311.99' | '2.81' | '314.80' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 105 | '14.98' | '1.61' | '16.59' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 92 | '12.19' | '1.62' | '13.81 🥇' | '✅ OK' |
| 'jsdiff (unified)' | 1972 | '279.14' | '1.67' | '280.81' | '✅ OK' |
| 'diff-match-patch' | 330 | '68.85' | '1.23' | '70.08' | '✅ OK' |

**Single Line Changes (Minified JS)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 907 | '147.11' | '23.71' | '170.82' | '✅ OK' |
| 'cdiff v2 (Safe+Compress) 🥇' | 474 | '180.14' | '26.24' | '206.38' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 454 | '213.40' | '10.78' | '224.18' | '✅ OK' |
| 'jsdiff (unified)' | 336055 | '86.33' | '83.61' | '169.94' | '✅ OK' |
| 'diff-match-patch' | 3331 | '58.27' | '6.36' | '64.64 🥇' | '✅ OK' |

**Complete Replacement (Low Similarity)**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 339379 | '279.65' | '2.62' | '282.27' | '❌ FAILED' |
| 'cdiff v2 (Safe+Compress) 🥇' | 299375 | '1305.26' | '30.92' | '1336.18' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 5870 | '37.87' | '10.09' | '47.96 🥇' | '✅ OK' |
| 'jsdiff (unified)' | 301830 | '264.96' | '87.62' | '352.58' | '✅ OK' |
| 'diff-match-patch' | 379704 | '1037.44' | '0.38' | '1037.82' | '✅ OK' |

**Complete Replacement Invert (Low Similarity)**
| Library | Invert+Apply (ms) | Correctness |
| :--- | :--- | :--- |
| 'cdiff v1 (Legacy) 🥇' | '1.48' | '❌ FAILED' |
| 'cdiff v2 (Safe+Compress) 🥇' | '18.38' | '✅ OK' |
| 'jsdiff (unified)' | '1051.41' | '✅ OK' |
| 'diff-match-patch' | '1001.34' | '✅ OK' |

**Swapped Blocks**
| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 'cdiff v1 (Legacy)' | 6791 | '182.92' | '3.09' | '186.01' | '❌ FAILED' |
| 'cdiff v2 (Safe+Compress) 🥇' | 4487 | '26.09' | '4.46' | '30.55' | '✅ OK' |
| 'cdiff v2 (Unsafe+Compress) 🥇' | 3273 | '14.66' | '3.62' | '18.28 🥇' | '✅ OK' |
| 'jsdiff (unified)' | 6346 | '172.66' | '4.99' | '177.66' | '✅ OK' |
| 'diff-match-patch' | 7552 | '273.08' | '26.76' | '299.84' | '✅ OK' |

</details>

---

## Installation

```bash
npm install @fishan/cdiff
```

Note: `cdiff` v2 requires `@fishan/myers-core-diff` as a peer dependency, which will be installed automatically.

---

## Basic Usage

The API is straightforward: `createPatch`, `applyPatch`, and `invertPatch`.

```typescript
import { CdiffService } from '@fishan/cdiff';

const oldContent = 'line 1\nold line 2\nline 3';
const newContent = 'line 1\nnew line 2\nline 3';

// 1. Create a "safe" (default) patch
// This patch is invertible
const patch = CdiffService.createPatch(oldContent, newContent);

console.log(patch);
// Output: [ '2 d 4 3 old', '2 a 4 3 new' ]

// 2. Apply the patch
const patchedContent = CdiffService.applyPatch(oldContent, patch, { strictMode: true });
console.log(patchedContent === newContent); // true

// 3. Invert the patch
const invertedPatch = CdiffService.invertPatch(patch);
console.log(invertedPatch);
// Output: [ '2 a 4 3 old', '2 d 4 3 new' ]

// 4. Apply the inverted patch to the new content to get the old one back
const restoredContent = CdiffService.applyInvertedPatch(newContent, invertedPatch, { strictMode: true });
console.log(restoredContent === oldContent); // true
```

---

## Advanced Usage & Examples

### Example 1: Patch Compression

Enable compression to significantly reduce patch size. This is ideal for network transfer.

<details>
<summary><b>View Code</b></summary>

```typescript
import { CdiffService } from '@fishan/cdiff';

const oldContent = 'const val = "Hello World";\nconsole.log("Hello World");';
const newContent = 'const val = "Hello User";\nconsole.log("Hello User");';

// Enable compression
const patch = CdiffService.createPatch(oldContent, newContent, {
  compress: true
});

console.log(patch);
// Output:
// [
//   '~',
//   '@0 Hello ',
//   '@1 World',
//   '@2 User',
//   '$',
//   '1 d 12 6 @0@1',
//   '1 a 12 6 @0@2',
//   '2 d 12 6 @0@1',
//   '2 a 12 6 @0@2'
// ]
//
// The patch is 100% self-contained and decompressed automatically
// by applyPatch.
const patchedContent = CdiffService.applyPatch(oldContent, patch);
console.log(patchedContent === newContent); // true
```

</details>

### Example 2: "Unsafe" Deletions (One-Way Patch)

Create a minimal-sized patch for software updates where inversion is not needed. This generates `X`/`X+` commands that *do not* store the deleted content.

<details>
<summary><b>View Code</b></summary>

```typescript
import { CdiffService } from '@fishan/cdiff';

// Old content has a block of 4 lines
const oldContent = 'line 1\n/* START BLOCK */\nline 2\nline 3\n/* END BLOCK */\nline 4';
// New content has that block removed
const newContent = 'line 1\nline 4';

// Use 'unsafe' strategy
const patch = CdiffService.createPatch(oldContent, newContent, {
  deletionStrategy: 'unsafe'
});

console.log(patch);
// Output: [ '2 X+ 4' ]
//
// Note: It generated 'X+' (unsafe block delete) instead of 'D+'
// and 4 content lines, saving space. This patch is not invertible.

// This patch is NOT invertible
try {
  CdiffService.invertPatch(patch);
} catch (e) {
  console.log(e.message); // "Cannot invert patch: It contains 'X'/'x' (unsafe delete) commands."
}
```

</details>

### Example 3: Binary Mode

`cdiff` can handle binary files (like images or executables) by treating them as `latin1` strings and base64-encoding their content within the patch.

<details>
<summary><b>View Code</b></summary>

```typescript
import { CdiffService } from '@fishan/cdiff';
import * as fs from 'fs';

// Load raw buffers
const oldBuffer = fs.readFileSync('old_file.bin');
const newBuffer = fs.readFileSync('new_file.bin');

// Convert buffers to 'latin1' strings for diffing
const oldContent = oldBuffer.toString('latin1');
const newContent = newBuffer.toString('latin1');

const patch = CdiffService.createPatch(oldContent, newContent, {
  mode: 'binary',
  compress: true // Compression is highly recommended for binary
});

// `applyPatch` also needs the 'binary' flag
const patchedContent = CdiffService.applyPatch(oldContent, patch, { mode: 'binary' });

// Convert back to buffer to verify
const patchedBuffer = Buffer.from(patchedContent, 'latin1');
console.log(Buffer.compare(newBuffer, patchedBuffer) === 0); // true
```

</details>

### Example 4: Using a Different Core Strategy

You can change the diff algorithm by specifying `diffStrategyName`. This requires installing and registering the strategy from `@fishan/myers-core-diff`.

<details>
<summary><b>View Code</b></summary>

```typescript
// --- In your main setup file (e.g., index.ts) ---
import { MyersCoreDiff, registerPatienceDiffStrategy } from '@fishan/myers-core-diff';
// Register the 'patienceDiff' plugin globally
registerPatienceDiffStrategy(MyersCoreDiff);


// --- In your application code ---
import { CdiffService } from '@fishan/cdiff';

const oldCode = 'if (a) {\n  b();\n}\nc();';
const newCode = 'c();\nif (a) {\n  b();\n}'; // Block move

// Use 'patienceDiff' which is good at detecting block moves
const patch = CdiffService.createPatch(oldCode, newCode, {
  diffStrategyName: 'patienceDiff'
});

console.log(patch);
// Output: [ '1 D+ 3', 'if (a) {', '  b();', '}', '2 A+ 3', 'if (a) {', '  b();', '}' ]
```

</details>

---

## Patch Format

A `cdiff` patch is an array of string commands.

### Line-Level Commands (A/D/X/E)

* `{NewLineNum} A {Content}`: **Add** line.
* `{OldLineNum} D {Content}`: **Delete** line (Safe).
* `{OldLineNum} X`: **Delete** line (Unsafe, content omitted).
* `{LineNum} A+ {Count}`: **Add Block**. The next `{Count}` lines are content to be added.
* `{LineNum} D+ {Count}`: **Delete Block** (Safe). The next `{Count}` lines are the content to be deleted.
* `{LineNum} X+ {Count}`: **Delete Block** (Unsafe). No content lines follow.
* `{NewLineNum} E+ {Count}`: **Equal Block** (Context). The next `{Count}` lines are context lines.
  * *Generated when `includeEqualMode` is set to `'inline'` or `'context'`.*

### Character-Level Commands (a/d/x/e)

* `{LineNum} a {pos} {len} {content} ...`: **Add** char(s) at `{pos}`.
* `{LineNum} d {pos} {len} {content} ...`: **Delete** char(s) at `{pos}` (Safe).
* `{LineNum} x {pos} {len} ...`: **Delete** char(s) at `{pos}` (Unsafe).
* `{LineNum} e {pos} {len} {content} ...`: **Equal** char(s) at `{pos}` (Context/Validation).
  * *Generated when `includeCharEquals: true` (or implicitly by `includeEqualMode: 'context'`).*
* `{Range} a* {pos} {len} {content}`: **Group Add**. Apply this `a` operation to all lines in `{Range}` (e.g., `1,3-5`).
* `{Range} d* {pos} {len} {content}`: **Group Delete** (Safe).
* `{Range} x* {pos} {len}`: **Group Delete** (Unsafe).

### Compressed Format (`~`)

If a patch is compressed, it will have the following structure:

1. `~`: The compression flag (always the first line).
2. `@variable {content}`: Zero or more variable definitions.
3. `$`: The definitions separator.
4. (Compressed Commands): The patch commands (A, D, a, d, etc.) where content has been replaced by `@variables` and line/char numbers are Base58-encoded.

---

## API Reference

### `CdiffService.createPatch(...)`

```typescript
public static createPatch(
  oldContent: string | undefined,
  newContent: string | undefined,
  options?: CdiffOptions
): string[]
```

Compares two strings and generates a compact `cdiff` patch.

### `CdiffService.applyPatch(...)`

```typescript
public static applyPatch(
  originalContent: string,
  cdiff: string[],
  options?: ApplyOptions
): string
```

Applies a `cdiff` patch to the `originalContent` to produce the `newContent`. Automatically handles decompression if the `~` flag is present.

### `CdiffService.invertPatch(...)`

```typescript
public static invertPatch(
  cdiff: string[],
  options?: CdiffOptions
): string[]
```

Inverts a "safe" patch (A<->D, a<->d). Throws an error if the patch contains "unsafe" `X`/`x` commands. Automatically handles decompression.

### `CdiffService.applyInvertedPatch(...)`

```typescript
public static applyInvertedPatch(
  newContent: string,
  invertedCdiff: string[],
  options?: Omit<ApplyOptions, 'inverting'>
): string
```

A convenience wrapper that applies an `invertedCdiff` to the `newContent` to restore the `originalContent`.

---

## Options Reference

### `CdiffOptions`

Options for `CdiffService.createPatch`.

<details>
<summary><b>View All Create Options</b></summary>

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | `'text'` \| `'binary'` | `'text'` | Treats content as lines (`text`) or a single block (`binary`). |
| `debug` | `boolean` | `false` | Enables verbose console logging during patch creation. |
| `compress` | `boolean` | `false` | If `true`, enables the built-in hybrid compression. |
| `diffStrategyName` | `string` | `'commonSES'` | Name of the registered strategy from `@fishan/myers-core-diff` (e.g., `patienceDiff`). |
| `includeEqualMode` | `'none'` \| `'inline'` \| `'separate'` \| `'context'` | `'none'` | Strategy for including `EQUAL` (context) blocks. |
| `includeCharEquals` | `boolean` | `false` | If `true`, generates `e` (char-level equal) commands for validation. |
| `includeContextLines` | `number` | `0` | Number of context lines to include (used with `includeEqualMode: 'context'`). |
| `deletionStrategy` | `'safe'` \| `'unsafe'` \| `function` | `'safe'` | How to handle deleted content. `'unsafe'` creates `X`/`x` commands. |
| `validationLevel` | `'none'` \| `'raw'` \| `'final'` \| ... | `'none'` | Enables validation steps during patch creation. `debug: true` defaults this to `'all-invert'`. |

</details>

### `ApplyOptions`

Options for `CdiffService.applyPatch` and `CdiffService.applyInvertedPatch`.

<details>
<summary><b>View All Apply Options</b></summary>

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `strictMode` | `boolean` | `false` | If `true`, throws an error on content mismatch (e.g., 'D' command fails). If `false`, logs a warning. |
| `onWarning` | `(message: string) => void` | `undefined` | Callback to receive warnings when `strictMode: false`. |
| `debug` | `boolean` | `false` | Enables verbose console logging during patch application. |
| `mode` | `'text'` \| `'binary'` | `'text'` | Must match the `mode` used during patch creation. |
| `includeCharEquals` | `boolean` | `false` | If `true`, validates `e` (char-level equal) commands. |
| `inverting` | `boolean` | `false` | **@internal** Used by `applyInvertedPatch` to change apply logic. |

</details>

---

## Test Suite

`cdiff` is validated by a comprehensive suite of **182 tests** covering patch creation, application, inversion, compression, and edge cases for both text and binary modes.

### How to Run Tests

1. **Development Mode (Fastest)**:
   Runs tests directly on `.ts` files using `ts-node`.

   ```bash
   npm run test:dev
   ```

2. **Build Mode (Uncompressed JS)**:
   Compiles to JavaScript, then tests the uncompressed `dist/src/cdiff.js`.

   ```bash
   npm run test:build
   ```

3. **Production Mode (Minified JS)**:
   Builds, minifies, and tests the final `cdiff.min.js` file to ensure production integrity.

   ```bash
   npm run test:prod
   ```

<details>
<summary><strong>Click to view Test Results (182 passing)</strong></summary>

```
  CdiffService.createPatch - mode: 'binary' (Unit Tests)
    ✅ should create a 'd' and 'a' patch (replacement)
    ✅ should create a 'd' patch (deletion)
    ✅ should create an 'a' patch (addition)
    ✅ should create an 'x' patch (unsafe deletion)
    ✅ should include 'e' commands (includeCharEquals: true)

  CdiffService.createPatch - mode: 'binary' (E2E Lifecycle)
    ✅ should correctly patch when compress=true
    ✅ should correctly patch with includeEqualMode='context'
    ✅ should correctly patch with includeEqualMode='inline'
    ✅ should correctly patch with includeEqualMode='separate'
    ✅ should pass 'all-invert' validation (for a 'safe' patch)
    ✅ should pass 'all-invert' validation (for an 'unsafe' patch)

  CdiffService.invertPatch - mode: 'binary'
    ✅ should successfully invert a 'safe' binary patch
    ✅ should FAIL to invert an 'unsafe' binary patch

  CdiffCharService: Character-level Patching (Comprehensive)
    createPatch: Generation Logic
      ✅ should return an empty array for identical strings
      ✅ should generate a simple addition patch
      ✅ should generate a simple deletion patch
      ✅ should generate a patch that correctly transforms the string
    createPatch: Grouping Logic
      ✅ should NOT merge distant changes separated by a long EQUAL block
      ✅ should merge close changes separated by a short EQUAL block (<= 4 chars)
      ✅ should handle a single continuous change correctly
      ✅ should merge changes where separators are single chars
    Whitespace Handling
      ✅ should correctly handle leading/trailing whitespace in content
      ✅ should handle changes involving only whitespace (E2E check)
      ✅ should handle patches for whitespace-only strings
    Robustness and Edge Cases
      ✅ should handle multiple non-contiguous modifications
      ✅ should handle a very long string with a small change
      ✅ should apply patch regardless of command order in array
    End-to-End Lifecycle
      ✅ should handle simple modification
      ✅ should handle additions at the beginning
      ✅ should handle deletions from the end
      ✅ should handle creating a string from empty
      ✅ should handle deleting the entire string
      ✅ should handle complete rewrite (line-level patch)
      ✅ should handle multiple changes (line-level patch)
      ✅ should handle changes with special characters
      ✅ should handle multiple non-contiguous modifications
      ✅ E2E: should correctly patch and invert MERGED changes
      ✅ E2E: should correctly patch and invert SEPARATE changes
      ✅ E2E: should correctly handle complex real-world case with merging
    Direct Test: CdiffCharService.groupChanges
      ✅ should group a simple replacement
      ✅ should merge changes around a short EQUAL block
      ✅ should NOT merge changes around a long EQUAL block
      ✅ should correctly calculate indices with multiple groups

  CdiffCompressService: End-to-End Compression Cycle (v17.3)
    ✅ [E2E] should return an empty array for an empty patch
    ✅ [E2E] should not create definitions for a patch with no profitable repetitions
    String Commands (v16+ Logic)
      ✅ [String v16 E2E] should compress and decompress repeated A+ blocks
      ✅ [String v16 E2E] should compress and decompress repeated D+ blocks
      ✅ [String v16 E2E] should compress and decompress repeated single A/D lines
      ✅ [String v16 E2E] should handle parametric (d #...@...#...) decompression with gaps
      ✅ [String v16 E2E] should handle simple (a @...) decompression (v7.2 format)
    Char Commands (v2 Logic)
      ✅ [Char v2 E2E] should compress and decompress repeated char insertions (a)
      ✅ [Char v2 E2E] should compress and decompress repeated char deletions (d)
      ✅ [Char v2 E2E] should correctly decompress (a index_B58@var) format
      ✅ [Char v2 E2E] should correctly decompress (d index_B58@var) format
      ✅ [Char v2 E2E] should compress and decompress a* or d* commands (v11.0 logic)
    Hybrid Compression (v5 + v2)
      ✅ [Hybrid E2E] should correctly compress/decompress mixed commands
      ✅ [Hybrid E2E] should correctly prioritize and merge templates
    Regression Tests (v11.8+)
      ✅ [Regression v11.8.1] should handle JSDoc @param bug
      ✅ [Regression v11.8.1] should handle literal @ and # in content
      ✅ [JSDoc Fail v11.8.15] should reproduce @return bug correctly now
      ✅ [JSDoc Fail v11.8.15] should reproduce @param bug correctly now
      ✅ [BugFix E2E v12+] should correctly handle D+ block with empty string
      ✅ [BugFix E2E v12+] should correctly handle A+ block with empty string
    Decompressor Standalone (v11.8+)
      ✅ [isCompressed v11.8.0] should return true only for patches with COMPRESSION_FLAG
      ✅ [isCompressed v11.8.0] should return false for uncompressed or empty patches
    CdiffService.createPatch: Hybrid Option Interactions (v18.0)

--- [START RAW (D/d) VALIDATION] ---
Patch application (RAW (D/d)) matches new content (Forward): true
Patch application (RAW (D/d)) matches old content (Backward): true
--- [END RAW (D/d) VALIDATION] ---


--- [START FINAL (X/x) VALIDATION] ---
Patch application (FINAL (X/x)) matches new content (Forward): true
[FINAL (X/x) VALIDATION] Backward (Invert) check skipped for 'unsafe' patch (expected behavior).
--- [END FINAL (X/x) VALIDATION] ---


--- [START COMPRESSED VALIDATION] ---
Patch application (COMPRESSED) matches new content (Forward): true
--- [END COMPRESSED VALIDATION] ---

      ✅ [Hybrid E2E] compress + unsafe + inline + validation

--- [START RAW (D/d) VALIDATION] ---
Patch application (RAW (D/d)) matches new content (Forward): true
Patch application (RAW (D/d)) matches old content (Backward): true
--- [END RAW (D/d) VALIDATION] ---


--- [START FINAL (D/d) VALIDATION] ---
Patch application (FINAL (D/d)) matches new content (Forward): true
Patch application (FINAL (D/d)) matches old content (Backward): true
--- [END FINAL (D/d) VALIDATION] ---


--- [START COMPRESSED VALIDATION] ---
Patch application (COMPRESSED) matches new content (Forward): true
Patch application (COMPRESSED) matches old content (Backward): true
--- [END COMPRESSED VALIDATION] ---

      ✅ [Hybrid E2E] compress + safe + context + validation
      ✅ [Hybrid E2E] compress + unsafe + separate

  CdiffService.createPatch - deletionStrategy
    ✅ should use 'safe' (D) deletion by default
    ✅ should use 'safe' (D) deletion when specified
    ✅ should use 'unsafe' (X) deletion when specified
    ✅ should use 'unsafe' (x) for char-level deletion
    ✅ should use functional deletion strategy

  CdiffService.createPatch - includeEqualMode
    ✅ should use 'none' (default) - no E+ blocks
    ✅ should use 'inline' - E+ blocks with new coordinates
    ✅ should use 'separate' - E+ blocks with dual coordinates
    ✅ should use 'context' (includeContextLines: 1)

  CdiffService.createPatch - includeCharEquals
    ✅ should NOT include 'e' commands by default
    ✅ should include 'e' commands when includeCharEquals=true
    ✅ should include 'e' commands when includeEqualMode='context'

  CdiffService: Uni-Coordinate Lifecycle
    ✅ [Apply] should add a single line
    ✅ [Apply] should delete a single line
    ✅ [Apply] should handle file creation from empty
    ✅ [Apply] should handle deleting all content
    ✅ [Create] should generate an empty cdiff for identical files
    ✅ [Create] should generate correct A command for addition
    ✅ [Create] should generate correct D command for deletion
    ✅ [Create] should generate correct d and a commands for modification
    ✅ [E2E] should correctly apply a patch it just created
    ✅ [Create+Apply] should handle multiple additions in different positions
    ✅ [Create+Apply] should handle multiple deletions in different positions
    ✅ [Create+Apply] should handle complex modifications (delete, add, replace)
    ✅ [Create+Apply] should handle adding lines at the end
    ✅ [Create+Apply] should handle deleting lines from the beginning
    ✅ [Create+Apply] should handle empty lines correctly
    ✅ [Create+Apply] should handle single-line file modification
    ✅ [Create+Apply] should handle complete deletion of multiple lines
    ✅ [Create+Apply] should handle adding empty lines
    ✅ [Create+Apply] should handle line moves (delete and re-add)
    ✅ [Apply] should handle multiple additions in the middle
    ✅ [Apply] should handle multiple deletions in the middle
    ✅ [Apply] should handle additions at the end
    ✅ [Create] should generate patch for replacement with empty line
    ✅ [Create] should generate patch for moving a line (delete + add elsewhere)
    ✅ [Invert] should correctly invert a complex patch with multiple changes
    ✅ [Create] should generate intra-line patches for aligned multi-line blocks
    ✅ [E2E-Invert] should handle multiple separate blocks of changes
    ✅ [E2E-Invert] should handle changes at the very beginning of the file
    ✅ [E2E-Invert] should handle changes at the very end of the file
    ✅ [E2E-Invert] should handle complete replacement of a block
    ✅ [E2E-Invert] should handle a completely rewritten file
    ✅ [E2E-Invert] should handle deletion of all content
    ✅ [E2E-Invert] should handle creation of a file from empty
    ✅ [E2E-Invert] should correctly handle empty lines in changes
    ✅ [E2E-Invert] should handle aligned multi-line block changes

  CdiffService: Additional Edge Cases and Robustness
[CdiffService] Invalid line number 4 for unsafe deletion (file has 3 lines). Deletion ignored.
    ✅ [Apply] should ignore invalid patch commands
    ✅ [Apply] should handle multiple additions at the same position
    ✅ [Apply] should ignore duplicate deletions at the same position
    ✅ [Create+Apply] should handle large file with multiple changes
    ✅ [Create+Apply] should handle only additions
    ✅ [Create+Apply] should handle only deletions
    ✅ [Create+Apply] should handle lines with spaces and special characters
    ✅ [Apply] should return original content for empty patch
    ✅ [Create+Apply] should handle multiple consecutive replacements
[CdiffService] Invalid line number 999 for deletion (file has 3 lines). Deletion ignored.
    ✅ [E2E-Invert] should handle patch with out-of-bounds positions
    ✅ [E2E-Invert] should handle trailing newlines
    ✅ [E2E-Invert] should handle single-line file with changes

  CdiffService: Extended Robustness Tests
    ✅ [Apply] should handle chaotic patch command order
    ✅ [Apply] should handle multiple changes at the same line
    ✅ [E2E-Invert] should handle multiple consecutive empty lines
[CdiffService] Deletion mismatch for line 2: expected 'wrong content', but actual is 'line 2'. Deletion ignored.
    ✅ [Apply] should ignore deletion with incorrect content
    ✅ [E2E-Invert] should handle very large file with multiple changes

  CdiffService: Whitespace and Special Characters
    ✅ [Create+Apply] should handle exact whitespace in deletions
    ✅ [E2E-Invert] should handle multiple spaces and tabs
[CdiffService] Deletion mismatch for line 2: expected 'spaces', but actual is '  spaces  '. Deletion ignored.
    ✅ [Apply] should ignore whitespace mismatch in non-strict mode
    ✅ [Apply] should throw on whitespace mismatch in strict mode

  CdiffService: Advanced Whitespace and Obfuscation
    ✅ [Create+Apply] should handle obfuscated whitespace
    ✅ [E2E-Invert] should handle empty line with mixed whitespace
    ✅ [Create+Apply] should handle whitespace-only line
    ✅ [Apply] should handle additions after intermediate content is exhausted
    ✅ [Apply] should insert additions at exact positions

  MyersCoreDiff - Swapped Blocks Edge Cases
    ✅ 1. Raw diff from MyersCoreDiff must be valid and reversible
    ✅ 2. _findMiddleSnake must not return invalid snake on swapped blocks
    ✅ 3. calculateDiff must produce valid diff when _recursiveDiff fails
    ✅ 4. Full CdiffService patch must apply correctly on swapped blocks
    ✅ 5. Character-level patch must be valid and reversible

  Direct Test: CdiffCharService Logic
    ✅ applyPatch should handle a simple addition
    ✅ applyPatch should handle a simple deletion
    ✅ DEBUG: should handle multiple non-contiguous modifications
    ✅ applyPatch should handle combined add and delete
    ✅ applyPatch should process multi-part commands correctly
    ✅ invertPatch should correctly swap a and d commands

  Direct Test: CdiffService Logic
    ✅ applyPatch should handle single line addition (A)
    ✅ applyPatch should handle single line deletion (D)
    ✅ applyPatch should handle block addition (A+)
    ✅ applyPatch should handle block deletion (D+)
    ✅ applyPatch should handle grouped character addition (a*)
    ✅ applyPatch should handle grouped character deletion (d*)
    ✅ applyPatch should correctly process a mix of commands
    ✅ invertPatch should correctly swap A/D, A+/D+, and a*/d* commands

  Direct Test: CdiffService Create & E2E Lifecycle
    ✅ createPatch should generate block commands (A+) for large additions
    ✅ createPatch should generate block commands (D+) for large deletions
    ✅ createPatch should choose char-level diff for efficient changes
    ✅ createPatch should generate grouped commands (a*) for indentation changes
    ✅ E2E Lifecycle: createPatch -> applyPatch should work for a simple change
    ✅ E2E Lifecycle: createPatch -> applyPatch should work for complex changes
    ✅ E2E Inversion Lifecycle: create -> invert -> applyInverted should restore original

  Direct Test: CdiffService Internal Helpers
    compressLineNumbers
      ✅ should handle an empty array
      ✅ should handle a single number
      ✅ should handle consecutive numbers
      ✅ should handle non-consecutive numbers
      ✅ should handle a mix of consecutive and non-consecutive numbers
      ✅ should handle unsorted input
    deconstructCharCommand
      ✅ should deconstruct a single-op command
      ✅ should deconstruct a multi-op command
      ✅ should handle an empty command
      ✅ should handle content with spaces

    ✅ E2E Inversion Lifecycle: should correctly handle a simple block swap
    ✅ should generate a correct patch for a simple block swap
    ✅ should generate a correct patch for a simple chars swap
    ✅ should generate a correct patch for a block move
    ✅ should handle a mix of replacements and pure additions/deletions
```

</details>

---

## License

The `cdiff` library is licensed under the **MIT License**.

### Dependency License

`@fishan/myers-core-diff` is distributed under the **MIT** license.

<details>
<summary>View License Text (MIT)</summary>

```text
MIT License

Copyright (c) 2025 Aleks Fishan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>