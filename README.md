# cdiff

A lightweight utility for creating, applying, and inverting compact, single-coordinate diff patches. Designed for scenarios where patch readability and simplicity are crucial, with support for block operations to minimize patch size.

[![NPM Version](https://img.shields.io/npm/v/@fishan/cdiff.svg)](https://www.npmjs.com/package/@fishan/cdiff)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

This library solves the problem of generating and applying text patches. Unlike standard diff formats, `cdiff` uses a simple, line-based, single-coordinate system. This means that each command (`Add` or `Delete`) refers to a line number in the *target* file state, making the patches easy to create and reason about.

### Key Features

* **Simple Format**: Patches are just an array of strings, easy to store (e.g., in JSON) and transfer.
* **Invertible**: Any patch can be inverted to roll back changes.
* **Block Operations**: Automatically groups consecutive additions or deletions into blocks (`A+`, `D+`) to make patches more compact.
* **Strict & Non-Strict Modes**: Choose whether to throw an error on a content mismatch during deletion or to log a warning and continue.
* **Cross-Platform**: Handles `\n` and `\r\n` line endings automatically.

## Installation

```bash
npm install @fishan/cdiff
```

## API and Usage

### `createPatch(oldContent, newContent)`

Generates a patch array by comparing two strings.

```typescript
import { CdiffService } from 'cdiff';

const oldContent = 'line 1\nold line\nline 3';
const newContent = 'line 1\nnew line\nline 3';

const cdiff = CdiffService.createPatch(oldContent, newContent);
// Result: ['2 D old line', '2 A new line']
console.log(cdiff);
```

### `applyPatch(originalContent, cdiff, strictMode?, onWarning?)`

Applies a patch to an original content string.

```typescript
import { CdiffService } from 'cdiff';

const original = 'line 1\nline 3';
const cdiff = ['2 A line 2'];

const patched = CdiffService.applyPatch(original, cdiff);
// Result: 'line 1\nline 2\nline 3'
console.log(patched);
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

### `invertPatch(cdiff)`

Inverts a patch, swapping `A` with `D` and `A+` with `D+`.

```typescript
import { CdiffService } from 'cdiff';

const cdiff = ['2 D old line', '2 A new line'];
const invertedCdiff = CdiffService.invertPatch(cdiff);

// Result: ['2 A old line', '2 D new line']
console.log(invertedCdiff);
```

### `applyInvertedPatch(...)`

A convenience method, which is an alias for `applyPatch`. It's used to apply an inverted patch to restore the original content.

```typescript
const oldContent = "A\nB\nC";
const newContent = "A\nX\nC";

// Forward
const patch = CdiffService.createPatch(oldContent, newContent);
const result = CdiffService.applyPatch(oldContent, patch);
// result === newContent

// Backward
const invertedPatch = CdiffService.invertPatch(patch);
const restored = CdiffService.applyInvertedPatch(newContent, invertedPatch);
// restored === oldContent
```

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

## Testing

The library is extensively tested to ensure reliability and robustness across various edge cases.

<details>
<summary><strong>Click to view Test Results (57 passing)</strong></summary>

```
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
    ✔ [E2E-Invert] should handle multiple separate blocks of changes
    ✔ [E2E-Invert] should handle changes at the very beginning of the file
    ✔ [E2E-Invert] should handle changes at the very end of the file
    ✔ [E2E-Invert] should handle complete replacement of a block
    ✔ [E2E-Invert] should handle a completely rewritten file
    ✔ [E2E-Invert] should handle deletion of all content
    ✔ [E2E-Invert] should handle creation of a file from empty
    ✔ [E2E-Invert] should correctly handle empty lines in changes

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

This project internally uses the [**`diff`**](https://github.com/kpdecker/jsdiff) library (jsdiff) for the core line-by-line comparison logic. [cite_start]The algorithm is based on the paper ["An O(ND) Difference Algorithm and its Variations" (Myers, 1986)](http://www.xmailserver.org/diff2.pdf)[cite: 2].

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