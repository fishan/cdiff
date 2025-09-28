# cdiff - compact diff

A lightweight utility for creating, applying, and inverting compact, single-coordinate diff patches. Designed for scenarios where patch readability and simplicity are crucial, with support for block operations to minimize patch size.

[![NPM Version](https://img.shields.io/npm/v/@fishan/cdiff.svg)](https://www.npmjs.com/package/@fishan/cdiff)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

This library solves the problem of generating and applying text patches. Unlike standard diff formats, `cdiff` uses a simple, line-based  system. This means that each command (`Add` or `Delete`) refers to a line number in the *target* file state, making the patches easy to create and reason about.

### Key Features

* **Simple Format**: Patches are just an array of strings, easy to store (e.g., in JSON) and transfer.
* **Invertible**: Any patch can be inverted to roll back changes.
* **Block Operations**: Automatically groups consecutive additions or deletions into blocks (`A+`, `D+`) to make patches more compact.
* **Strict & Non-Strict Modes**: Choose whether to throw an error on a content mismatch during deletion or to log a warning and continue.
* **Cross-Platform**: Handles `\n` and `\r\n` line endings automatically.
* **Character-Level Diffs**: Automatically generates compact intra-line patches (`d`/`a`) for small changes within a line, reducing patch size and preserving change semantics.
* **Smart Multi-Line Handling**: Detects aligned multi-line replacements and applies character-level diffs per line when beneficial.

## Installation

```bash
npm install @fishan/cdiff
```

## API and Usage

### `createPatch(oldContent, newContent)`

Generates a compact patch by comparing two strings. The result may contain line, block, or character-level commands, depending on what is most efficient.

#### Example 1: Basic Line Replacement
```typescript
import { CdiffService } from 'cdiff';

const oldContent = 'line 1\nold line\nline 3';
const newContent = 'line 1\nnew line\nline 3';

const cdiff = CdiffService.createPatch(oldContent, newContent);
// Result: ['2 D old line', '2 A new line']
console.log(cdiff);
```
#### Example 2: Character-Level Change (Intra-Line)
```typescript
const oldContent = 'const x = 10;';
const newContent = 'const y = 10;';

const cdiff = CdiffService.createPatch(oldContent, newContent);
// Result: ['1 d 6 1 x', '1 a 6 1 y']
// Meaning: delete 'x' at index 6, insert 'y' at index 6
console.log(cdiff);
```
#### Example 3: Multi-Line Block Addition
```typescript
const oldContent = 'start\nend';
const newContent = 'start\nline A\nline B\nline C\nend';

const cdiff = CdiffService.createPatch(oldContent, newContent);
// Result:
// [
//   '2 A+ 3',
//   'line A',
//   'line B',
//   'line C'
// ]
console.log(cdiff);
```
#### Example 4: Aligned Multi-Line Replacement (Character-Level per Line)
```typescript
const oldContent = 'const a = 1;\nconst b = 2;';
const newContent = 'const a = 100;\nconst b = 200;';

const cdiff = CdiffService.createPatch(oldContent, newContent);
// Result (may vary slightly based on diff algorithm):
// [
//   '1 a 11 2 00',
//   '2 a 15 2 00'
// ]
console.log(cdiff);
```
### Direct Character-Level Patching with `CdiffCharService`

You can generate character-level patches **manually** for a single line without involving full-file diffing.

```typescript
import { CdiffCharService } from 'cdiff';

const oldLine = 'function foo() {';
const newLine = 'function bar() {';

const charPatch = CdiffCharService.createPatch(oldLine, newLine, 5); // line 5
// Result: ['5 d 9 3 foo', '5 a 9 3 bar']
console.log(charPatch);

// Apply it directly to a string
const result = CdiffCharService.applyPatch(oldLine, charPatch);
console.log(result); // 'function bar() {'
```

> 💡 Use this when you already know **which line changed** and want maximum control or performance.

---


### `applyPatch(originalContent, cdiff, strictMode?, onWarning?)`

Applies any valid cdiff patch (line, block, or character-level).

```typescript
const original = 'alpha\nbeta\ngamma';
const cdiff = [
  '2 d 0 5 beta', // delete "beta"
  '2 a 0 4 new!'  // insert "new!" at start of line 2
];

const result = CdiffService.applyPatch(original, cdiff);
// Result: 'alpha\nnew!\ngamma'
console.log(result);
```

#### Handling Mismatches with `onWarning`

In non-strict mode (`strictMode: false`), you can capture warnings if a deletion command doesn't match the content. This example demonstrates how to collect and display these warnings.

```typescript
const warnings: string[] = [];

const patchedContent = CdiffService.applyPatch(
    originalFileContent,
    patchCommands,
    false, // non-strict mode
    (message) => {
        warnings.push(message); // Collect all warnings into an array
    }
);

if (warnings.length > 0) {
    // We have both the result and a list of problems that occurred.
    // Now we can show them to the user.
    alert("The patch was applied, but the following issues occurred:\n" + warnings.join('\n'));
}
```

### `invertPatch(cdiff)` + `applyInvertedPatch(...)`

Enables full round-trip patching: **apply → invert → restore**.

```typescript
const old = 'A\nB\nC';
const updated = 'A\nX\nY\nC';

// 1. Create patch
const patch = CdiffService.createPatch(old, updated);

// 2. Apply forward
const result = CdiffService.applyPatch(old, patch);
// result === updated

// 3. Invert patch
const inverted = CdiffService.invertPatch(patch);
// If patch was ['2 D B', '2 A X', '3 A Y'],
// inverted will be ['2 A B', '2 D X', '3 D Y']

// 4. Restore original
const restored = CdiffService.applyInvertedPatch(updated, inverted);
// restored === old
```

> ✅ Works seamlessly with **character-level commands** (`a` ↔ `d`).

---

## Patch Format

The patch is an array of strings, where each string is a command.

* **Single-line Add**: `lineNumber A content`
    * Example: `3 A This is a new line`
* **Single-line Delete**: `lineNumber D content`
    * Example: `5 D This line will be removed`
* **Block Add**:
    * `lineNumber A+ count`
    * `content line 1`
    * `content line 2`
    * ...
* **Block Delete**:
    * `lineNumber D+ count`
    * `content line 1`
    * `content line 2`
    * ...
* **Character-Level Add**: `lineNumber a index length content`
    * Inserts `content` (of `length` characters) at `index` in the line.
    * Example: `2 a 6 1 y` → inserts "y" at position 6 in line 2.
* **Character-Level Delete**: `lineNumber d index length content`
    * Deletes `length` characters starting at `index` from the line. The `content` field is the expected text to delete (for validation).
    * Example: `2 d 6 1 x` → deletes "x" (length 1) at position 6 in line 2.

> 💡 **Note**: Character-level commands (`a`/`d`) are automatically generated by `createPatch` when they produce a smaller patch than full-line replacements.

## Testing

The library is extensively tested to ensure reliability and robustness across various edge cases.

<details>
<summary><strong>Click to view Test Results (78 passing)</strong></summary>

```
  CdiffCharService: Character-level Patching (Comprehensive)
    createPatch: Generation Logic
      ✔ should return an empty array for identical strings
      ✔ should generate a simple addition patch
      ✔ should generate a simple deletion patch
      ✔ should generate a patch that correctly transforms the string
    Whitespace Handling
      ✔ should correctly handle leading/trailing whitespace in content
      ✔ should handle changes involving only whitespace (E2E check)
      ✔ should handle patches for whitespace-only strings
    Robustness and Edge Cases
      ✔ should handle multiple non-contiguous modifications
      ✔ should handle a very long string with a small change
      ✔ should apply patch regardless of command order in array
    End-to-End Lifecycle
      ✔ should handle simple modification
      ✔ should handle additions at the beginning
      ✔ should handle deletions from the end
      ✔ should handle creating a string from empty
      ✔ should handle deleting the entire string
      ✔ should handle complete rewrite (line-level patch)
      ✔ should handle multiple changes (line-level patch)
      ✔ should handle changes with special characters
      ✔ should handle multiple non-contiguous modifications

  CdiffService: Uni-Coordinate Lifecycle
    ✔ [Apply] should add a single line
    ✔ [Apply] should delete a single line
    ✔ [Apply] should handle file creation from empty
    ✔ [Apply] should handle deleting all content
    ✔ [Create] should generate an empty cdiff for identical files
    ✔ [Create] should generate correct A command for addition
    ✔ [Create] should generate correct D command for deletion
    ✔ [Create] should generate correct D and A commands for modification
    ✔ [E2E] should correctly apply a patch it just created
    ✔ [Create+Apply] should handle multiple additions in different positions
    ✔ [Create+Apply] should handle multiple deletions in different positions
    ✔ [Create+Apply] should handle complex modifications (delete, add, replace)
    ✔ [Create+Apply] should handle adding lines at the end
    ✔ [Create+Apply] should handle deleting lines from the beginning
    ✔ [Create+Apply] should handle empty lines correctly
    ✔ [Create+Apply] should handle single-line file modification
    ✔ [Create+Apply] should handle complete deletion of multiple lines
    ✔ [Create+Apply] should handle adding empty lines
    ✔ [Create+Apply] should handle line moves (delete and re-add)
    ✔ [Apply] should handle multiple additions in the middle
    ✔ [Apply] should handle multiple deletions in the middle
    ✔ [Apply] should handle additions at the end
    ✔ [Create] should generate patch for replacement with empty line
    ✔ [Create] should generate patch for moving a line (delete + add elsewhere)
    ✔ [Invert] should correctly invert a complex patch with multiple changes
    ✔ [Create] should generate intra-line patches for aligned multi-line blocks
    ✔ [E2E-Invert] should handle multiple separate blocks of changes
    ✔ [E2E-Invert] should handle changes at the very beginning of the file
    ✔ [E2E-Invert] should handle changes at the very end of the file
    ✔ [E2E-Invert] should handle complete replacement of a block
    ✔ [E2E-Invert] should handle a completely rewritten file
    ✔ [E2E-Invert] should handle deletion of all content
    ✔ [E2E-Invert] should handle creation of a file from empty
    ✔ [E2E-Invert] should correctly handle empty lines in changes
    ✔ [E2E-Invert] should handle aligned multi-line block changes

  CdiffService: Additional Edge Cases and Robustness
    ✔ [Apply] should ignore invalid patch commands
    ✔ [Apply] should handle multiple additions at the same position
    ✔ [Apply] should ignore duplicate deletions at the same position
    ✔ [Create+Apply] should handle large file with multiple changes
    ✔ [Create+Apply] should handle only additions
    ✔ [Create+Apply] should handle only deletions
    ✔ [Create+Apply] should handle lines with spaces and special characters
    ✔ [Apply] should return original content for empty patch
    ✔ [Create+Apply] should handle multiple consecutive replacements
    ✔ [E2E-Invert] should handle patch with out-of-bounds positions
    ✔ [E2E-Invert] should handle trailing newlines
    ✔ [E2E-Invert] should handle single-line file with changes

  CdiffService: Extended Robustness Tests
    ✔ [Apply] should handle chaotic patch command order
    ✔ [Apply] should handle multiple changes at the same line
    ✔ [E2E-Invert] should handle multiple consecutive empty lines
    ✔ [Apply] should ignore deletion with incorrect content
    ✔ [E2E-Invert] should handle very large file with multiple changes

  CdiffService: Whitespace and Special Characters
    ✔ [Create+Apply] should handle exact whitespace in deletions
    ✔ [E2E-Invert] should handle multiple spaces and tabs
    ✔ [Apply] should ignore whitespace mismatch in non-strict mode
    ✔ [Apply] should throw on whitespace mismatch in strict mode

  CdiffService: Advanced Whitespace and Obfuscation
    ✔ [Create+Apply] should handle obfuscated whitespace
    ✔ [E2E-Invert] should handle empty line with mixed whitespace
    ✔ [Create+Apply] should handle whitespace-only line
```

</details>

## Acknowledgements

This project internally uses the [**`diff`**](https://github.com/kpdecker/jsdiff) library (jsdiff) for the core line-by-line comparison logic. The algorithm is based on the paper ["An O(ND) Difference Algorithm and its Variations" (Myers, 1986)](http://www.xmailserver.org/diff2.pdf).

## License

The `cdiff` library is licensed under the **MIT License**.

### Dependency License

The `diff` library, which `cdiff` depends on, is licensed under the **BSD 3-Clause License**. As per its terms, the copyright notice and license text are reproduced below.

```
Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
