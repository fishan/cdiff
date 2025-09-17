import { diffLines, type Change } from 'diff';

/**
 * A utility for creating and applying compact, self-contained, single-coordinate deltas.
 * It supports both single-line (A, D) and block (A+, D+) commands.
 */
export class CdiffService {

    /**
     * Applies a cdiff patch to an original content string to produce the new content.
     *
     * @param originalContent The source content to which the patch will be applied.
     * @param cdiff An array of strings representing the cdiff patch commands.
     * @param strictMode If true, the function will throw an error on content mismatch. If false, it will issue a warning and skip the mismatched command.
     * @param onWarning A callback function that receives warning messages in non-strict mode.
     * @param debug If true, logs detailed internal processing steps to the console.
     * @returns The content after applying the patch.
     *
     * @example
     * const original = 'line 1\nline 3';
     * const cdiff = ['2 A line 2'];
     * const patched = CdiffService.applyPatch(original, cdiff);
     * // patched is now 'line 1\nline 2\nline 3'
     */
    public static applyPatch(
        originalContent: string,
        cdiff: string[],
        strictMode: boolean = false,
        onWarning?: (message: string) => void,
        debug: boolean = false
    ): string {
        if (debug) console.log('[DEBUG] Starting applyPatch...');
        originalContent = originalContent.replace(/\r\n|\r/g, '\n');
        const sourceLines = originalContent === '' ? [] : originalContent.split('\n');
        const deletions = new Set<number>();
        const additions = new Map<number, string[]>();

        const blockRegex = /^(\d+)\s+([AD]\+)\s+(\d+)$/;
        const singleLineRegex = /^(\d+)\s+([AD])\s(.*)$/s;

        for (let i = 0; i < cdiff.length; i++) {
            const command = cdiff[i];
            if (debug) console.log(`[DEBUG] Processing command #${i}: ${command}`);
            const blockMatch = command.match(blockRegex);
            const singleLineMatch = !blockMatch ? command.match(singleLineRegex) : null;

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
            } else {
                 if (debug) console.log(`[DEBUG] Command did not match any pattern. Ignoring.`);
            }
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
     * This is an alias for `applyPatch`.
     *
     * @param newContent The content that was the result of a forward patch.
     * @param invertedCdiff An inverted cdiff patch array.
     * @param strictMode If true, the function will throw an error on content mismatch.
     * @param onWarning A callback for warning messages in non-strict mode.
     * @param debug If true, logs detailed internal processing steps to the console.
     * @returns The restored original content.
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
     * Supports block operations and is optimized for newline changes.
     *
     * @param oldContent The original content string.
     * @param newContent The new content string.
     * @param debug If true, logs internal processing steps to the console.
     * @returns An array of strings representing the cdiff patch.
     *
     * @example
     * const oldContent = 'line 1\nold line\nline 3';
     * const newContent = 'line 1\nnew line\nline 3';
     * const patch = CdiffService.createPatch(oldContent, newContent);
     * // patch is ['2 D old line', '2 A new line']
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
     * Inverts a cdiff patch by swapping 'A' with 'D' and 'A+' with 'D+'.
     *
     * @param cdiff The cdiff patch array to invert.
     * @param debug If true, logs detailed internal processing steps to the console.
     * @returns A new cdiff patch array that represents the reverse operation.
     *
     * @example
     * const forwardPatch = ['2 D old line', '2 A new line'];
     * const invertedPatch = CdiffService.invertPatch(forwardPatch);
     * // invertedPatch is ['2 A old line', '2 D new line']
     */
    public static invertPatch(cdiff: string[], debug: boolean = false): string[] {
        if (debug) console.log('[DEBUG] Starting invertPatch...');
        const invertedCdiff: string[] = [];
        const blockRegex = /^(\d+)\s+([AD]\+)\s+(\d+)$/;
        const singleLineRegex = /^(\d+)\s+([AD])\s(.*)$/s;

        for (let i = 0; i < cdiff.length; i++) {
            const command = cdiff[i];
            if (debug) console.log(`[DEBUG] Inverting command #${i}: ${command}`);
            const blockMatch = command.match(blockRegex);
            const singleLineMatch = !blockMatch ? command.match(singleLineRegex) : null;

            if (blockMatch) {
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