import { diffLines, type Change } from 'diff';
import { CdiffCharService } from './cdiff_chars.js';

/**
 * A utility for creating and applying compact, self-contained, single-coordinate diff patches.
 * It supports a rich command set for maximum patch compactness:
 * - Single-line commands (`A`, `D`)
 * - Block commands (`A+`, `D+`) for consecutive line changes.
 * - Character-level commands (`a`, `d`) for precise intra-line changes.
 * - Grouped character-level commands (`a*`, `d*`) that apply a common operation
 * to multiple, potentially non-contiguous lines.
 *
 * The `createPatch` method automatically analyzes changes and chooses the most
 * efficient command combination to produce the smallest possible patch.
 * @version 1.2.0
 */
export class CdiffService {

    /**
     * Applies a cdiff patch to an original content string to produce the new content.
     * Supports all command types: `A`, `D`, `A+`, `D+`, `a`, `d`, and grouped `a*`, `d*`.
     * 
     * Character-level commands (`a`, `d`) are applied directly to the corresponding line
     * before any line deletions or additions are processed.
     *
     * @param originalContent The source content to which the patch will be applied.
     * @param cdiff An array of strings representing the cdiff patch commands.
     * @param strictMode If true, the function will throw an error on content mismatch. If false, it will issue a warning and skip the mismatched command.
     * @param onWarning A callback function that receives warning messages in non-strict mode.
     * @param debug If true, logs detailed internal processing steps to the console.
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
     * @example <caption>Grouped character-level modification</caption>
     * const original = 'line a\nline b\nline c';
     * const cdiff = ['1-3 a* 0 4 "  "']; // Add indentation to lines 1 through 3
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
        strictMode: boolean = false,
        onWarning?: (message: string) => void,
        debug: boolean = false
    ): string {
        if (debug) console.log('[CdiffService.applyPatch] Starting...');
        originalContent = originalContent.replace(/\r\n|\r/g, '\n');
        const sourceLines = originalContent === '' ? [] : originalContent.split('\n');
        const deletions = new Set<number>();
        const additions = new Map<number, string[]>();
        const charMods = new Map<number, string[]>();

        const blockRegex = /^(\d+)\s+([AD]\+)\s+(\d+)$/;
        const singleLineRegex = /^(\d+)\s+([AD])\s(.*)$/s;
        const charLineRegex = /^(\d+)\s+([ad])\s(.*)$/s;
        const groupCharLineRegex = /^([\d,-]+)\s+([ad]\*)\s+(.*)$/s;

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

        for (let i = 0; i < cdiff.length; i++) {
            const command = cdiff[i];
            if (debug) console.log(`[DEBUG] Processing command #${i}: ${command}`);
            const blockMatch = command.match(blockRegex);
            const singleLineMatch = !blockMatch ? command.match(singleLineRegex) : null;
            const charLineMatch = !blockMatch && !singleLineMatch ? command.match(charLineRegex) : null;
            const groupCharLineMatch = !blockMatch && !singleLineMatch && !charLineMatch ? command.match(groupCharLineRegex) : null;

            if (blockMatch) {
                const [, coordStr, type, countStr] = blockMatch;
                const lineNum = parseInt(coordStr, 10);
                const count = parseInt(countStr, 10);
                if (debug) console.log(`[DEBUG] Block match found: type=${type}, line=${lineNum}, count=${count}`);
                
                if (i + count >= cdiff.length) {
                    const message = `Block command at line ${i + 1} expects ${count} content lines, but EOF reached.`;
                    if (strictMode) { throw new Error(message); }
                    if (onWarning) { onWarning(message); } else { console.warn(message); }
                    continue;
                }

                const contentBlock = cdiff.slice(i + 1, i + 1 + count);
                i += count;

                if (type === 'A+') {
                    if (!additions.has(lineNum)) {
                        additions.set(lineNum, []);
                    }
                    additions.get(lineNum)!.push(...contentBlock);
                    if (debug) console.log(`[DEBUG] Queued block addition at line ${lineNum}`, contentBlock);
                } else if (type === 'D+') {
                    let mismatch = false;
                    for (let j = 0; j < count; j++) {
                        const currentLineIndex = lineNum + j - 1;
                        if (currentLineIndex >= sourceLines.length || sourceLines[currentLineIndex] !== contentBlock[j]) {
                            const message = `Block deletion mismatch at line ${currentLineIndex + 1}.`;
                            if (strictMode) { throw new Error(message); }
                            if (onWarning) { onWarning(message); } else { console.warn(message); }
                            mismatch = true;
                            break;
                        }
                    }
                    if (!mismatch) {
                        for (let j = 0; j < count; j++) {
                            deletions.add(lineNum + j);
                        }
                        if (debug) console.log(`[DEBUG] Queued block deletion for lines ${lineNum} to ${lineNum + count - 1}`);
                    }
                }
            } else if (singleLineMatch) {
                const [, coordStr, type, content] = singleLineMatch;
                const lineNum = parseInt(coordStr, 10);
                if (debug) console.log(`[DEBUG] Single line match found: type=${type}, line=${lineNum}, content="${content}"`);

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
                            if (debug) console.log(`[DEBUG] Queued deletion for line ${lineNum}`);
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
                    if (debug) console.log(`[DEBUG] Queued addition at line ${lineNum}: "${content}"`);
                }
            } else if (charLineMatch) {
                const lineNum = parseInt(charLineMatch[1], 10);
                if (debug) console.log(`[DEBUG] Queued char patch for line ${lineNum}`);
                if (!charMods.has(lineNum)) {
                    charMods.set(lineNum, []);
                }
                charMods.get(lineNum)!.push(command);
            } else if (groupCharLineMatch) {
                const [, rangeStr, type, rest] = groupCharLineMatch;
                const commandType = type.charAt(0); // 'a' or 'd'
                const lineNumbers = parseLineRange(rangeStr);

                if (debug) console.log(`[DEBUG] Group char match found: type=${type}, lines=${lineNumbers.join(',')}`);

                for (const lineNum of lineNumbers) {
                    if (!charMods.has(lineNum)) {
                        charMods.set(lineNum, []);
                    }
                    // "Unpack" the group command into individual commands for the charMods map
                    charMods.get(lineNum)!.push(`${lineNum} ${commandType} ${rest}`);
                }

            } else {
                 if (debug) console.log(`[DEBUG] Command did not match any pattern. Ignoring.`);
            }
        }

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
                onWarning,
                debug
            );
        }

        if (debug) console.log('[DEBUG] Assembling result...');
        const contentLines: string[] = [];
        for (let i = 0; i < sourceLines.length; i++) {
            if (!deletions.has(i + 1)) {
                contentLines.push(sourceLines[i]);
            }
        }
        if (debug) console.log(`[DEBUG] Content lines after deletions: ${contentLines.length}`);

        const resultLines: string[] = [];
        let targetLineNum = 1;
        
        while (contentLines.length > 0 || additions.size > 0) {
            if (additions.has(targetLineNum)) {
                resultLines.push(...additions.get(targetLineNum)!);
                additions.delete(targetLineNum);
            } else {
                if (contentLines.length > 0) {
                    resultLines.push(contentLines.shift()!);
                } else {
                    break;
                }
            }
            targetLineNum++;
        }

        if (additions.size > 0) {
            const sortedKeys = Array.from(additions.keys()).sort((a, b) => a - b);
            for (const key of sortedKeys) {
                resultLines.push(...additions.get(key)!);
            }
        }
        
        if (debug) console.log('[DEBUG] applyPatch finished.');
        return resultLines.join('\n');
    }

    /**
     * Applies an inverted patch to the new content to restore the original content.
     * This is an alias for `applyPatch` and supports all command types.
     *
     * @param newContent The content that was the result of a forward patch.
     * @param invertedCdiff An inverted cdiff patch array.
     * @param strictMode If true, the function will throw an error on content mismatch.
     * @param onWarning A callback for warning messages in non-strict mode.
     * @param debug If true, logs detailed internal processing steps to the console.
     * @returns The restored original content.
     *
     * @example
     * const oldContent = "A\nB\nC";
     * const newContent = "A\nX\nC";
     * 
     * // Forward
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * const result = CdiffService.applyPatch(oldContent, patch);
     * // result === newContent
     * 
     * // Backward
     * const invertedPatch = CdiffService.invertPatch(patch);
     * const restored = CdiffService.applyInvertedPatch(newContent, invertedPatch);
     * // restored === oldContent
     */
    public static applyInvertedPatch(
        newContent: string,
        invertedCdiff: string[],
        strictMode: boolean = false,
        onWarning?: (message: string) => void,
        debug: boolean = false
    ): string {
        if (debug) console.log('[DEBUG] Starting applyInvertedPatch...');
        return CdiffService.applyPatch(newContent, invertedCdiff, strictMode, onWarning, debug);
    }

    /**
     * Compares two text contents and generates a single-coordinate cdiff patch.
     * The patch may contain:
     * - Line commands (`A`, `D`)
     * - Block commands (`A+`, `D+`)
     * - Character-level commands (`a`, `d`)
     * - Grouped character-level commands (`a*`, `d*`) for pattern-based compression.
     * * The method automatically chooses the most compact representation for each change.
     *
     * Character-level patches are used when they produce a smaller patch than line-level replacements,
     * especially for aligned multi-line blocks (N lines → N lines).
     *
     * @param oldContent The original content string.
     * @param newContent The new content string.
     * @param debug If true, logs internal processing steps to the console.
     * @returns An array of strings representing the cdiff patch.
     *
     * @example <caption>Basic line replacement</caption>
     * const oldContent = 'line 1\nold line\nline 3';
     * const newContent = 'line 1\nnew line\nline 3';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch is ['2 D old line', '2 A new line']
     *
     * @example <caption>Character-level change</caption>
     * const oldContent = 'const x = 10;';
     * const newContent = 'const y = 10;';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch is ['1 d 6 1 x', '1 a 6 1 y']
     * 
     * @example <caption>Grouped character-level patch for indentation change</caption>
     * const oldContent = '{\n"key": "value"\n}';
     * const newContent = '{\n  "key": "value"\n}';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch is ['2 a* 0 2 "  "']
     *
     * @example <caption>Multi-line block addition</caption>
     * const oldContent = 'start\nend';
     * const newContent = 'start\nline A\nline B\nline C\nend';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch is ['2 A+ 3', 'line A', 'line B', 'line C']
     *
     * @example <caption>Aligned multi-line replacement (character-level per line)</caption>
     * const oldContent = 'const a = 1;\nconst b = 2;';
     * const newContent = 'const a = 100;\nconst b = 200;';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch may be ['1 a 11 2 00', '2 a 15 2 00']
     */
    public static createPatch(
        oldContent: string,
        newContent: string,
        debug: boolean = false
    ): string[] {
        if (debug) console.log('[DEBUG] Starting createPatch...');
        oldContent = oldContent.replace(/\r\n|\r/g, '\n');
        newContent = newContent.replace(/\r\n|\r/g, '\n');
        const cdiff: string[] = [];
        const changes: Change[] = diffLines(oldContent, newContent, { ignoreWhitespace: false });

        let oldLineNum = 0;
        let newLineNum = 0;

        for (let i = 0; i < changes.length; i++) {
            const part = changes[i];
            const nextPart = i + 1 < changes.length ? changes[i + 1] : null;

            if (debug) {
                console.log(`\n[DEBUG] Processing part ${i}:`, { ...part, value: JSON.stringify(part.value) });
                if (nextPart) {
                    console.log(`[DEBUG] Next part ${i+1}:`, { ...nextPart, value: JSON.stringify(nextPart.value) });
                }
            }

            if (nextPart && part.removed && nextPart.added) {
                const removedLines = part.value.endsWith('\n') ? part.value.slice(0, -1).split('\n') : part.value.split('\n');
                const addedLines = nextPart.value.endsWith('\n') ? nextPart.value.slice(0, -1).split('\n') : nextPart.value.split('\n');

                // --- NEW LOGIC FOR GROUPING AND PATTERN MATCHING ---
                if (removedLines.length === addedLines.length && removedLines.length > 0) {
                    const blockStartLine = oldLineNum + 1;
                    const individualCharPatches = new Map<number, string[]>();
                    let totalCharPatchLength = 0;

                    // Step 1: Generate all individual char patches first
                    for (let idx = 0; idx < removedLines.length; idx++) {
                        const lineNum = blockStartLine + idx;
                        const oldLine = removedLines[idx];
                        const newLine = addedLines[idx];
                        const lineCharPatch = CdiffCharService.createPatch(oldLine, newLine, lineNum, debug);
                        if (lineCharPatch.length > 0) {
                            individualCharPatches.set(lineNum, lineCharPatch);
                            totalCharPatchLength += lineCharPatch.join('\n').length;
                        }
                    }

                    const blockPatch: string[] = [
                        `${blockStartLine} D+ ${removedLines.length}`, ...removedLines,
                        `${blockStartLine} A+ ${addedLines.length}`, ...addedLines
                    ];

                    // Only proceed if char patches are smaller than a full block replacement
                    if (totalCharPatchLength > 0 && totalCharPatchLength < blockPatch.join('\n').length) {
                        const opFrequency = new Map<string, number[]>(); // op -> [line1, line2, ...]
                        const residualOps = new Map<number, string[]>(); // line -> [op1, op2, ...]

                        // Step 2: Deconstruct commands and find common patterns
                        for (const [lineNum, commands] of individualCharPatches.entries()) {
                            const deconstructedOps = commands.flatMap(deconstructCharCommand);
                            for (const op of deconstructedOps) {
                                if (!opFrequency.has(op)) opFrequency.set(op, []);
                                opFrequency.get(op)!.push(lineNum);
                            }
                        }

                        const finalPatch: string[] = [];

                        // Step 3: Generate grouped commands for frequent patterns
                        for (const [op, lines] of opFrequency.entries()) {
                            if (lines.length > 1) {
                                const lineRange = compressLineNumbers(lines);
                                const [type, ...rest] = op.split(' ');
                                finalPatch.push(`${lineRange} ${type}* ${rest.join(' ')}`);
                                // Mark this op as "handled" for these lines
                                for (const lineNum of lines) {
                                    if (!residualOps.has(lineNum)) residualOps.set(lineNum, []);
                                    // Add a placeholder to signify it's been handled by a group
                                    const currentOps = individualCharPatches.get(lineNum)!.flatMap(deconstructCharCommand);
                                    residualOps.set(lineNum, 
                                    currentOps.filter(individualOp => individualOp !== op)
                                    );
                                }
                            }
                        }
                        
                        // Step 4: Collect residual (unique) ops
                        const singleLineCommands = new Map<number, string>();
                        for (const [lineNum, commands] of individualCharPatches.entries()) {
                            const lineResiduals = residualOps.get(lineNum);
                            
                            // If lineResiduals is undefined, it means none of its ops were grouped
                            // If it's defined, it means some might have been grouped
                            const opsToProcess = lineResiduals === undefined 
                                ? commands.flatMap(deconstructCharCommand) 
                                : lineResiduals;

                            if(opsToProcess.length > 0) {
                                const a_ops = opsToProcess.filter(op => op.startsWith('a ')).map(op => op.substring(2)).join(' ');
                                const d_ops = opsToProcess.filter(op => op.startsWith('d ')).map(op => op.substring(2)).join(' ');
                                
                                let finalLineCommand = '';
                                if(d_ops) finalLineCommand += `${lineNum} d ${d_ops}`;
                                if(a_ops) finalLineCommand += (finalLineCommand ? '\n' : '') + `${lineNum} a ${a_ops}`;

                                if(finalLineCommand) {
                                    singleLineCommands.set(lineNum, finalLineCommand);
                                }
                            }
                        }

                        // Push grouped commands first, then unique line commands sorted by line number
                        cdiff.push(...finalPatch);
                        const sortedSingleLines = Array.from(singleLineCommands.entries()).sort((a,b) => a[0] - b[0]);
                        for(const [,command] of sortedSingleLines) {
                            cdiff.push(...command.split('\n'));
                        }

                        oldLineNum += removedLines.length;
                        newLineNum += addedLines.length;
                        i++; // Skip nextPart
                        continue;
                    }
                }
                if (part.count === 1 && nextPart.count === 1) {
                    const oldLine = part.value.replace(/\n$/, '');
                    const newLine = nextPart.value.replace(/\n$/, '');
                    
                    if (debug) console.log(`[DEBUG] Analyzing single modified line #${oldLineNum + 1} for intra-line diff...`);

                    const charPatch = CdiffCharService.createPatch(oldLine, newLine, oldLineNum + 1, debug);
                    const linePatch = [`${oldLineNum + 1} D ${oldLine}`, `${newLineNum + 1} A ${newLine}`];
                    
                    if (charPatch.length > 0 && charPatch.join('\n').length < linePatch.join('\n').length) {
                        if (debug) console.log(`[DEBUG] Choosing char patch for line.`);
                        cdiff.push(...charPatch);
                    } else {
                        if (debug) console.log(`[DEBUG] Choosing line patch for line.`);
                        cdiff.push(...linePatch);
                    }

                    oldLineNum++;
                    newLineNum++;
                    i++;
                    continue;
                }
                const removedValue = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
                const comparisonString = removedValue + '\n';

                if (debug) {
                    console.log(`[DEBUG] Comparing: nextPart.value.startsWith("${JSON.stringify(comparisonString)}")`);
                }

                if (nextPart.value.startsWith(comparisonString)) {
                    if (debug) {console.log('[DEBUG] PATTERN MATCHED!');}

                    const unchangedLineCount = removedValue.split('\n').length;
                    oldLineNum += unchangedLineCount;
                    newLineNum += unchangedLineCount;

                    const actualAddedValue = nextPart.value.substring(comparisonString.length);

                    if (actualAddedValue) {
                        const addedLines = actualAddedValue.split('\n');
                        const addedCount = addedLines.length;

                        if (addedCount > 2) {
                            cdiff.push(`${newLineNum + 1} A+ ${addedCount}`);
                            cdiff.push(...addedLines);
                        } else {
                            for (let j = 0; j < addedCount; j++) {
                                cdiff.push(`${newLineNum + j + 1} A ${addedLines[j]}`);
                            }
                        }
                        newLineNum += addedCount;
                    }

                    i++; 
                    continue;
                }
            }
            
            if (debug) {console.log('[DEBUG] No pattern. Standard processing.');}
            const value = part.value.replace(/\n$/, '');
            if (part.count === 0) {continue;}
            const lines = value.split('\n');
            const count = lines.length;

            if (part.added) {
                if (count > 2) {
                    cdiff.push(`${newLineNum + 1} A+ ${count}`);
                    cdiff.push(...lines);
                } else {
                    for (let j = 0; j < count; j++) {
                        cdiff.push(`${newLineNum + j + 1} A ${lines[j]}`);
                    }
                }
                newLineNum += count;
            } else if (part.removed) {
                if (count > 2) {
                    cdiff.push(`${oldLineNum + 1} D+ ${count}`);
                    cdiff.push(...lines);
                } else {
                    for (let j = 0; j < count; j++) {
                        cdiff.push(`${oldLineNum + j + 1} D ${lines[j]}`);
                    }
                }
                oldLineNum += count;
            } else {
                oldLineNum += count;
                newLineNum += count;
            }
        }
        if (debug) console.log('[DEBUG] createPatch finished.');
        return cdiff;
    }


    /**
     * Inverts a cdiff patch by swapping:
     * - 'A' ↔ 'D'
     * - 'A+' ↔ 'D+'
     * - 'a' ↔ 'd'
     * - 'a*' ↔ 'd*'
     *
     * @param cdiff The cdiff patch array to invert.
     * @param debug If true, logs detailed internal processing steps to the console.
     * @returns A new cdiff patch array that represents the reverse operation.
     *
     * @example <caption>Line-level inversion</caption>
     * const forwardPatch = ['2 D old line', '2 A new line'];
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['2 A old line', '2 D new line']
     *
     * @example <caption>Character-level inversion</caption>
     * const forwardPatch = ['1 d 6 1 x', '1 a 6 1 y'];
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['1 a 6 1 x', '1 d 6 1 y']
     * 
     * @example <caption>Grouped command inversion</caption>
     * const forwardPatch = ['5-10 a* 0 2 "  "'];
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['5-10 d* 0 2 "  "']
     *
     * @example <caption>Block inversion</caption>
     * const forwardPatch = ['2 D+ 2', 'line A', 'line B', '4 A+ 1', 'line C'];
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['2 A+ 2', 'line A', 'line B', '4 D+ 1', 'line C']
     */
    public static invertPatch(cdiff: string[], debug: boolean = false): string[] {
        if (debug) console.log('[DEBUG] Starting invertPatch...');
        const invertedCdiff: string[] = [];
        const blockRegex = /^(\d+)\s+([AD]\+)\s+(\d+)$/;
        const singleLineRegex = /^(\d+)\s+([AD])\s(.*)$/s;
        const charLineRegex = /^(\d+)\s+([ad])\s(.*)$/s;

        for (let i = 0; i < cdiff.length; i++) {
            const command = cdiff[i];
            if (debug) console.log(`[DEBUG] Inverting command #${i}: ${command}`);
            const blockMatch = command.match(blockRegex);
            const singleLineMatch = !blockMatch ? command.match(singleLineRegex) : null;
            const charLineMatch = !blockMatch && !singleLineMatch ? command.match(charLineRegex) : null;

            if (charLineMatch) {
                const [, lineNum, type, rest] = charLineMatch;
                const newType = type === 'a' ? 'd' : 'a';
                invertedCdiff.push(`${lineNum} ${newType} ${rest}`);
                continue;
            } else if (blockMatch) {
                const [, coordStr, type, countStr] = blockMatch;
                const count = parseInt(countStr, 10);
                const newType = type === 'A+' ? 'D+' : 'A+';

                invertedCdiff.push(`${coordStr} ${newType} ${countStr}`);
                if (debug) console.log(`[DEBUG] Inverted to: ${coordStr} ${newType} ${countStr}`);
                
                const contentBlock = cdiff.slice(i + 1, i + 1 + count);
                invertedCdiff.push(...contentBlock);
                i += count;
            } else if (singleLineMatch) {
                const [, lineNum, type, content] = singleLineMatch;
                const newType = type === 'A' ? 'D' : 'A';
                invertedCdiff.push(`${lineNum} ${newType} ${content}`);
                if (debug) console.log(`[DEBUG] Inverted to: ${lineNum} ${newType} ${content}`);
            }
        }
        if (debug) console.log('[DEBUG] invertPatch finished.');
        return invertedCdiff;
    }
    
}

/**
 * Compresses a sorted array of line numbers into a compact string format.
 * This is used to create efficient line ranges for grouped commands (`a*`/`d*`).
 * Consecutive numbers are collapsed into a "start-end" range.
 *
 * @param numbers A sorted array of unique numbers.
 * @returns A string representation of the numbers.
 * @version 1.2.0
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
 * The parser is designed to be robust and correctly handle content with multiple spaces.
 *
 * @param command A full character-level command for a single line.
 * @returns An array of strings, where each string is a single atomic operation.
 * @version 1.2.1
 * * @example
 * const command = '5 a 0 2 "  " 8 5 " more"';
 * const deconstructed = deconstructCharCommand(command);
 * // deconstructed is ['a 0 2 "  "', 'a 8 5 " more"']
 */
function deconstructCharCommand(command: string): string[] {
    const parts = command.split(' ');
    const type = parts[1];
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