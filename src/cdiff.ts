/**
 * @file cdiff.ts
 * @description
 * Main service for creating and applying cdiff patches (cdiff v2.0.0).
 * This service orchestrates CdiffCharService, CdiffCompressService,
 * and the underlying MyersCoreDiff logic.
 */

/**
 * @license
 * Copyright (c) 2025, Internal Implementation
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import util from 'util';
import { 
    MyersCoreDiff, 
    DiffOperation, 
    type DiffResult, 
    DiffOptions as MyersDiffOptions,
    registerPatienceDiffStrategy,
    registerPreserveStructureStrategy
} from '@fishan/myers-core-diff';
import { CdiffCharService } from './cdiff_chars.js';
import { CdiffCompressService, type DecompressResult } from './cdiff_compress.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Used to tree-shake debug logs during minification
const __DEV__ = false;

/**
 * Options for creating a cdiff patch.
 */
export type CdiffOptions = {
    /**
     * Specifies the content mode. 
     * 'text' (default): Treats content as lines.
     * 'binary': Treats content as a single binary block. 
     */
    mode?: 'text' | 'binary';
    /**
     * Controls the granularity of the patch generation.
     * - 'lines': Forces line-level blocks (A/D). Ignores char-level optimizations.
     * - 'chars': Forces char-level commands (a/d) where possible.
     * - 'mixed' (default): Automatically picks the smallest representation between lines and chars.
     */
    granularity?: 'lines' | 'chars' | 'mixed';
    /** If true, logs detailed internal processing steps to the console. */
    debug?: boolean;
    /** If true, the generated patch will be compressed to reduce size. */
    compress?: boolean;
    /**
     * If true and compress=true, compares the size of the compressed patch vs uncompressed.
     * Returns the uncompressed version if the compressed one is larger.
     */
    optimal?: boolean;
    /**
     * Specifies the diff strategy to use. Defaults to 'commonSES'. 
     * Available from box: 'commonSES', 'preserveStructure', 'patienceDiff'.
     */
    diffStrategyName?: string;
    /**
     * How to include unchanged blocks (EQUAL). 
     * - 'none' (default): Do not include.
     * - 'inline': Include 'E+' blocks in the main patch.
     * - 'separate': Move 'E+' blocks to a separate section after '$$EQUAL$$'.
     * - 'context': Include 'E+' blocks as context around changes.
     */
    includeEqualMode?: 'none' | 'inline' | 'separate' | 'context';
    /** Whether to include EQUAL operations (e commands) in character-level diffs. Default: false. */
    includeCharEquals?: boolean;
    /** Number of context lines to include around changes in the patch (used with 'context'). Default: 0. */
    includeContextLines?: number;
    /**
     * Specifies the strategy for handling deletion content.
     * - 'safe' (default): Generates 'D'/'d' commands containing the deleted content.
     * - 'unsafe': Generates 'X'/'x' commands, omitting the deleted content for smaller patches.
     * - function: A callback to decide the strategy line-by-line or content-by-content.
     */
    deletionStrategy?: 'safe' | 'unsafe' | ((content: string, lineNum: number) => 'safe' | 'unsafe');
    
    /**
     * Specifies the validation level. 'debug' mode defaults to 'all-invert'.
     * - 'none' (default): No validation (unless debug=true).
     * --- Raw Patch (D/d) ---
     * (Validates *before* deletionStrategy)
     * - 'raw': Forward validation of the 'safe' (D/d) patch.
     * - 'raw-invert': Forward + Backward validation of the 'safe' (D/d) patch.
     * --- Final Patch (X/x) ---
     * (Validates *after* deletionStrategy, *before* compress)
     * - 'final': Forward validation of the final (potentially 'unsafe' X/x) patch.
     * - 'final-invert': Forward + Backward validation of the final patch.
     * --- Compressed Patch ---
     * (Validates *after* compress. Requires `compress=true`)
     * - 'compressed': Decompress + Forward validation.
     * - 'compressed-invert': Decompress + Forward + Backward (if patch is 'safe').
     * --- Combinations ---
     * - 'all': 'raw' + 'final' + 'compressed'.
     * - 'all-invert': 'raw-invert' + 'final-invert' + 'compressed-invert'.
     */
    validationLevel?: 'none' | 
                      'raw' | 'raw-invert' | 
                      'final' | 'final-invert' | 
                      'compressed' | 'compressed-invert' |
                      'all' | 'all-invert';
};

/**
 * Options for applying a cdiff patch.
 */
export type ApplyOptions = {
    /**
     * If true, the function will throw an error on content mismatch (e.g., a 'D' command). 
     * If false (default), it will issue a warning (onWarning) and continue. 
     */
    strictMode?: boolean;
    /** A callback function that receives warning messages in non-strict mode. */
    onWarning?: (message: string) => void;
    /** If true, logs detailed internal processing steps to the console. */
    debug?: boolean;
    /**
     * @internal 
     * Used internally by `applyInvertedPatch` to signal a reverse patch 
     * application (swaps char-patch logic). 
     */
    inverting?: boolean;
    /**
     * Specifies the content mode. 
     * 'text' (default): Treats content as lines.
     * 'binary': Treats content as a single binary block. 
     */
    mode?: 'text' | 'binary';
    /**
     * Passed to CdiffCharService.applyPatch for 'e' command validation. 
     * Default: false. 
     */
    includeCharEquals?: boolean;
};

registerPreserveStructureStrategy(MyersCoreDiff);
registerPatienceDiffStrategy(MyersCoreDiff);

/**
 * A utility for creating and applying compact, self-contained, single-coordinate diff patches.
 * It supports a rich command set for maximum patch compactness:
 * - Single-line commands (`A`, `D`, `X`)
 * - Block commands (`A+`, `D+`, `X+`) for consecutive line changes.
 * - Character-level commands (`a`, `d`, `x`, `e`) for precise intra-line changes.
 * - Grouped character-level commands (`a*`, `d*`, `x*`) that apply a common operation
 * to multiple, potentially non-contiguous lines.
 *
 * The `createPatch` method (cdiff v2.0.0) automatically analyzes changes and chooses the 
 * most efficient command combination to produce the smallest possible patch.
 *
 * @version 2.0.0
 */
export class CdiffService {

    /**
     * Separator used in a patch if 'includeEqualMode' is set to 'separate'.
     * All commands *after* this separator are 'E+' (EQUAL) blocks.
     * All commands *before* it are change commands (A/D/a/d/etc.).
     */
    public static readonly EQUAL_BLOCKS_SEPARATOR = '$$EQUAL$$';

    /**
     * Applies a cdiff patch to an original content string to produce the new content.
     * Supports all command types: `A`, `D`, `X` (single), `A+`, `D+`, `X+` (blocks),
     * `a`, `d`, `x`, `e` (char), and `a*`, `d*`, `x*` (grouped char).
     *
     * The application process is ordered:
     * 1. (If not inverting) Applies character-level changes (`a`, `d`, `x`, `e`, etc.)
     * to modify existing lines.
     * 2. Processes line-level deletions (`D`, `D+`, `X`, `X+`).
     * 3. Inserts line-level additions (`A`, `A+`) into the final structure.
     * 4. (If inverting) Applies character-level changes to the *resulting* lines.
     *
     * @param originalContent - The source content to which the patch will be applied.
     * @param cdiff - An array of strings representing the cdiff patch commands (can be compressed).
     * @param options - Configuration options for applying the patch.
     * @returns The content after applying the patch.
     *
     * @example <caption>Basic line addition</caption>
     * const original = 'line 1\nline 3';
     * const cdiff = ['2 A line 2'];
     * const patched = CdiffService.applyPatch(original, cdiff);
     * // patched is now 'line 1\nline 2\nline 3'
     *
     * @example <caption>Character-level modification</caption>
     * const original = 'const x = 10;';
     * const cdiff = ['1 d 6 1 x', '1 a 6 1 y'];
     * const patched = CdiffService.applyPatch(original, cdiff);
     * // patched is now 'const y = 10;'
     *
     * @example <caption>Grouped character-level modification (indentation)</caption>
     * const original = 'line a\nline b\nline c';
     * // This command adds two spaces of indentation to lines 1 through 3
     * const cdiff = ['1-3 a* 0 2 "  "'];
     * const patched = CdiffService.applyPatch(original, cdiff);
     * // patched is now '  line a\n  line b\n  line c'
     *
     * @example <caption>Block addition</caption>
     * const original = 'start\nend';
     * const cdiff = ['2 A+ 2', 'line A', 'line B'];
     * const patched = CdiffService.applyPatch(original, cdiff);
     * // patched is now 'start\nline A\nline B\nend'
     */
    public static applyPatch(
        originalContent: string,
        cdiff: string[],
        options?: ApplyOptions
    ): string {
        const mode = options?.mode ?? 'text';
        const debug = options?.debug ?? false;
        const strictMode = options?.strictMode ?? false;
        const onWarning = options?.onWarning;
        const inverting = options?.inverting ?? false;
        const includeCharEquals = options?.includeCharEquals ?? false;        

        if (__DEV__ && debug) console.log(`[CdiffService.applyPatch] Starting (mode: ${mode})...`);

        let Patch: string[];
        let sourceMap: Map<number, number>;
        const originalCdiff = cdiff;
        let vars: Map<string, string> | undefined = undefined; // Variables map if decompressed

        if (CdiffCompressService.isCompressed(cdiff)) {
            if (__DEV__ && debug) console.log('[applyPatch] Patch is compressed, decompressing...');
            try {
                const decompressedResult: DecompressResult = CdiffCompressService.decompress(cdiff, debug);
                Patch = decompressedResult.patch; // Deconpressed patch
                sourceMap = decompressedResult.sourceMap; // Store the map
                 if (__DEV__ && debug) console.log('[applyPatch] Decompression successful.');
            } catch (decompError) {
                console.error('[applyPatch] CRITICAL: Decompression failed!', decompError);
                 // Cannot continue if decompression failed
                 throw new Error(`Failed to decompress patch: ${(decompError as Error).message}`);
            }
        } else {
             if (__DEV__ && debug) console.log('[applyPatch] Patch is not compressed.');
            Patch = cdiff;
            sourceMap = new Map(cdiff.map((_, idx) => [idx, idx]));         
        }

        let separateEqualBlocks: string[] = [];
        const separatorIndex = Patch.findIndex(line => line === CdiffService.EQUAL_BLOCKS_SEPARATOR);
        if (separatorIndex !== -1) {
            if (__DEV__ && debug) console.log(`[applyPatch v1+] Found EQUAL_BLOCKS_SEPARATOR. Splitting patch.`);
            separateEqualBlocks = Patch.slice(separatorIndex + 1); // E+ blocks (ignored on apply)
            Patch = Patch.slice(0, separatorIndex); // Main patch (A/D/...)
        }
        if (__DEV__ && debug){
            console.log(
                'Decompressed patch:\n',
                util.inspect(Patch, { maxArrayLength: null, depth: null, colors: true })
            );    
        }
        if (mode === 'binary') {
            return CdiffCharService.applyPatch(originalContent, Patch, { onWarning, debug, mode: 'binary' });
        }

        originalContent = originalContent.replace(/\r\n|\r/g, '\n');
        const sourceLines = originalContent === '' ? [] : originalContent.split('\n');
        const deletions = new Set<number>();
        const additions = new Map<number, string[]>();
        const charMods = new Map<number, string[]>();

        const blockRegex = /^(\d+)\s+([ADX]\+)\s+(\d+)$/;
        const singleLineRegex = /^(\d+)\s+([ADX])\s(.*)$/s;
        const charLineRegex = /^(\d+)\s+([adex])\s(.*)$/s;
        const groupCharLineRegex = /^([\d,-]+)\s+([adx]\*)\s+(.*)$/s;
        const equalBlockRegex = /^(\d+)\s+(E\+)\s+(\d+)$/;

        const parseLineRange = (rangeStr: string): number[] => {
            const numbers = new Set<number>();
            const parts = rangeStr.split(',');
            for (const part of parts) {
                if (part.includes('-')) {
                    const [start, end] = part.split('-').map(Number);
                    for (let i = start; i <= end; i++) {
                        numbers.add(i);
                    }
                } else {
                    numbers.add(Number(part));
                }
            }
            return Array.from(numbers);
        };

        // Parse patch commands
        for (let i = 0; i < Patch.length; i++) {
            const command = Patch[i];
            if (__DEV__ && debug) console.log(`[DEBUG] Parsing command #${i}: ${command}`);
            const blockMatch = command.match(blockRegex);

            const singleLineMatch = !blockMatch ? command.match(singleLineRegex) : null;
            const equalBlockMatch = !blockMatch && !singleLineMatch ? command.match(equalBlockRegex) : null;
            const charLineMatch = !blockMatch && !singleLineMatch && !equalBlockMatch ? command.match(charLineRegex) : null;
            const groupCharLineMatch = !blockMatch && !singleLineMatch && !equalBlockMatch && !charLineMatch ? command.match(groupCharLineRegex) : null;

            if (blockMatch) {
                const [, coordStr, type, countStr] = blockMatch;
                const lineNum = parseInt(coordStr, 10);
                const count = parseInt(countStr, 10);

                if (type === 'X+') {
                    if (__DEV__ && debug) console.log(`[DEBUG] Queuing unsafe block deletion X+ at line ${lineNum} (count ${count})`);
                    for (let j = 0; j < count; j++) {
                        deletions.add(lineNum + j);
                    }
                } else {
                    // This is 'A+' or 'D+'
                    if (i + count >= Patch.length) {
                        const message = `Block command at line ${i + 1} expects ${count} content lines, but EOF reached.`;
                        if (strictMode) { throw new Error(message); }
                        if (onWarning) { onWarning(message); } else { console.warn(message); }
                        i += count; // Attempt to skip forward
                        continue; // Skip processing
                    }

                    const contentBlock = Patch.slice(i + 1, i + 1 + count);
                    i += count; // Manually advance 'i' past the content block

                    if (type === 'A+') {
                        if (!additions.has(lineNum)) {
                            additions.set(lineNum, []);
                        }
                        additions.get(lineNum)!.push(...contentBlock);
                    } else if (type === 'D+') {
                        let mismatch = false;
                        for (let j = 0; j < count; j++) {
                            const currentLineIndex = lineNum + j - 1; // 1-based lineNum to 0-based index

                            const lineFromDecompressedPatch = contentBlock[j];

                            if (currentLineIndex >= sourceLines.length || sourceLines[currentLineIndex] !== lineFromDecompressedPatch) {
                                const errorMessage = `Block deletion mismatch at line ${currentLineIndex + 1}.`;
                                console.error(`\n--- BLOCK DELETION MISMATCH DETAILS ---`);
                                console.error(`Patch Command Index (in decompressed patch): ${i}`);
                                console.error(`Patch Command: ${command} (Processing content line ${j + 1} of ${count})`);
                                console.error(`Expected Source Line Number (1-based): ${lineNum + j}`);
                                console.error(`Source Array Index (0-based): ${currentLineIndex}`);
                                console.error(`Source Array Total Lines: ${sourceLines.length}`);

                                if (currentLineIndex >= sourceLines.length) {
                                    console.error(`Error Type: Index ${currentLineIndex} is out of bounds for sourceLines.`);
                                } else {
                                    console.error(`Error Type: Content mismatch.`);
                                    const expectedContent = lineFromDecompressedPatch; // Line as produced by decompress()
                                    const actualContent = sourceLines[currentLineIndex];
                                    console.error(`Expected Content (from patch line ${i - count + j + 1}, after decompress): "${expectedContent}"`);
                                    console.error(`Actual Content (from source line ${currentLineIndex + 1}): "${actualContent}"`);

                                    const expectedLen = expectedContent.length;
                                    const actualLen = actualContent.length;
                                    console.error(`Lengths: Expected=${expectedLen}, Actual=${actualLen} ${expectedLen === actualLen ? '(Match)' : '(MISMATCH!)'}`);

                                    const minLen = Math.min(expectedLen, actualLen);
                                    let diffPoint = -1;
                                    for(let k=0; k < minLen; k++) {
                                        if (expectedContent[k] !== actualContent[k]) {
                                            diffPoint = k;
                                            break;
                                        }
                                    }
                                    if (diffPoint === -1 && expectedLen !== actualLen) {
                                        diffPoint = minLen; // Difference starts right after the common part
                                    }

                                    if (diffPoint !== -1) {
                                        const expectedChar = diffPoint < expectedLen ? expectedContent[diffPoint] : '[EOF]';
                                        const actualChar = diffPoint < actualLen ? actualContent[diffPoint] : '[EOF]';
                                        const expectedCode = expectedChar !== '[EOF]' ? expectedContent.charCodeAt(diffPoint) : 'N/A';
                                        const actualCode = actualChar !== '[EOF]' ? actualContent.charCodeAt(diffPoint) : 'N/A';
                                        console.error(`First difference at character index: ${diffPoint}`);
                                        console.error(`  Expected Char: '${expectedChar}' (Code: ${expectedCode})`);
                                        console.error(`  Actual Char:   '${actualChar}' (Code: ${actualCode})`);

                                        const context = 5;
                                        const expStart = Math.max(0, diffPoint - context);
                                        const actStart = Math.max(0, diffPoint - context);
                                        const expEnd = Math.min(expectedLen, diffPoint + context + 1);
                                        const actEnd = Math.min(actualLen, diffPoint + context + 1);
                                        console.error(`  Expected Context: ...${JSON.stringify(expectedContent.substring(expStart, diffPoint))}+[${JSON.stringify(expectedChar)}]+${JSON.stringify(expectedContent.substring(diffPoint + 1, expEnd))}...`);
                                        console.error(`  Actual Context:   ...${JSON.stringify(actualContent.substring(actStart, diffPoint))}+[${JSON.stringify(actualChar)}]+${JSON.stringify(actualContent.substring(diffPoint + 1, actEnd))}...`);

                                    } else if (expectedLen === actualLen) {
                                        console.error(`Content seems identical despite mismatch? (Check hidden characters/whitespace)`);
                                        const codesLimit = 15;
                                        const expectedCodes = [];
                                        const actualCodes = [];
                                        for(let k=0; k < Math.min(expectedLen, codesLimit); k++) {
                                            expectedCodes.push(expectedContent.charCodeAt(k));
                                            actualCodes.push(actualContent.charCodeAt(k));
                                        }
                                        console.error(`  First ${codesLimit} Expected Codes: ${expectedCodes.join(', ')}`);
                                        console.error(`  First ${codesLimit} Actual Codes:   ${actualCodes.join(', ')}`);
                                    }

                                    const decompressedContentLineIndex = i - count + 1 + j;
                                    const originalCompressedLineIndex = sourceMap.get(decompressedContentLineIndex);

                                    if (originalCompressedLineIndex !== undefined && originalCompressedLineIndex < originalCdiff.length) {
                                        const originalCompressedLine = originalCdiff[originalCompressedLineIndex];
                                        console.error(`Source Compressed Line (Index ${originalCompressedLineIndex}): "${originalCompressedLine}"`);
                                    } else {
                                        console.error(`(Source compressed line data not found in sourceMap for index ${decompressedContentLineIndex})`);
                                    }
                                }
                                if (__DEV__ && debug){
                                    console.error(`--- END MISMATCH DETAILS ---\n`);
                                }
                                if (strictMode) { throw new Error(errorMessage); } // Throw error AFTER logging
                                if (onWarning) { onWarning(errorMessage); } else { console.warn(errorMessage); }
                                mismatch = true;
                                break; // Stop checking this block on first error
                            }
                        }
                        if (!mismatch) {
                            for (let j = 0; j < count; j++) {
                                deletions.add(lineNum + j);
                            }
                        }
                    }
                }
            } else if (equalBlockMatch) {
                const [, coordStr, type, countStr] = equalBlockMatch;
                const lineNum = parseInt(coordStr, 10);
                const count = parseInt(countStr, 10);

                if (isNaN(lineNum) || lineNum <= 0 || isNaN(count) || count < 0 || i + count >= Patch.length) {
                    const message = `Invalid E+ block command or EOF reached: ${command}`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.warn(message);
                    i += count; // Try to skip content
                    continue;
                }

                if (strictMode) {
                    if (__DEV__ && debug) console.log(`[DEBUG] Validating E+ block at line ${lineNum} (new coord)`);
                    const contentBlock = Patch.slice(i + 1, i + 1 + count);
                    let mismatch = false;
                    if (__DEV__ && debug) console.log(`[DEBUG] Skipping strict validation for inline E+ block (not implemented in apply)`);
                }

                i += count; // Skip header and content lines
                continue; 
            } else if (singleLineMatch) {
                const [, coordStr, type, content] = singleLineMatch;
                const lineNum = parseInt(coordStr, 10);

                if (type === 'D') {
                    const index = lineNum - 1;
                    if (index >= 0 && index < sourceLines.length) {
                        if (sourceLines[index] !== content) {
                            const message = `Deletion mismatch for line ${lineNum}: expected '${content}', but actual is '${sourceLines[index]}'`;
                            if (strictMode) { throw new Error(message); }
                            const warnMsg = message + '. Deletion ignored.';
                            if (onWarning) { onWarning(warnMsg); } else { console.warn(`[CdiffService] ${warnMsg}`); }
                        } else {
                            deletions.add(lineNum);
                        }
                    } else {
                        const message = `Invalid line number ${lineNum} for deletion (file has ${sourceLines.length} lines)`;
                        if (strictMode) { throw new Error(message); }
                        const warnMsg = message + '. Deletion ignored.';
                        if (onWarning) { onWarning(warnMsg); } else { console.warn(`[CdiffService] ${warnMsg}`); }
                    }
                } else if (type === 'A') {
                    if (!additions.has(lineNum)) {
                        additions.set(lineNum, []);
                    }
                    additions.get(lineNum)!.push(content);
                } else if (type === 'X') {
                    const index = lineNum - 1;
                    if (index >= 0 && index < sourceLines.length) {
                        deletions.add(lineNum);
                    } else {
                        const message = `Invalid line number ${lineNum} for unsafe deletion (file has ${sourceLines.length} lines)`;
                        if (strictMode) { throw new Error(message); }
                        const warnMsg = message + '. Deletion ignored.';
                        if (onWarning) { onWarning(warnMsg); } else { console.warn(`[CdiffService] ${warnMsg}`); }
                    }
                }
            } else if (charLineMatch) {
                const lineNum = parseInt(charLineMatch[1], 10);
                if (!charMods.has(lineNum)) {
                    charMods.set(lineNum, []);
                }
                charMods.get(lineNum)!.push(command);
            } else if (groupCharLineMatch) {
                const [, rangeStr, type, rest] = groupCharLineMatch;
                const commandType = type.charAt(0);
                const lineNumbers = parseLineRange(rangeStr);

                for (const lineNum of lineNumbers) {
                    if (!charMods.has(lineNum)) {
                        charMods.set(lineNum, []);
                    }
                    const baseType = (commandType === 'x') ? 'x' : commandType;
                    charMods.get(lineNum)!.push(`${lineNum} ${baseType} ${rest}`);
                }
            }
        }

        // Apply character changes to source lines (if not inverting)
        if (!inverting) {
            for (const [lineNum, charPatch] of charMods.entries()) {
                const lineIndex = lineNum - 1;
                if (lineIndex < 0 || lineIndex >= sourceLines.length) {
                    const message = `Invalid line number ${lineNum} for character patch. Ignoring.`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.warn(message);
                    continue;
                }
                sourceLines[lineIndex] = CdiffCharService.applyPatch(
                    sourceLines[lineIndex],
                    charPatch,
                    { onWarning, debug, mode: 'text', includeCharEquals, strictMode }
                );
            }
        }

        // Create intermediate content after deletions
        const contentLines: string[] = [];
        for (let i = 0; i < sourceLines.length; i++) {
            if (!deletions.has(i + 1)) {
                contentLines.push(sourceLines[i]);
            }
        }

        if (__DEV__ && debug) {
            console.log('\n--- [ASSEMBLY START] ---');
            console.log(`[ASSEMBLY] Total source lines: ${sourceLines.length}`);
            console.log(`[ASSEMBLY] Total deletions queued: ${deletions.size}`);
            console.log(`[ASSEMBLY] Intermediate content lines (after deletions): ${contentLines.length}`);
            console.log(`[ASSEMBLY] Total addition commands: ${additions.size}`);
            console.log(`[ASSEMBLY] Addition commands details:`, additions);
            console.log('---');
        }

        // Main result assembly logic
        const resultLines: string[] = [];
        let contentIndex = 0; // Pointer to current line in intermediate content
        let resultLineNum = 1; // Current line number in result file

        // Sort addition commands by line number
        const sortedAdditions = Array.from(additions.entries())
            .sort((a, b) => a[0] - b[0]);
        let additionIndex = 0;

        while (contentIndex < contentLines.length || additionIndex < sortedAdditions.length) {
            const shouldInsertAddition = additionIndex < sortedAdditions.length &&
                sortedAdditions[additionIndex][0] === resultLineNum;

            if (shouldInsertAddition) {
                const [lineNum, linesToAdd] = sortedAdditions[additionIndex];
                if (__DEV__ && debug) {
                    console.log(`[ACTION] INSERTING ${linesToAdd.length} line(s) at position ${resultLineNum}:`);
                    linesToAdd.forEach((line, idx) => console.log(`       -> "${line}"`));
                }
                resultLines.push(...linesToAdd);
                resultLineNum += linesToAdd.length; // Move result position
                additionIndex++;
            } else if (contentIndex < contentLines.length) {
                const lineToTransfer = contentLines[contentIndex];
                if (__DEV__ && debug) console.log(`[ACTION] TRANSFERRING to position ${resultLineNum}: "${lineToTransfer}"`);
                resultLines.push(lineToTransfer);
                contentIndex++;
                resultLineNum++;
            } else {
                // If only addition commands remain (after all content)
                const [lineNum, linesToAdd] = sortedAdditions[additionIndex];
                if (__DEV__ && debug) {
                    console.log(`[ACTION] APPENDING ${linesToAdd.length} line(s) at position ${resultLineNum}:`);
                    linesToAdd.forEach((line, idx) => console.log(`       -> "${line}"`));
                }
                resultLines.push(...linesToAdd);
                resultLineNum += linesToAdd.length;
                additionIndex++;
            }
        }

        if (__DEV__ && debug) console.log('--- [ASSEMBLY END] ---\n');

        // Apply character changes to result lines (if inverting)
        if (inverting) {
            for (const [lineNum, charPatch] of charMods.entries()) {
                const lineIndex = lineNum - 1;
                if (lineIndex < 0 || lineIndex >= resultLines.length) {
                    const message = `Invalid line number ${lineNum} for character patch. Ignoring.`;
                    if (strictMode) throw new Error(message);
                    if (onWarning) onWarning(message); else console.warn(message);
                    continue;
                }
                resultLines[lineIndex] = CdiffCharService.applyPatch(
                    resultLines[lineIndex],
                    charPatch,
                    { onWarning, debug, mode: 'text', includeCharEquals, strictMode }
                );
            }
        }

        if (__DEV__ && debug) console.log('[CdiffService.applyPatch] Finished.');
        return resultLines.join('\n');
    }

    /**
     * Applies an inverted cdiff patch to the *new* content to revert it to the *original* content.
     * This is the counterpart to `createPatch` and `applyPatch`, allowing for bidirectional transformations.
     * It functions by calling `applyPatch` internally with a special `inverting` flag.
     *
     * @param newContent - The content that was the *result* of a forward patch application.
     * @param invertedCdiff - A cdiff patch that has been inverted using `CdiffService.invertPatch`.
     * @param options - Configuration options, same as `applyPatch` (excluding `inverting`).
     * @returns The original content, before the forward patch was applied.
     *
     * @example
     * const originalContent = 'line 1\nline 3';
     * const newContent = 'line 1\nline 2\nline 3';
     *
     * // Create a forward patch
     * const forwardPatch = CdiffService.createPatch(originalContent, newContent);
     * // forwardPatch is ['2 A line 2']
     *
     * // Invert the patch
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['2 D line 2']
     *
     * // Apply the inverted patch to the new content
     * const revertedContent = CdiffService.applyInvertedPatch(newContent, invertedPatch);
     *
     * // revertedContent is now 'line 1\nline 3', same as originalContent
     */
    public static applyInvertedPatch(
        newContent: string,
        invertedCdiff: string[],
        options?: Omit<ApplyOptions, 'inverting'>
    ): string {
        if (__DEV__ && options?.debug) console.log('[DEBUG] Starting applyInvertedPatch...');

        return CdiffService.applyPatch(newContent, invertedCdiff, {
            ...options,
            inverting: true,
            includeCharEquals: false
        });
    }

    /**
     * Compares two text contents and generates a single-coordinate cdiff patch.
     *
     * The method automatically chooses the most compact representation for each change.
     * It analyzes line-level changes (MyersCoreDiff) and then:
     * 1.  Optimizes block replacements (N lines vs N lines) by comparing
     * the size of block commands (D+/A+) against the size of char-level commands (a/d/e).
     * 2.  Groups repetitive char-level operations (like indentation)
     * into single grouped commands (a* / d*).
     * 3.  Applies the 'deletionStrategy' to convert 'D'/'d' to 'X'/'x' (unsafe).
     * 4.  (Optionally) Compresses the final patch using `CdiffCompressService`.
     *
     * @param oldContent - The original content string (or `undefined`).
     * @param newContent - The new content string (or `undefined`).
     * @param options - Configuration options for creating the patch.
     * @returns An array of strings representing the cdiff patch.
     *
     * @example <caption>Basic line replacement</caption>
     * const oldContent = 'line 1\nold line\nline 3';
     * const newContent = 'line 1\nnew line\nline 3';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch: ['2 D old line', '2 A new line']
     *
     * @example <caption>Optimized character-level change</caption>
     * const oldContent = 'const x = 10;';
     * const newContent = 'const y = 10;';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch: ['1 d 6 1 x', '1 a 6 1 y']
     *
     * @example <caption>Grouped command for indentation change</caption>
     * const oldContent = '{\n"key": "value"\n"foo": "bar"\n}';
     * const newContent = '{\n  "key": "value"\n  "foo": "bar"\n}';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch: ['2-3 a* 0 2 "  "'] (Add 2 spaces at char 0 for lines 2-3)
     */

    public static createPatch(
        oldContent: string | undefined,
        newContent: string | undefined,
        options?: CdiffOptions
    ): string[] {
        const mode = options?.mode ?? 'text';
        const debug = options?.debug ?? false;
        const compress = options?.compress ?? false;
        const strategyName = options?.diffStrategyName ?? 'commonSES';
        const granularity = options?.granularity ?? 'mixed';
        const optimal = options?.optimal ?? false;
        const includeEqualMode = options?.includeEqualMode ?? 'none';
        const includeCharEquals = options?.includeCharEquals ?? false;
        const contextLines = (includeEqualMode === 'context') 
            ? (options?.includeContextLines ?? 3) 
            : 0;
        const finalIncludeCharEquals = (includeCharEquals ?? false) || (includeEqualMode === 'context');
        const deletionStrategy = options?.deletionStrategy ?? 'safe';
        let validationLevel = options?.validationLevel ?? 'none';
        
        if (granularity === 'chars') {
            throw new Error('granularity: "chars" is not yet implemented. Use "lines" or "mixed".');
        }
        if (granularity !== 'lines' && granularity !== 'mixed') {
            throw new Error(`Invalid granularity: "${granularity}". Must be "lines" or "mixed".`);
        }
        if (__DEV__ && debug && validationLevel === 'none') {
            validationLevel = 'all-invert'; // 'debug' mode defaults to 'all-invert'
        }
        if (__DEV__ && debug) console.log(`--- CdiffService.createPatch (mode: ${mode}, validation: ${validationLevel}), granularity: ${granularity}) ---`);


        const oldC = oldContent ?? '';
        const newC = newContent ?? '';

        if (oldC === newC) {
            return [];
        }

        if (mode === 'binary') {
            return CdiffCharService.createPatch(oldC, newC, 1, { 
                debug, 
                mode: 'binary', 
                includeCharEquals: finalIncludeCharEquals,
                deletionStrategy: deletionStrategy 
            });
        }

        const normalizedOld = oldC.replace(/\r\n|\r/g, '\n');
        const normalizedNew = newC.replace(/\r\n|\r/g, '\n');

        if (normalizedOld === normalizedNew) {
            return [];
        }
        const oldLines = normalizedOld === '' ? [] : normalizedOld.split('\n');
        const newLines = normalizedNew === '' ? [] : normalizedNew.split('\n');

        const myers = new MyersCoreDiff();
        const myersOptions: MyersDiffOptions = {
            diffStrategyName: strategyName,
        };
        const lineChanges: DiffResult[] = myers.diff(oldLines, newLines, debug, myersOptions);

        if (__DEV__ && debug) {
            console.log('--- Myers Core Diff Raw Output (Changes Only) ---');
            const changesLog = lineChanges
                .filter(([op]) => op !== DiffOperation.EQUAL)
                .map(([op, val]) => {
                    const opStr = op === DiffOperation.ADD ? 'ADD' : 'REM';
                    return `${opStr} "${val.length > 70 ? val.substring(0, 67) + '...' : val}"`;
                })
                .join('\n');
            console.log(changesLog);
            console.log('---------------------------------------------');
        }

        if (__DEV__ && debug) {
            console.log('\n--- [VALIDATING RAW DIFF] ---');
            let reconstructedOld = '';
            let reconstructedNew = '';
            for (const [op, token] of lineChanges) {
                if (op === DiffOperation.REMOVE || op === DiffOperation.EQUAL) {
                    reconstructedOld += token + '\n';
                }
                if (op === DiffOperation.ADD || op === DiffOperation.EQUAL) {
                    reconstructedNew += token + '\n';
                }
            }
            reconstructedOld = reconstructedOld.slice(0, -1);
            reconstructedNew = reconstructedNew.slice(0, -1);

            console.log('Reconstructed OLD matches input:', reconstructedOld === normalizedOld);
            console.log('Reconstructed NEW matches input:', reconstructedNew === normalizedNew);
            if (reconstructedOld !== normalizedOld || reconstructedNew !== normalizedNew) {
                console.error('❌ RAW DIFF IS INVALID!');
            }
            console.log('--- [END VALIDATION] ---\n');
        }

        interface ChangeBlock {
            removed: string[];
            added: string[];
            isEqualBlock: boolean;
            equalLines?: string[];
        }

        const aggregatedBlocks: ChangeBlock[] = [];
        let currentBlock: ChangeBlock = { removed: [], added: [], isEqualBlock: false };

        for (const [op, line] of lineChanges) {
            if (op === DiffOperation.EQUAL) {
                if (currentBlock.removed.length > 0 || currentBlock.added.length > 0) {
                    aggregatedBlocks.push(currentBlock);
                }
                const lastBlock = aggregatedBlocks[aggregatedBlocks.length - 1];
                if (lastBlock && lastBlock.isEqualBlock) {
                    lastBlock.equalLines!.push(line);
                } else {
                    aggregatedBlocks.push({ removed: [], added: [], isEqualBlock: true, equalLines: [line] });
                }
                currentBlock = { removed: [], added: [], isEqualBlock: false };
            } else if (op === DiffOperation.REMOVE) {
                currentBlock.removed.push(line);
            } else if (op === DiffOperation.ADD) {
                currentBlock.added.push(line);
            }
        }
        if (currentBlock.removed.length > 0 || currentBlock.added.length > 0) {
            aggregatedBlocks.push(currentBlock);
        }
        const equalBlocksSeparate: string[] = [];
        const cdiff: string[] = [];
        let oldLineNum = 0;
        let newLineNum = 0;

        const addedContextLines = new Set<number>();

        for (let i = 0; i < aggregatedBlocks.length; i++) {
            const block = aggregatedBlocks[i];

            if (block.isEqualBlock) {
                const count = block.equalLines!.length;
                const equalLines = block.equalLines!;
                const currentEqualStartOld = oldLineNum + 1;
                const currentEqualStartNew = newLineNum + 1;

                if (includeEqualMode === 'inline') {
                    if (__DEV__ && debug) console.log(`[createPatch v3.0] Processing EQUAL block (inline, count=${count}) at new ${currentEqualStartNew}`);
                    cdiff.push(`${currentEqualStartNew} E+ ${count}`);
                    cdiff.push(...equalLines);
                    for(let j=0; j < count; j++) addedContextLines.add(currentEqualStartNew + j);
                
                } else if (includeEqualMode === 'separate') {
                    if (__DEV__ && debug) console.log(`[createPatch v3.0] Processing EQUAL block (separate, count=${count}) at old ${currentEqualStartOld} / new ${currentEqualStartNew}`);
                    equalBlocksSeparate.push(`${currentEqualStartOld}-${currentEqualStartNew} E+ ${count}`);
                    equalBlocksSeparate.push(...equalLines);
                
                } else if (includeEqualMode === 'context') {
                    if (__DEV__ && debug) console.log(`[createPatch v3.0] Skipping EQUAL block (count=${count}) at new ${currentEqualStartNew} (Context mode)`);
                } else {
                    if (__DEV__ && debug) console.log(`[createPatch v3.0] Skipping EQUAL block (count=${count}) at new ${currentEqualStartNew} (None mode)`);
                }
                
                oldLineNum += count;
                newLineNum += count;
                continue;
            }
            if (includeEqualMode === 'context' && contextLines > 0 && i > 0) {
                const prevBlock = aggregatedBlocks[i-1];
                if (prevBlock.isEqualBlock && prevBlock.equalLines!.length > 0) {
                    const prevEqualLines = prevBlock.equalLines!;
                    const prevBlockCount = prevEqualLines.length;
                    const prevBlockStartNew = (newLineNum - prevBlockCount) + 1;

                    const contextStartIdx = Math.max(0, prevBlockCount - contextLines); // Tail
                    const contextEndIdx = prevBlockCount;
                    
                    const linesToAdd: string[] = [];
                    const lineNumsToAdd: number[] = [];

                    for (let j = contextStartIdx; j < contextEndIdx; j++) {
                        const lineNum = prevBlockStartNew + j;
                        if (!addedContextLines.has(lineNum)) {
                            linesToAdd.push(prevEqualLines[j]);
                            lineNumsToAdd.push(lineNum);
                            addedContextLines.add(lineNum);
                        }
                    }
                    
                    if (linesToAdd.length > 0) {
                        const firstLineNum = lineNumsToAdd[0];
                        if (__DEV__ && debug) console.log(`[createPatch v3.0] Adding HEAD context (${linesToAdd.length} lines) at new line ${firstLineNum}`);
                        cdiff.push(`${firstLineNum} E+ ${linesToAdd.length}`);
                        cdiff.push(...linesToAdd);
                    }
                }
            }

            const removedLines = block.removed;
            const addedLines = block.added;

            if (granularity !== 'lines' && removedLines.length > 0 && addedLines.length > 0 && removedLines.length === addedLines.length) {
                const blockStartLine = oldLineNum + 1;
                const lineCharPatches = new Map<number, string[]>();
                let totalCharPatchLength = 0;
                let charPatchesAreValid = true;

                for (let j = 0; j < removedLines.length; j++) {
                    const lineNum = blockStartLine + j;
                    const charPatch = CdiffCharService.createPatch(removedLines[j], addedLines[j], lineNum, { debug, mode: 'text', includeCharEquals: finalIncludeCharEquals });
                    if (charPatch.length > 0) {
                        const patchedLine = CdiffCharService.applyPatch(removedLines[j], charPatch, { debug, mode: 'text', includeCharEquals: finalIncludeCharEquals });
                        if (patchedLine !== addedLines[j]) {
                            if (__DEV__ && debug) {
                                console.warn(`[CdiffService] Char-patch validation failed for line ${lineNum}. Skipping char optimization.`);
                                console.warn(`  Expected: "${addedLines[j]}"`);
                                console.warn(`  Got:      "${patchedLine}"`);
                            }
                            charPatchesAreValid = false;
                            break;
                        }
                        lineCharPatches.set(lineNum, charPatch);
                        totalCharPatchLength += charPatch.join('\n').length;
                    }
                }

                if (charPatchesAreValid && totalCharPatchLength > 0) {
                    const blockPatchText = [
                        `${blockStartLine} D+ ${removedLines.length}`,
                        ...removedLines,
                        `${newLineNum + 1} A+ ${addedLines.length}`,
                        ...addedLines
                    ].join('\n');
                    if (__DEV__ && debug) {
                        console.log(`Comparing char-patch length (${totalCharPatchLength}) vs block-patch length (${blockPatchText.length}) for block starting at line ${blockStartLine}.`);
                    }
                    if (finalIncludeCharEquals || (totalCharPatchLength < blockPatchText.length)) {
                        if (__DEV__ && debug) console.log(`[Optimization]: Analyzing char-patch for replaced block at line ${blockStartLine}. (Mode: ${includeEqualMode}, Force: ${includeEqualMode != 'none' && finalIncludeCharEquals})`);
                        
                        const opFrequency = new Map<string, number[]>();
                        
                        const residualCommandsByLine = new Map<number, string[]>();

                        for (const [lineNum, commands] of lineCharPatches.entries()) {
                            if (!residualCommandsByLine.has(lineNum)) residualCommandsByLine.set(lineNum, []);
                            
                            for (const cmd of commands) {
                                const type = cmd.split(' ')[1]; // d, a, e
                                
                                if (type === 'a' || type === 'd') {
                                    const deconstructedOps = deconstructCharCommand(cmd);
                                    for (const op of deconstructedOps) {
                                        if (!opFrequency.has(op)) opFrequency.set(op, []);
                                        opFrequency.get(op)!.push(lineNum);
                                    }
                                } else if (type === 'e') {
                                    residualCommandsByLine.get(lineNum)!.push(cmd);
                                }
                            }
                        }

                        const groupedCommands: string[] = [];
                        
                        const processedLines = new Set<number>();

                        for (const [op, lines] of opFrequency.entries()) {
                            if (lines.length > 1) {
                                const lineRange = compressLineNumbers(lines);
                                const [type, ...rest] = op.split(' ');
                                groupedCommands.push(`${lineRange} ${type}* ${rest.join(' ')}`);                                
                                lines.forEach(line => processedLines.add(line));
                            }
                        }
                        
                        for (const [lineNum, commands] of lineCharPatches.entries()) {
                            if (!processedLines.has(lineNum)) {
                                for (const cmd of commands) {
                                    const type = cmd.split(' ')[1];
                                    if (type === 'a' || type === 'd') {
                                        residualCommandsByLine.get(lineNum)!.push(cmd);
                                    }
                                }
                            }
                        }


                        const residualCommands: string[] = [];
                        const sortedResidualLines = Array.from(residualCommandsByLine.keys()).sort((a, b) => a - b);
                        for (const lineNum of sortedResidualLines) {
                            const commands = residualCommandsByLine.get(lineNum);
                            if (commands && commands.length > 0) {
                                commands.sort((a, b) => {
                                    const typeA = a.split(' ')[1];
                                    const typeB = b.split(' ')[1];
                                    if (typeA === typeB) return 0;
                                    if (typeA === 'd') return -1;
                                    if (typeB === 'd') return 1;
                                    if (typeA === 'a') return -1;
                                    if (typeB === 'a') return 1;
                                    return 0; // 'e' at the end
                                });
                                residualCommands.push(...commands);
                            }
                        }


                        cdiff.push(...groupedCommands, ...residualCommands);
                        oldLineNum += removedLines.length;
                        newLineNum += addedLines.length;
                        if (includeEqualMode === 'context' && contextLines > 0 && i < aggregatedBlocks.length - 1) {
                            const nextBlock = aggregatedBlocks[i+1];
                            if (nextBlock.isEqualBlock && nextBlock.equalLines!.length > 0) {
                                const nextEqualLines = nextBlock.equalLines!;
                                const nextBlockStartNew = newLineNum + 1; // E+ will start here

                                const contextStartIdx = 0;
                                const contextEndIdx = Math.min(nextBlock.equalLines!.length, contextLines); // Head

                                const linesToAdd: string[] = [];
                                const lineNumsToAdd: number[] = [];

                                for (let j = contextStartIdx; j < contextEndIdx; j++) {
                                    const lineNum = nextBlockStartNew + j;
                                    if (!addedContextLines.has(lineNum)) {
                                        linesToAdd.push(nextEqualLines[j]);
                                        lineNumsToAdd.push(lineNum);
                                        addedContextLines.add(lineNum);
                                    }
                                }

                                if (linesToAdd.length > 0) {
                                    const firstLineNum = lineNumsToAdd[0];
                                    if (__DEV__ && debug) console.log(`[createPatch v3.0] Adding TAIL context (${linesToAdd.length} lines) at new line ${firstLineNum}`);
                                    cdiff.push(`${firstLineNum} E+ ${linesToAdd.length}`);
                                    cdiff.push(...linesToAdd);
                                }
                            }
                        }

                        continue;
                    }
                }
            }

            if (removedLines.length > 0) {
                if (removedLines.length > 2) {
                    cdiff.push(`${oldLineNum + 1} D+ ${removedLines.length}`);
                    cdiff.push(...removedLines);
                } else {
                    removedLines.forEach((line, j) => cdiff.push(`${oldLineNum + j + 1} D ${line}`));
                }
                oldLineNum += removedLines.length;
            }

            if (addedLines.length > 0) {
                if (addedLines.length > 2) {
                    cdiff.push(`${newLineNum + 1} A+ ${addedLines.length}`);
                    cdiff.push(...addedLines);
                } else {
                    addedLines.forEach((line, j) => cdiff.push(`${newLineNum + j + 1} A ${line}`));
                }
                newLineNum += addedLines.length;
            }
            
        }

        const validationOptionsRaw = {
            includeCharEquals: finalIncludeCharEquals,
            checkInvert: validationLevel === 'raw-invert' || validationLevel === 'all-invert',
            debug: debug
        };
        const didRawValidation = (validationLevel === 'raw' || validationLevel === 'raw-invert' || validationLevel === 'all' || validationLevel === 'all-invert');

        if (didRawValidation) {
            CdiffService.validatePatchInternal(normalizedOld, normalizedNew, cdiff, "RAW (D/d)", validationOptionsRaw);
        }
               

        let commandsToFinalize = cdiff;
        const isDifferentPatch = deletionStrategy !== 'safe'; // Check BEFORE applying
        if (isDifferentPatch) {
            if (__DEV__ && debug) console.log(`[createPatch] Applying deletionStrategy...`);
            commandsToFinalize = CdiffService.applyDeletionStrategy(cdiff, deletionStrategy, debug);
        }

        if (__DEV__ && debug) {
            console.log('\n--- [VALIDATING GENERATED PATCH] ---');
            const patchedViaService = CdiffService.applyPatch(normalizedOld, commandsToFinalize, { mode: 'text', debug: false, includeCharEquals: finalIncludeCharEquals });
            console.log('Patch application matches new content:', patchedViaService === normalizedNew);
            if (patchedViaService !== normalizedNew) {
                console.error('❌ GENERATED PATCH IS INVALID!');
                const expectedLines = normalizedNew.split('\n');
                const actualLines = patchedViaService.split('\n');
                for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i++) {
                    if (expectedLines[i] !== actualLines[i]) {
                        console.log(`Line ${i + 1} mismatch:`);
                        console.log(`  Expected: "${expectedLines[i]}"`);
                        console.log(`  Actual:   "${actualLines[i]}"`);
                        if (i > 10) break;
                    }
                }
            }
            console.log('--- [END PATCH VALIDATION] ---\n');
        }

        const validationOptionsFinal = {
            includeCharEquals: finalIncludeCharEquals,
            checkInvert: validationLevel === 'final-invert' || validationLevel === 'all-invert',
            debug: debug
        };
        const stageNameFinal = isDifferentPatch ? "FINAL (X/x)" : "FINAL (D/d)";

        const needsFinalValidation = (
            validationLevel === 'final' || 
            validationLevel === 'final-invert' || 
            validationLevel === 'all' || 
            validationLevel === 'all-invert'
        );
        
        const isAllValidation = (validationLevel === 'all' || validationLevel === 'all-invert');

        if (needsFinalValidation) {
            const canSkip = !isAllValidation && !isDifferentPatch && didRawValidation;
            
            if (canSkip) {
                if (__DEV__ && debug) {
                    console.log(`\n--- [SKIPPING FINAL VALIDATION] ---`);
                    console.log(`(Patch is identical to RAW (D/d) patch which was already validated)`);
                    console.log(`--- [END SKIPPING] ---\n`);
                }
            } else {
                CdiffService.validatePatchInternal(
                    normalizedOld, 
                    normalizedNew, 
                    commandsToFinalize, 
                    stageNameFinal, 
                    validationOptionsFinal
                );
            }
        }

        if (__DEV__ && debug) console.log('[Final Patch]:', commandsToFinalize);

        if (__DEV__ && debug) {
            console.log(
                'Path to compress:\n',
                util.inspect(commandsToFinalize, { maxArrayLength: null, depth: null, colors: true })
            );
        }
        
        if (__DEV__ && debug) console.log('[createPatch v1+] Assembling final patch...');
        let finalPatch: string[] = [];
        let patchToCompress = [...commandsToFinalize]; 

        if (compress) {
            if (__DEV__ && debug) console.log(`[createPatch v1+] Compressing main patch part (${patchToCompress.length} lines)...`);
            try {
                if (patchToCompress.length > 0 || (includeEqualMode === 'separate' && equalBlocksSeparate.length > 0)) {
                    const compressedPatch = CdiffCompressService.compress(patchToCompress, debug);
                    if (optimal) {
                        const uncompressedText = patchToCompress.join('\n');
                        const compressedText = compressedPatch.join('\n');                        
                        if (__DEV__ && debug) {
                            console.log(`[Optimal] Uncompressed: ${uncompressedText.length} chars, Compressed: ${compressedText.length} chars`);
                        }                        
                        if (compressedText.length >= uncompressedText.length) {
                            if (__DEV__ && debug) console.log(`[Optimal] Returning uncompressed (compressed is larger/equal)`);
                            finalPatch = patchToCompress;
                        } else {
                            finalPatch = compressedPatch;
                        }
                    } else {
                        finalPatch = compressedPatch;
                    }
                } else {
                    finalPatch = patchToCompress;
                }
            } catch (e) {
                console.error(`[createPatch v1+] Compression failed: ${e}. Returning uncompressed.`);
                finalPatch = patchToCompress;
            }
        } else {
            finalPatch = patchToCompress;
        }

        const needsCompressedValidation = (
            validationLevel === 'compressed' || 
            validationLevel === 'compressed-invert' || 
            validationLevel === 'all' || 
            validationLevel === 'all-invert'
        );

        if (needsCompressedValidation && compress) {
            if (__DEV__ && debug) console.log(`\n--- [START COMPRESSED VALIDATION] ---`);
            let decompressedPatch: string[];
            let isValid = false;

            try {
                if (CdiffCompressService.isCompressed(finalPatch)) {
                    decompressedPatch = CdiffCompressService.decompress(finalPatch, debug).patch;
                } else {
                    decompressedPatch = finalPatch;
                }
                
                const checkInvert = (validationLevel === 'compressed-invert' || validationLevel === 'all-invert');
                const allowInvert = checkInvert && (deletionStrategy === 'safe');
                
                isValid = CdiffService.validatePatchInternal(
                    normalizedOld,
                    normalizedNew,
                    decompressedPatch,
                    "COMPRESSED",
                    {
                        includeCharEquals: finalIncludeCharEquals,
                        checkInvert: allowInvert,
                        debug: debug
                    }
                );
                
                if (__DEV__ && debug && checkInvert && !allowInvert) {
                    console.log(`[COMPRESSED VALIDATION] Backward (Invert) check skipped for 'unsafe' patch.`);
                }
                
            } catch (e) {
                console.error(`❌ COMPRESSED VALIDATION FAILED (Decompression Error):`, e);
                isValid = false;
            }
            if (__DEV__ && debug && !isValid) console.log(`--- [END COMPRESSED VALIDATION (FAILED)] ---`);
            
        } else if (needsCompressedValidation && !compress) {
            if (__DEV__ && debug) {
                console.log(`\n--- [SKIPPING COMPRESSED VALIDATION] ---`);
                console.log(`(compress=false, no compressed patch to validate)`);
                console.log(`--- [END SKIPPING] ---\n`);
            }
        }

        if (includeEqualMode === 'separate' && equalBlocksSeparate.length > 0) {
            if (__DEV__ && debug) console.log(`[createPatch v1+] Appending separate EQUAL blocks (${equalBlocksSeparate.length} lines)...`);
            finalPatch.push(CdiffService.EQUAL_BLOCKS_SEPARATOR);
            finalPatch.push(...equalBlocksSeparate);
        }

        if (finalPatch.length === 0) {
            if (__DEV__ && debug) console.log(`[createPatch v3.0] No changes detected. Returning empty patch.`);
            return [];
        }

        if (finalPatch.length === 1 && finalPatch[0] === CdiffCompressService.COMPRESSION_FLAG && equalBlocksSeparate.length === 0) {
            if (__DEV__ && debug) console.log(`[createPatch v3.0] Compression resulted in only flag. Returning empty patch.`);
            return [];
        }

        if (__DEV__ && debug) {
            const patchContent = finalPatch.join('\n');
            const filePath = resolve(process.cwd(), 'temp_patch_for_analysis.cdiff');
                    
            writeFileSync(filePath, patchContent, { encoding: 'utf-8' });
                    
            console.log(`[DEBUG] Patch saved for analysis: ${filePath}`);
        }
        if (__DEV__ && debug) {
            console.log(
                'Compressed patch:\n',
                util.inspect(finalPatch, { maxArrayLength: null, depth: null, colors: true })
            );
        }

        return finalPatch;
    }

    /**
     * Inverts a cdiff patch by swapping command types.
     * This allows a patch that transforms A to B to be converted into a patch
     * that transforms B back to A.
     * - 'A' <-> 'D'
     * - 'A+' <-> 'D+'
     * - 'a' <-> 'd'
     * - 'a*' <-> 'd*'
     * - 'E+' (context) blocks have their `Old-New` coordinates inverted to `New-Old`.
     *
     * @param cdiff - The cdiff patch array to invert (can be compressed).
     * @param options - Configuration options, mainly for debugging.
     * @returns A new cdiff patch array that represents the reverse operation.
     * @throws {Error} If the patch contains 'unsafe' commands ('X', 'x'),
     * which cannot be inverted as they lack the original content.
     *
     * @example <caption>Line-level inversion</caption>
     * const forwardPatch = ['2 D old line', '2 A new line'];
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['2 A old line', '2 D new line']
     *
     * @example <caption>Grouped command inversion</caption>
     * const forwardPatch = ['5-10 a* 0 2 "  "'];
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['5-10 d* 0 2 "  "']
     */
    public static invertPatch(
        cdiff: string[],
        options?: CdiffOptions
    ): string[] {
        const debug = options?.debug ?? false;
        if (__DEV__ && debug) console.log('[DEBUG] Starting invertPatch with decompression check...');

        let patchToInvert: string[];

        if (CdiffCompressService.isCompressed(cdiff)) {
            if (__DEV__ && debug) console.log('[DEBUG] Patch is compressed. Decompressing...');
            try {
                const decompressedResult = CdiffCompressService.decompress(cdiff, debug).patch;
                patchToInvert = decompressedResult;
                if (__DEV__ && debug) console.log('[DEBUG] Decompression successful.');
            } catch (decompError) {
                console.error('[DEBUG] CRITICAL: Decompression failed during invertPatch!', decompError);
                throw new Error(`Failed to decompress patch for inversion: ${(decompError as Error).message}`);
            }
        } else {
            if (__DEV__ && debug) console.log('[DEBUG] Patch was not compressed. Inverting as is.');
            patchToInvert = cdiff; 
        }

        for (const command of patchToInvert) {
            if (command.match(/^([\d,-]+)\s+(?:[Xx]\+?|[Xx]\*)\s/)) {
                throw new Error(
                    "[CdiffService.invertPatch] Cannot invert patch: " + 
                    "It contains 'X'/'x' (unsafe delete) commands. " +
                    "These commands do not store the original content required for inversion."
                );
            }
        }


        const invertedCdiff: string[] = [];
        let separateEqualBlocks: string[] = [];

        const separatorIndex = patchToInvert.findIndex(line => line === CdiffService.EQUAL_BLOCKS_SEPARATOR);
        if (separatorIndex !== -1) {
            if (__DEV__ && debug) console.log(`[invertPatch v1+] Found EQUAL_BLOCKS_SEPARATOR. Separating.`);
            separateEqualBlocks = patchToInvert.slice(separatorIndex + 1);
            patchToInvert = patchToInvert.slice(0, separatorIndex);
        }

        const blockRegex = /^(\d+)\s+([AD]\+)\s+(\d+)$/;
        const groupCharLineRegex = /^([\d,-]+)\s+([adx]\*)\s+(.*)$/s;
        const singleLineRegex = /^(\d+)\s+([AD])\s(.*)$/s;
        const charLineRegex = /^(\d+)\s+([adex])\s(.*)$/s;
        const equalBlockRegex = /^(\d+)\s+(E\+)\s+(\d+)$/;
        const separateEqualBlockRegex = /^(\d+)-(\d+)\s+(E\+)\s+(\d+)$/;

        let i = 0;
        while (i < patchToInvert.length) {
            const command = patchToInvert[i];
            if (__DEV__ && debug) console.log(`[DEBUG] Processing command #${i}: ${command}`);

            const blockMatch = command.match(blockRegex);            
            if (blockMatch) {
                const [, coordStr, type, countStr] = blockMatch;
                const count = parseInt(countStr, 10);
                const newType = type === 'A+' ? 'D+' : 'A+';
                invertedCdiff.push(`${coordStr} ${newType} ${countStr}`);
                const contentBlock = patchToInvert.slice(i + 1, i + 1 + count);
                invertedCdiff.push(...contentBlock);
                i += (1 + count);
                continue;
            }

            const equalBlockMatch = !blockMatch ? command.match(equalBlockRegex) : null;
            if (equalBlockMatch) {
                const [, coordStr, type, countStr] = equalBlockMatch;
                const count = parseInt(countStr, 10);
                invertedCdiff.push(command); 
                const contentBlock = patchToInvert.slice(i + 1, i + 1 + count);
                invertedCdiff.push(...contentBlock);
                i += (1 + count);
                continue;
            }

            const groupCharMatch = !blockMatch && !equalBlockMatch ? command.match(groupCharLineRegex) : null;
            if (groupCharMatch) {
                const [, lineRange, type, rest] = groupCharMatch;
                const newType = type === 'a*' ? 'd*' : 'a*';
                invertedCdiff.push(`${lineRange} ${newType} ${rest}`);
                i++;
                continue;
            }

            const singleLineMatch = !blockMatch && !equalBlockMatch && !groupCharMatch ? command.match(singleLineRegex) : null;
            if (singleLineMatch) {
                const [, lineNum, type, content] = singleLineMatch;
                const newType = type === 'A' ? 'D' : 'A';
                invertedCdiff.push(`${lineNum} ${newType} ${content}`);
                i++;
                continue;
            }

            const charLineMatch = command.match(charLineRegex);
            if (charLineMatch) {
                const lineNum = parseInt(charLineMatch[1], 10);
                const patchForThisLine: string[] = [];

                let j = i;
                while (j < patchToInvert.length) {
                    const nextCommand = patchToInvert[j];
                    const nextMatch = nextCommand.match(charLineRegex);
                    if (nextMatch && parseInt(nextMatch[1], 10) === lineNum) {
                        patchForThisLine.push(nextCommand);
                        j++;
                    } else {
                        break;
                    }
                }

                if (__DEV__ && debug) console.log(`[DEBUG] Delegating char patch for line ${lineNum} to CdiffCharService:`, patchForThisLine);

                const invertedForThisLine = CdiffCharService.invertPatch(patchForThisLine, debug);
                invertedCdiff.push(...invertedForThisLine);

                i = j;
                continue;
            }

            if (__DEV__ && debug) console.log(`[DEBUG] Command not matched, skipping: "${command}"`);
            i++;
        }

        if (separateEqualBlocks.length > 0) {
            invertedCdiff.push(CdiffService.EQUAL_BLOCKS_SEPARATOR);
            if (__DEV__ && debug) console.log(`[invertPatch v1+] Inverting ${separateEqualBlocks.length} lines of separate EQUAL blocks...`);
            let j = 0;
            while (j < separateEqualBlocks.length) {
                const command = separateEqualBlocks[j];
                const match = command.match(separateEqualBlockRegex); // <Old>-<New> E+ <Count>
                if (match) {
                    const [, oldLine, newLine, type, countStr] = match;
                    const count = parseInt(countStr, 10);
                    const invertedHeader = `${newLine}-${oldLine} ${type} ${countStr}`;
                    invertedCdiff.push(invertedHeader);
                    const contentBlock = separateEqualBlocks.slice(j + 1, j + 1 + count);
                    invertedCdiff.push(...contentBlock);
                    j += (1 + count);
                } else {
                    invertedCdiff.push(command);
                    j++;
                }
            }
        }


        if (__DEV__ && debug) console.log('[DEBUG] invertPatch finished.');
        return invertedCdiff;
    }

    /**
     * Iterates over a generated patch and converts 'D'/'d' commands to 'X'/'x' 
     * based on the provided strategy.
     * @param patch - The patch containing 'D'/'d' commands.
     * @param strategy - 'unsafe' (convert all) or a predicate function.
     * @param debug - Flag for logging.
     * @returns A new patch array with the strategy applied.
     * @private
     */
    private static applyDeletionStrategy(
        patch: string[],
        strategy: 'unsafe' | ((content: string, lineNum: number) => 'safe' | 'unsafe'),
        debug: boolean
    ): string[] {
        
        const newPatch: string[] = [];
        const blockRegex = /^(\d+)\s+(D\+)\s+(\d+)$/;
        const singleRegex = /^(\d+)\s+(D)\s(.*)$/s;
        const groupRegex = /^([\d,-]+)\s+(d\*)\s+(\d+)\s+(\d+)\s(.*)$/s;
        const charRegex = /^(\d+)\s+(d)\s+(.*)$/s;

        const getDecision = (content: string, lineNum: number): 'safe' | 'unsafe' => {
            if (strategy === 'unsafe') return 'unsafe';
            try {
                return strategy(content, lineNum);
            } catch (e) {
                console.error(`[applyDeletionStrategy] Strategy function failed: ${e}. Defaulting to 'safe'.`);
                return 'safe';
            }
        };

        for (let i = 0; i < patch.length; i++) {
            const line = patch[i];

            // 1. Block Deletion (D+)
            const blockMatch = line.match(blockRegex);
            if (blockMatch) {
                const lineNumStr = blockMatch[1];
                const lineNum = parseInt(lineNumStr, 10);
                const count = parseInt(blockMatch[3], 10);
                const contentLines = patch.slice(i + 1, i + 1 + count);
                
                let allUnsafe = true;
                if (strategy !== 'unsafe') {
                    for (let j = 0; j < contentLines.length; j++) {
                        if (getDecision(contentLines[j], lineNum + j) === 'safe') {
                            allUnsafe = false;
                            break;
                        }
                    }
                }

                if (allUnsafe) {
                    if (__DEV__ && debug) console.log(`[Strategy] Converting D+ at line ${lineNum} to X+`);
                    newPatch.push(`${lineNumStr} X+ ${count}`);
                } else {
                    newPatch.push(line, ...contentLines);
                }
                i += count;
                continue;
            }

            // 2. Single Deletion (D)
            const singleMatch = line.match(singleRegex);
            if (singleMatch) {
                const lineNumStr = singleMatch[1];
                const lineNum = parseInt(lineNumStr, 10);
                const content = singleMatch[3];
                
                if (getDecision(content, lineNum) === 'unsafe') {
                    if (__DEV__ && debug) console.log(`[Strategy] Converting D at line ${lineNum} to X`);
                    newPatch.push(`${lineNumStr} X `);
                } else {
                    newPatch.push(line);
                }
                continue;
            }

            // 3. Grouped Char Deletion (d*)
            const groupMatch = line.match(groupRegex);
            if (groupMatch) {
                const range = groupMatch[1];
                const index = groupMatch[3];
                const length = groupMatch[4];
                const content = groupMatch[5];
                
                // Note: d* line numbers aren't contiguous, so we pass '0' as a placeholder
                if (getDecision(content, 0) === 'unsafe') {
                    if (__DEV__ && debug) console.log(`[Strategy] Converting d* for range ${range} to x*`);
                    newPatch.push(`${range} x* ${index} ${length}`);
                } else {
                    newPatch.push(line);
                }
                continue;
            }

            // 4. Char Deletion (d)
            const charMatch = line.match(charRegex);
            if (charMatch) {
                const lineNumStr = charMatch[1];
                const lineNum = parseInt(lineNumStr, 10);
                let rest = charMatch[3];
                
                let allCharUnsafe = true;
                const newRestParts: string[] = [];
                
                let remainder = rest.trim();
                while (remainder.length > 0) {
                    const parts = remainder.match(/^(\d+) (\d+) /);
                    if (!parts) break;
                    
                    const index = parts[1];
                    const length = parseInt(parts[2], 10);
                    const headerLength = parts[0].length;
                    const content = remainder.substring(headerLength, headerLength + length);

                    if (getDecision(content, lineNum) === 'safe') {
                        allCharUnsafe = false;
                        break; // Stop checking, we must keep the original 'd' command
                    }
                    
                    newRestParts.push(`${index} ${length}`);
                    remainder = remainder.substring(headerLength + length).trimStart();
                }

                if (allCharUnsafe) {
                    if (__DEV__ && debug) console.log(`[Strategy] Converting d at line ${lineNum} to x`);
                    newPatch.push(`${lineNumStr} x ${newRestParts.join(' ')}`);
                } else {
                    newPatch.push(line);
                }
                continue;
            }
            
            // 5. A, A+, a, a*, E, e etc.
            newPatch.push(line);
        }
        
        return newPatch;
    }

    /**
     * Internal helper to validate a generated patch against the expected new content.
     * Can optionally also validate if the patch is invertible.
     * Logs errors to the console if validation fails.
     *
     * @param normalizedOld - The original (old) content.
     * @param normalizedNew - The expected (new) content.
     * @param patch - The patch to test (must be decompressed).
     * @param stageName - The name of the stage for logging (e.g., "RAW (D/d)").
     * @param options - Validation options.
     * @returns `true` if validation (both forward and backward, if requested) passes, `false` otherwise.
     * @private
     */
    private static validatePatchInternal(
        normalizedOld: string,
        normalizedNew: string,
        patch: string[], // Patch to test (already decompressed)
        stageName: string, // e.g., "RAW (D/d)" or "FINAL (X/x)"
        options: { 
            includeCharEquals: boolean, 
            checkInvert: boolean,
            debug: boolean 
        }
    ): boolean {
        const debug = options.debug;
        if (__DEV__ && debug){
            console.log(`\n--- [START ${stageName} VALIDATION] ---`);
        }
        let isForwardValid = false;
        let isBackwardValid = true; // Assume true if not checking

        // --- 1. Forward Pass (applyPatch) ---
        try {
            const patchedViaService = CdiffService.applyPatch(normalizedOld, patch, { 
                mode: 'text', 
                debug: false, // Keep validation apply quiet
                includeCharEquals: options.includeCharEquals 
            });
            
            isForwardValid = patchedViaService === normalizedNew;
            if (__DEV__ && debug){
                console.log(`Patch application (${stageName}) matches new content (Forward):`, isForwardValid);
            }
            if (!isForwardValid) {
                console.error(`❌ ${stageName} FORWARD PATCH IS INVALID!`);
                const expectedLines = normalizedNew.split('\n');
                const actualLines = patchedViaService.split('\n');
                let mismatchesFound = 0;
                for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i++) {
                    if (expectedLines[i] !== actualLines[i]) {
                        if (__DEV__ && debug){
                            console.log(`Line ${i + 1} mismatch:`);
                            console.log(`  Expected: "${expectedLines[i]}"`);
                            console.log(`  Actual:   "${actualLines[i]}"`);
                        }
                        mismatchesFound++;
                        if (mismatchesFound > 10) {
                            if (__DEV__ && debug){
                                console.log('... (omitting further mismatches)');
                            }
                            break;
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`❌ ${stageName} FORWARD VALIDATION FAILED WITH ERROR:`, error);
            isForwardValid = false;
        }

        // --- 2. Backward Pass (invert + applyInverted) ---
        if (options.checkInvert) {
            if (!isForwardValid) {
                if (__DEV__ && debug){
                    console.warn(`[${stageName} VALIDATION] Skipping backward validation because forward validation failed.`);
                }
                isBackwardValid = false;
            } else {
                try {
                    const isUnsafe = patch.some(cmd => cmd.match(/^([\d,-]+)\s+(?:[Xx]\+?|[Xx]\*)\s/));

                    if (isUnsafe) {
                        if (__DEV__ && debug){
                            console.log(`[${stageName} VALIDATION] Backward (Invert) check skipped for 'unsafe' patch (expected behavior).`);                       
                        }
                        isBackwardValid = true; // This is expected, so it's "valid"
                    } else {
                        const invertedPatch = CdiffService.invertPatch(patch, { debug: options.debug, mode: 'text' });
                        
                        const revertedContent = CdiffService.applyInvertedPatch(normalizedNew, invertedPatch, {
                            mode: 'text',
                            debug: false,
                            includeCharEquals: false
                        });

                        isBackwardValid = revertedContent === normalizedOld;
                        if (__DEV__ && debug){
                            console.log(`Patch application (${stageName}) matches old content (Backward):`, isBackwardValid);
                        }
                        if (!isBackwardValid) {
                            console.error(`❌ ${stageName} BACKWARD (INVERT) PATCH IS INVALID!`);
                            const expectedLines = normalizedOld.split('\n');
                            const actualLines = revertedContent.split('\n');
                            let mismatchesFound = 0;
                            for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i++) {
                                if (expectedLines[i] !== actualLines[i]) {
                                    if (__DEV__ && debug){
                                        console.log(`Line ${i + 1} (Reverted) mismatch:`);
                                        console.log(`  Expected (Old): "${expectedLines[i]}"`);
                                        console.log(`  Actual (Rev):   "${actualLines[i]}"`);
                                    }
                                    mismatchesFound++;
                                    if (mismatchesFound > 10) {
                                        if (__DEV__ && debug){
                                            console.log('... (omitting further mismatches)');
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error(`❌ ${stageName} BACKWARD (INVERT) VALIDATION FAILED WITH ERROR:`, error);
                    isBackwardValid = false;
                }
            }
        }
        if (__DEV__ && debug){
            console.log(`--- [END ${stageName} VALIDATION] ---\n`);
        }
        return isForwardValid && isBackwardValid;
    }

}

/**
 * Compresses a sorted array of line numbers into a compact string format.
 * This is used to create efficient line ranges for grouped commands (`a*`/`d*`).
 * Consecutive numbers are collapsed into a "start-end" range.
 *
 * @param numbers - A sorted array of unique numbers.
 * @returns A string representation of the numbers.
 * @internal
 *
 * @example
 * const numbers = [2, 3, 4, 6, 8, 9, 10];
 * const compressed = compressLineNumbers(numbers);
 * // compressed is "2-4,6,8-10"
 */
function compressLineNumbers(numbers: number[]): string {
    if (numbers.length === 0) return '';
    numbers.sort((a, b) => a - b);
    const ranges: (string | number)[] = [];
    let start = numbers[0];
    let end = numbers[0];
    for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] === end + 1) {
            end = numbers[i];
        } else {
            ranges.push(start === end ? start : `${start}-${end}`);
            start = end = numbers[i];
        }
    }
    ranges.push(start === end ? start : `${start}-${end}`);
    return ranges.join(',');
}


/**
 * Deconstructs a complex character-level command string into its atomic operations.
 * This is a crucial step for finding repetitive patterns across different lines.
 * For example, a single line might have multiple `a` operations. This function
 * splits them into individual, comparable strings.
 *
 * @param command - A full character-level command for a single line.
 * @returns An array of strings, where each string is a single atomic operation.
 * @internal
 *
 * @example
 * const command = '5 a 0 2 "  " 8 5 " more"';
 * const deconstructed = deconstructCharCommand(command);
 * // deconstructed is ['a 0 2 "  "', 'a 8 5 " more"']
 */
function deconstructCharCommand(command: string): string[] {
    const parts = command.split(' ');
    const type = parts[1];
    if (type !== 'a' && type !== 'd' && type !== 'e') {
        return []; 
    }
    if (type === 'e') {
        return []; 
    }
    const ops: string[] = [];

    let remainder = command.substring(command.indexOf(type) + 2);

    while (remainder.length > 0) {
        const match = remainder.match(/^(\d+)\s(\d+)\s/);
        if (!match) break;

        const index = match[1];
        const length = parseInt(match[2], 10);
        const headerLength = match[0].length;

        const content = remainder.substring(headerLength, headerLength + length);

        ops.push(`${type} ${index} ${length} ${content}`);

        remainder = remainder.substring(headerLength + length).trimStart();
    }
    return ops;
}