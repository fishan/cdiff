/**
 * @license
 * Copyright (c) 2025, Internal Implementation
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
    MyersCoreDiff,
    DiffOperation,
    type DiffResult
} from '@fishan/myers-core-diff';

// Used to tree-shake debug logs during minification
const __DEV__ = false;

/**
 * A specialized utility for creating, applying, and inverting character-level diffs for single strings.
 *
 * This service generates and processes compact intra-line patches using:
 * - 'd' (safe delete)
 * - 'x' (unsafe delete)
 * - 'a' (add)
 * - 'e' (equals, for validation)
 *
 * It supports both text and binary (Base64-encoded) content modes.
 * @version 2.0.0
 */
export class CdiffCharService {

    /**
     * Compares two strings and generates a pure character-level cdiff patch.
     *
     * The patch consists of 'd' (safe delete), 'x' (unsafe delete), and 'a' (add) commands,
     * formatted for a specific line number.
     * In 'binary' mode, the content of changes is Base64-encoded.
     *
     * @param oldLine - The original string (source).
     * @param newLine - The new string (target).
     * @param lineNumber - The line number for which the patch is being generated.
     * @param options - Configuration options for patch generation.
     * @param {boolean} [options.debug=false] - Enables verbose logging to the console.
     * @param {'text' | 'binary'} [options.mode='text'] - Specifies the content mode. 'binary' encodes/decodes content as Base64.
     * @param {boolean} [options.includeCharEquals=false] - If true, generates 'e' (equals) commands for validation during 'applyPatch'.
     * @param {'safe' | 'unsafe' | ((content: string, lineNum: number) => 'safe' | 'unsafe')} [options.deletionStrategy='safe'] -
     * Determines deletion command type:
     * - 'safe': (Default) Generates 'd' commands with full content for validation.
     * - 'unsafe': Generates 'x' commands with only index and length (faster, smaller patch, no validation).
     * - function: A callback to dynamically decide the strategy per deletion.
     * @returns An array of strings representing the character-level patch, or an empty array if strings are identical.
     *
     * @example <caption>Text mode change</caption>
     * const patch = CdiffCharService.createPatch("const x = 1;", "const y = 10;", 5);
     * // patch is ['5 d 6 1 x', '5 a 6 1 y 11 1 0']
     *
     * @example <caption>Binary mode change (conceptual)</caption>
     * // Represents changing one byte in a binary string
     * const oldBinary = String.fromCharCode(0x01, 0x02, 0x03);
     * const newBinary = String.fromCharCode(0x01, 0xFF, 0x03);
     * const patch = CdiffCharService.createPatch(oldBinary, newBinary, 1, { mode: 'binary' });
     * // patch might be ['1 d 1 1 Ag==', '1 a 1 1 /w=='] (Base64 for 0x02 and 0xFF)
     *
     * @example <caption>Unsafe deletion</caption>
     * const patch = CdiffCharService.createPatch("delete this", "new", 1, { deletionStrategy: 'unsafe' });
     * // patch might be ['1 x 0 11', '1 a 0 3 new']
     */
    public static createPatch(
        oldLine: string | undefined,
        newLine: string | undefined,
        lineNumber: number,
        options?: {
            debug?: boolean,
            mode?: 'text' | 'binary',
            includeCharEquals?: boolean,
            deletionStrategy?: 'safe' | 'unsafe' | ((content: string, lineNum: number) => 'safe' | 'unsafe');
        }
    ): string[] {
        const debug = options?.debug ?? false;
        const mode = options?.mode ?? 'text';
        const includeEquals = options?.includeCharEquals ?? false;
        const deletionStrategy = options?.deletionStrategy ?? 'safe';
        if (__DEV__ && debug) console.log(`[CdiffCharService.createPatch] Starting for line ${lineNumber} (mode: ${mode})`);

        oldLine = oldLine ?? '';
        newLine = newLine ?? '';

        if (oldLine === newLine) {
            if (includeEquals && oldLine.length > 0) {
                const content = oldLine;
                const encodedContent = (mode === 'binary') ? Buffer.from(content, 'latin1').toString('base64') : content;
                const length = (mode === 'binary') ? encodedContent.length : content.length;
                if (__DEV__ && debug) console.log(`[CdiffCharService.createPatch] Lines identical, generating 'e' command.`);
                return [`${lineNumber} e 0 ${length} ${encodedContent}`];
            }
            return [];
        }

        const myersDiff = new MyersCoreDiff();
        const changes: DiffResult[] = myersDiff.diff(
            Array.from(oldLine),
            Array.from(newLine),
            debug
        );

        const { additions, deletions, equals } = this.groupChanges(changes, includeEquals, debug);

        const charPatch: string[] = [];

        const getDecision = (content: string, lineNum: number): 'safe' | 'unsafe' => {
            if (deletionStrategy === 'unsafe') return 'unsafe';
            if (deletionStrategy === 'safe') return 'safe'; // Explicitly handle 'safe'
            try {
                // Call the strategy callback function
                return deletionStrategy(content, lineNum);
            } catch (e) {
                if (__DEV__ && debug) console.error(`[CdiffCharService.createPatch] Strategy function failed: ${e}. Defaulting to 'safe'.`);
                return 'safe';
            }
        };

        if (deletions.length > 0) {
            const safeDelParts: string[] = [];
            const unsafeDelParts: string[] = [];

            deletions.forEach(d => {
                const content = d.content;
                const binaryLength = content.length;

                const decision = getDecision(content, lineNumber);

                if (decision === 'unsafe') {
                    unsafeDelParts.push(`${d.index} ${binaryLength}`);
                } else {
                    if (mode === 'binary') {
                        const encodedContent = Buffer.from(content, 'latin1').toString('base64');
                        safeDelParts.push(`${d.index} ${encodedContent.length} ${encodedContent}`);
                    } else {
                        safeDelParts.push(`${d.index} ${binaryLength} ${content}`);
                    }
                }
            });

            if (safeDelParts.length > 0) {
                charPatch.push(`${lineNumber} d ${safeDelParts.join(' ')}`);
            }
            if (unsafeDelParts.length > 0) {
                charPatch.push(`${lineNumber} x ${unsafeDelParts.join(' ')}`);
            }
        }

        if (additions.length > 0) {
            const addParts = additions.map(a => {
                const content = a.content;
                if (mode === 'binary') {
                    const encodedContent = Buffer.from(content, 'latin1').toString('base64');
                    return `${a.index} ${encodedContent.length} ${encodedContent}`;
                } else {
                    return `${a.index} ${content.length} ${content}`;
                }
            }).join(' ');

            charPatch.push(`${lineNumber} a ${addParts}`);
        }
        if (includeEquals && equals.length > 0) {
            const eqParts = equals.map(e => {
                const content = e.content;
                const encodedContent = (mode === 'binary') ? Buffer.from(content, 'latin1').toString('base64') : content;
                const length = (mode === 'binary') ? encodedContent.length : content.length;
                return `${e.index} ${length} ${encodedContent}`;
            }).join(' ');
            charPatch.push(`${lineNumber} e ${eqParts}`);
        }

        if (__DEV__ && debug && charPatch.length > 0) {
            console.log(`[CdiffCharService.createPatch] Generated patch:`, charPatch);
        }

        return charPatch;
    }

    /**
     * Applies a character-level cdiff patch to a single string.
     *
     * The process involves:
     * 1. Validating and applying 'd' (safe delete) commands.
     * 2. Applying 'x' (unsafe delete) commands.
     * 3. Inserting 'a' (add) commands into the resulting string.
     * 4. (Optional) Validating 'e' (equals) commands against the final string.
     *
     * In 'binary' mode, patch content is treated as Base64 and decoded before application.
     *
     * @param originalLine - The source string to which the patch will be applied.
     * @param patch - An array of strings representing the 'd', 'x', 'a', and 'e' patch commands for a single line.
     * @param options - Configuration options for patch application.
     * @param {(message: string) => void} [options.onWarning] - Callback function for non-fatal warnings (e.g., content mismatch in 'd').
     * @param {boolean} [options.debug=false] - Enables verbose logging to the console.
     * @param {'text' | 'binary'} [options.mode='text'] - Specifies the content mode. 'binary' decodes content from Base64.
     * @param {boolean} [options.includeCharEquals=false] - If true, enables the validation of 'e' (equals) commands.
     * @param {boolean} [options.strictMode=false] - If true, throws an Error on mismatch or decoding failure instead of issuing a warning.
     * @returns The string after applying the patch.
     * @throws {Error} Throws an error if `strictMode` is true and a validation (d, e) or decoding error occurs.
     *
     * @example <caption>Applying a text patch</caption>
     * const original = "cat";
     * const patch = ["1 d 1 1 a", "1 a 1 1 o"];
     * const result = CdiffCharService.applyPatch(original, patch);
     * // result is "cot"
     *
     * @example <caption>Applying a binary patch (conceptual)</caption>
     * const originalBinary = String.fromCharCode(0x01);
     * const patch = ["1 a 1 1 Ag=="]; // Ag== is Base64 for 0x02
     * const result = CdiffCharService.applyPatch(originalBinary, patch, { mode: 'binary' });
     * // result is String.fromCharCode(0x01, 0x02)
     */
    public static applyPatch(
        originalLine: string,
        patch: string[],
        options?: { onWarning?: (message: string) => void, debug?: boolean, mode?: 'text' | 'binary', includeCharEquals?: boolean, strictMode?: boolean }
    ): string {
        const debug = options?.debug ?? false;
        const mode = options?.mode ?? 'text';
        const onWarning = options?.onWarning;
        const includeEquals = options?.includeCharEquals ?? false;
        const strictMode = options?.strictMode ?? false;

        if (__DEV__ && debug) console.log(`[CdiffCharService.applyPatch] Applying patch (mode: ${mode}) to: "${originalLine}"`);

        const lineDelCmd = patch.find(cmd => /^\d+\s+D\s/.test(cmd));
        const lineAddCmd = patch.find(cmd => /^\d+\s+A\s/.test(cmd));

        if (lineDelCmd || lineAddCmd) {
            if (lineDelCmd) {
                const expectedOld = lineDelCmd.substring(lineDelCmd.indexOf(' D ') + 3);
                if (originalLine !== expectedOld) {
                    const message = `Line-level patch mismatch. Expected "${expectedOld}", found "${originalLine}".`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.warn(message);
                    return originalLine;
                }
            }
            return lineAddCmd ? lineAddCmd.substring(lineAddCmd.indexOf(' A ') + 3) : "";
        }

        const delCommandStr = patch.find(cmd => /^\d+\s+d\s/.test(cmd));
        const addCommandStr = patch.find(cmd => /^\d+\s+a\s/.test(cmd));
        const unsafeDelCommandStr = patch.find(cmd => /^\d+\s+x\s/.test(cmd)); // [v3.0]
        const eqCommandStr = includeEquals ? patch.find(cmd => /^\d+\s+e\s/.test(cmd)) : undefined;

        const deletions: { index: number; length: number; content: string }[] = [];
        const unsafeDeletions: { index: number; length: number }[] = []; // [v3.0]
        const additions = new Map<number, string>();
        const equals: { index: number; length: number; content: string }[] = [];

        if (eqCommandStr) {
            let remainder = eqCommandStr.substring(eqCommandStr.indexOf(' e ') + 3);
            while (remainder.length > 0) {
                const parts = remainder.match(/^(\d+) (\d+)/); // [FIX v3.0] Removed trailing space
                if (!parts) break;

                const index = parseInt(parts[1], 10);
                const length = parseInt(parts[2], 10);
                let headerLength = parts[0].length;

                // Check for space separator before content
                if (remainder.charAt(headerLength) === ' ') {
                    headerLength += 1;
                }

                const contentFromPatch = remainder.substring(headerLength, headerLength + length);

                let decodedContent: string;
                try {
                    decodedContent = (mode === 'binary')
                        ? Buffer.from(contentFromPatch, 'base64').toString('latin1')
                        : contentFromPatch;
                } catch (e) {
                    const message = `[applyPatch] Error decoding base64 content for 'e' at index ${index}: ${(e as Error).message}`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.error(message);
                    remainder = remainder.substring(headerLength + length).trimStart();
                    continue;
                }

                equals.push({ index, length: decodedContent.length, content: decodedContent });
                remainder = remainder.substring(headerLength + length).trimStart();
            }
        }

        if (delCommandStr) {
            let remainder = delCommandStr.substring(delCommandStr.indexOf(' d ') + 3);
            while (remainder.length > 0) {
                const parts = remainder.match(/^(\d+) (\d+)/); // [FIX v3.0] Removed trailing space
                if (!parts) break;

                const index = parseInt(parts[1], 10);
                const length = parseInt(parts[2], 10);
                let headerLength = parts[0].length;

                // Check for space separator before content
                if (remainder.charAt(headerLength) === ' ') {
                    headerLength += 1;
                }

                const contentFromPatch = remainder.substring(headerLength, headerLength + length);

                let decodedContent: string;
                try {
                    decodedContent = (mode === 'binary')
                        ? Buffer.from(contentFromPatch, 'base64').toString('latin1')
                        : contentFromPatch;
                } catch (e) {
                    const message = `[applyPatch] Error decoding base64 content for 'd' at index ${index}: ${(e as Error).message}`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.error(message);
                    remainder = remainder.substring(headerLength + length).trimStart();
                    continue;
                }
                deletions.push({ index, length: decodedContent.length, content: decodedContent });
                remainder = remainder.substring(headerLength + length).trimStart();
            }
        }

        // [v3.0] Parse 'x' (unsafe)
        if (unsafeDelCommandStr) {
            if (__DEV__ && debug) console.log(`[DEBUG] Parsing 'x' command: ${unsafeDelCommandStr}`);
            let remainder = unsafeDelCommandStr.substring(unsafeDelCommandStr.indexOf(' x ') + 3);
            while (remainder.length > 0) {
                const parts = remainder.match(/^(\d+) (\d+)/); // [FIX v3.0] Removed trailing space
                if (!parts) break;

                const index = parseInt(parts[1], 10);
                const length = parseInt(parts[2], 10);

                unsafeDeletions.push({ index, length });
                remainder = remainder.substring(parts[0].length).trimStart();
            }
        }

        if (addCommandStr) {
            let remainder = addCommandStr.substring(addCommandStr.indexOf(' a ') + 3);
            while (remainder.length > 0) {
                const parts = remainder.match(/^(\d+) (\d+)/); // [FIX v3.0] Removed trailing space
                if (!parts) break;

                const index = parseInt(parts[1], 10);
                const length = parseInt(parts[2], 10);
                let headerLength = parts[0].length;

                // Check for space separator before content
                if (remainder.charAt(headerLength) === ' ') {
                    headerLength += 1;
                }

                const contentFromPatch = remainder.substring(headerLength, headerLength + length);

                let decodedContent: string;
                try {
                    decodedContent = (mode === 'binary')
                        ? Buffer.from(contentFromPatch, 'base64').toString('latin1')
                        : contentFromPatch;
                } catch (e) {
                    const message = `[applyPatch] Error decoding base64 content for 'a' at index ${index}: ${(e as Error).message}`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.error(message);
                    remainder = remainder.substring(headerLength + length).trimStart();
                    continue;
                }
                additions.set(index, (additions.get(index) || '') + decodedContent);
                remainder = remainder.substring(headerLength + length).trimStart();
            }
        }

        const deletedIndices = new Set<number>();
        for (const del of deletions) {
            const actualContent = originalLine.substring(del.index, del.index + del.length);
            if (actualContent === del.content) {
                for (let i = 0; i < del.length; i++) {
                    deletedIndices.add(del.index + i);
                }
            } else {
                if (__DEV__ && debug) {
                    console.log(`[DEBUG] Deletion check at index ${del.index}:`);
                    console.log(`  - Expected (from patch): "${del.content}" (length: ${del.content.length})`);
                    console.log(`  - Actual (from file):    "${actualContent}" (length: ${actualContent.length})`);
                }
                const message = `Character deletion mismatch at index ${del.index}.`;
                if (strictMode) throw new Error(message);
                if (onWarning) onWarning(message); else console.warn(message);
            }
        }

        // [v3.0] Apply unsafe deletions (no validation)
        for (const del of unsafeDeletions) {
            if (__DEV__ && debug) console.log(`[DEBUG] Applying unsafe deletion 'x' at index ${del.index}, length ${del.length}`);
            for (let i = 0; i < del.length; i++) {
                deletedIndices.add(del.index + i);
            }
        }

        let intermediateLine = '';
        for (let i = 0; i < originalLine.length; i++) {
            if (!deletedIndices.has(i)) {
                intermediateLine += originalLine[i];
            }
        }

        let finalLine = '';
        let intermediateIndex = 0;
        let finalIndex = 0;

        const sortedAdditions = Array.from(additions.entries()).sort((a, b) => a[0] - b[0]);
        const additionsQueue = new Map(sortedAdditions);

        while (intermediateIndex < intermediateLine.length || additionsQueue.size > 0) {
            if (additionsQueue.has(finalIndex)) {
                const contentToAdd = additionsQueue.get(finalIndex)!;
                finalLine += contentToAdd;
                finalIndex += contentToAdd.length;
                additionsQueue.delete(finalIndex - contentToAdd.length);
            } else {
                if (intermediateIndex < intermediateLine.length) {
                    finalLine += intermediateLine[intermediateIndex];
                    intermediateIndex++;
                    finalIndex++;
                } else {
                    const remaining = Array.from(additionsQueue.entries()).sort((a, b) => a[0] - b[0]);
                    for (const [, content] of remaining) {
                        finalLine += content;
                    }
                    break;
                }
            }
        }
        if (includeEquals && equals.length > 0) {
            if (__DEV__ && debug) console.log(`[DEBUG v1+] Validating ${equals.length} 'e' commands...`);
            let anyEqualFailed = false;
            equals.sort((a, b) => a.index - b.index); // Sort for validation

            for (const eq of equals) {
                if (eq.index < 0 || eq.index + eq.length > finalLine.length) {
                    const message = `Char 'e' validation error: Index ${eq.index}/${eq.length} out of bounds (final len ${finalLine.length}).`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.warn(message);
                    anyEqualFailed = true;
                    if (strictMode) break;
                    continue;
                }
                const actualContent = finalLine.substring(eq.index, eq.index + eq.length);
                if (actualContent !== eq.content) {
                    const message = `Char 'e' validation mismatch at final index ${eq.index}. Expected "${eq.content}", found "${actualContent}".`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.warn(message);
                    anyEqualFailed = true;
                    if (strictMode) break;
                } else if (__DEV__ && debug) {
                    console.log(`[DEBUG v1+] 'e' @ ${eq.index} len ${eq.length} OK.`);
                }
            }
            if (__DEV__ && debug && anyEqualFailed && !strictMode) console.warn("[DEBUG v1+] Some 'e' validations failed.");
        }
        return finalLine;
    }

    /**
     * Inverts a character-level cdiff patch by swapping 'a' and 'd' commands.
     * This allows a patch that transforms string X to Y to be converted into a
     * patch that transforms Y back to X.
     *
     * 'e' (equals) and 'x' (unsafe delete) commands are returned unchanged.
     *
     * @param patch - The patch array to invert, containing 'a' and/or 'd' commands for a single line.
     * @param debug - If true, logs the inversion process to the console.
     * @returns A new patch array that represents the reverse operation.
     *
     * @example
     * const forwardPatch = ['5 d 6 1 x', '5 a 6 1 y'];
     * const invertedPatch = CdiffCharService.invertPatch(forwardPatch);
     * // invertedPatch is ['5 a 6 1 x', '5 d 6 1 y']
     */
    public static invertPatch(
        patch: string[],
        debug: boolean = false
    ): string[] {
        if (__DEV__ && debug) console.log(`[CdiffCharService.invertPatch] Inverting patch:`, patch);

        const inverted = patch.map(command => {
            const firstSpace = command.indexOf(' ');
            const secondSpace = command.indexOf(' ', firstSpace + 1);

            if (firstSpace === -1 || secondSpace === -1) return command;

            const lineNumber = command.substring(0, firstSpace);
            const type = command.substring(firstSpace + 1, secondSpace);
            const rest = command.substring(secondSpace + 1);

            switch (type) {
                case 'a':
                    return `${lineNumber} d ${rest}`;
                case 'd':
                    return `${lineNumber} a ${rest}`;
                case 'e':
                    return command;
                default:
                    // 'x' and other commands fall through here
                    return command;
            }
        });

        if (__DEV__ && debug) console.log(`[CdiffCharService.invertPatch] Inverted result:`, inverted);
        return inverted;
    }

    /**
     * Processes a raw character diff from MyersCoreDiff and groups changes into logical blocks.
     *
     * This method is key to creating compact patches. When `includeEquals` is false,
     * it intelligently merges small, insignificant `EQUAL` sections (up to 4 characters)
     * that are surrounded by changes into the main addition/deletion blocks.
     * This avoids creating fragmented patches for minor, nearby edits.
     *
     * When `includeEquals` is true, it flushes 'EQUAL' blocks as 'e' commands and
     * does not merge them into 'd'/'a' blocks.
     *
     * @param changes - The raw character-level diff result from `MyersCoreDiff`.
     * @param includeEquals - If true, 'EQUAL' operations will be preserved as 'e' commands.
     * @param debug - If true, logs the grouping and flushing process.
     * @returns An object containing structured arrays of additions, deletions, and equals.
     * @internal
     */
    private static groupChanges(changes: DiffResult[], includeEquals: boolean, debug: boolean = false): {
        additions: { index: number; content: string }[],
        deletions: { index: number; content: string }[],
        equals: { index: number; content: string }[]
    } {
        const additions: { index: number; content: string }[] = [];
        const deletions: { index: number; content: string }[] = [];
        const equals: { index: number; content: string }[] = [];

        // Temporary buffers for accumulating changes
        let delBuffer: string[] = [];
        let addBuffer: string[] = [];
        let eqBuffer: string[] = [];

        // Track indices within the line
        let oldCharIndex = 0;
        let intermediateCharIndex = 0;
        let finalCharIndex = 0;

        let grouping = false;
        let equaling = false;

        const flushBuffers = () => {
            if (delBuffer.length > 0) {
                const content = delBuffer.join('');
                deletions.push({ index: oldCharIndex, content });
                oldCharIndex += content.length;
                delBuffer = [];
            }
            if (addBuffer.length > 0) {
                const content = addBuffer.join('');
                additions.push({ index: intermediateCharIndex, content });
                intermediateCharIndex += content.length;
                finalCharIndex += content.length;
                addBuffer = [];
            }
            grouping = false;
        };

        const flushEqBuffer = () => {
            if (eqBuffer.length > 0) {
                const eqContent = eqBuffer.join('');
                const eqLength = eqBuffer.length;
                if (includeEquals) {
                    equals.push({ index: finalCharIndex, content: eqContent });
                    if (__DEV__ && debug) console.log(`[_groupChanges v1+] Flushing equal as 'e' (len=${eqLength}) at final ${finalCharIndex}.`);
                    finalCharIndex += eqLength;
                } else {
                    if (__DEV__ && debug) console.log(`[_groupChanges v1+] Flushing (ignoring) equal block (len=${eqLength}).`);
                }
                oldCharIndex += eqBuffer.length;
                intermediateCharIndex += eqBuffer.length;
                eqBuffer = [];
                equaling = false;
            }
        };

        for (let i = 0; i < changes.length; i++) {
            const [op, ch] = changes[i];

            if (op === DiffOperation.EQUAL) {
                eqBuffer.push(ch);
                equaling = true;

                // If a long unchanged sequence is found, flush any pending changes.
                if (eqBuffer.length > 4 && !includeEquals) {
                    flushBuffers();
                    flushEqBuffer();
                } else if (includeEquals) {
                    flushBuffers();
                }

                continue;
            }

            if (equaling) {
                // If the equal sequence was short and we are already grouping changes,
                // absorb the equal part into the change buffers to create a single larger block.
                if (eqBuffer.length > 0 && eqBuffer.length <= 4 && grouping && !includeEquals) {
                    delBuffer.push(...eqBuffer);
                    addBuffer.push(...eqBuffer);
                    eqBuffer = [];
                    equaling = false;
                } else {
                    flushBuffers();
                    flushEqBuffer();
                }

                if (includeEquals) {
                    // New logic for 'includeEquals' can be added here
                }
            }

            if (op === DiffOperation.REMOVE) {
                delBuffer.push(ch);
            } else if (op === DiffOperation.ADD) {
                addBuffer.push(ch);
            }
            if (!includeEquals) {
                grouping = true;
            }
        }

        flushBuffers();
        flushEqBuffer();

        return { additions, deletions, equals };
    }
}