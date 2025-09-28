import { diffChars, type Change } from 'diff';

/**
 * A specialized utility for creating, applying, and inverting character-level diffs for single strings.
 * It exclusively generates compact intra-line patches using 'd' (delete) and 'a' (add) commands.
 * @version 1.1.0
 */
export class CdiffCharService {

    /**
     * Compares two strings and generates a pure character-level cdiff patch.
     *
     * @param oldLine The original string.
     * @param newLine The new string.
     * @param lineNumber The line number for which the patch is being generated.
     * @param debug If true, logs internal processing steps to the console.
     * @returns An array of strings representing the character-level patch, or an empty array if strings are identical.
     */
    public static createPatch(
        oldLine: string,
        newLine: string,
        lineNumber: number,
        debug: boolean = false
    ): string[] {
        if (debug) console.log(`[CdiffCharService.createPatch] Starting for line ${lineNumber}`);
        const changes: Change[] = diffChars(oldLine, newLine);

        const deletions: { index: number; content: string }[] = [];
        const additions: { index: number; content: string }[] = [];

        let oldCharIndex = 0;
        let newCharIndex = 0;

        for (const part of changes) {
            const count = part.value.length;
            if (part.added) {
                if (debug) console.log(`[DEBUG] Found ADD at newIndex ${newCharIndex}: "${part.value}"`);
                additions.push({ index: newCharIndex, content: part.value });
                newCharIndex += count;
            } else if (part.removed) {
                if (debug) console.log(`[DEBUG] Found DEL at oldIndex ${oldCharIndex}: "${part.value}"`);
                deletions.push({ index: oldCharIndex, content: part.value });
                oldCharIndex += count;
            } else {
                oldCharIndex += count;
                newCharIndex += count;
            }
        }

        const charPatch: string[] = [];
        if (deletions.length > 0) {
            const delParts = deletions.map(d => `${d.index} ${d.content.length} ${d.content}`).join(' ');
            charPatch.push(`${lineNumber} d ${delParts}`);
        }
        if (additions.length > 0) {
            const addParts = additions.map(a => `${a.index} ${a.content.length} ${a.content}`).join(' ');
            charPatch.push(`${lineNumber} a ${addParts}`);
        }

        if (debug && charPatch.length > 0) {
            console.log(`[CdiffCharService.createPatch] Generated patch:`, charPatch);
        }

        return charPatch;
    }

    /**
     * Applies a character-level cdiff patch to a single string.
     *
     * @param originalLine The source string to which the patch will be applied.
     * @param patch An array of strings representing the 'd' and 'a' patch commands.
     * @param onWarning A callback function that receives warning messages.
     * @param debug If true, logs detailed internal processing steps to the console.
     * @returns The string after applying the patch.
     */
    public static applyPatch(
        originalLine: string,
        patch: string[],
        onWarning?: (message: string) => void,
        debug: boolean = false
    ): string {
        if (debug) console.log(`[CdiffCharService.applyPatch] Applying patch to: "${originalLine}"`);
        
        // Handle line-level patches first and exit.
        const lineDelCmd = patch.find(cmd => cmd.includes(' D '));
        const lineAddCmd = patch.find(cmd => cmd.includes(' A '));
        if (lineDelCmd || lineAddCmd) {
            if (lineDelCmd) {
                const expectedOld = lineDelCmd.substring(lineDelCmd.indexOf(' D ') + 3);
                if (originalLine !== expectedOld) {
                    const message = `Line-level patch mismatch. Expected "${expectedOld}", found "${originalLine}".`;
                    if (onWarning) onWarning(message); else console.warn(message);
                    return originalLine;
                }
            }
            return lineAddCmd ? lineAddCmd.substring(lineAddCmd.indexOf(' A ') + 3) : "";
        }
        
        const delCommandStr = patch.find(cmd => cmd.includes(' d '));
        const addCommandStr = patch.find(cmd => cmd.includes(' a '));

        const deletions: { index: number; length: number; content: string }[] = [];
        const additions = new Map<number, string>();

        // 1. Parse all operations reliably.
        if (delCommandStr) {
            let remainder = delCommandStr.substring(delCommandStr.indexOf(' d ') + 3);
            while (remainder.length > 0) {
                const parts = remainder.match(/^(\d+) (\d+) /);
                if (!parts) break;
                const index = parseInt(parts[1], 10);
                const length = parseInt(parts[2], 10);
                const headerLength = parts[0].length;
                const content = remainder.substring(headerLength, headerLength + length);
                
                deletions.push({ index, length, content });
                remainder = remainder.substring(headerLength + length).trimStart();
            }
        }
        
        if (addCommandStr) {
            let remainder = addCommandStr.substring(addCommandStr.indexOf(' a ') + 3);
            while (remainder.length > 0) {
                const parts = remainder.match(/^(\d+) (\d+) /);
                if (!parts) break;
                const index = parseInt(parts[1], 10);
                const length = parseInt(parts[2], 10);
                const headerLength = parts[0].length;
                const content = remainder.substring(headerLength, headerLength + length);
                additions.set(index, (additions.get(index) || '') + content);
                remainder = remainder.substring(headerLength + length).trimStart();
            }
        }
        
        // 2. Apply Deletions to create an intermediate state.
        const deletedIndices = new Set<number>();
        for (const del of deletions) {
            if (originalLine.substring(del.index, del.index + del.length) === del.content) {
                for (let i = 0; i < del.length; i++) {
                    deletedIndices.add(del.index + i);
                }
            } else {
                const message = `Character deletion mismatch at index ${del.index}.`;
                if (onWarning) onWarning(message); else console.warn(message);
            }
        }

        let intermediateLine = '';
        for (let i = 0; i < originalLine.length; i++) {
            if (!deletedIndices.has(i)) {
                intermediateLine += originalLine[i];
            }
        }

        // 3. Apply Additions to build the final string.
        let finalLine = '';
        let intermediateIndex = 0;
        let finalIndex = 0;
        
        const sortedAdditions = Array.from(additions.entries()).sort((a,b) => a[0] - b[0]);
        const additionsQueue = new Map(sortedAdditions);

        while(intermediateIndex < intermediateLine.length || additionsQueue.size > 0) {
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
                } else { // If intermediate is done but additions remain
                    const remaining = Array.from(additionsQueue.entries()).sort((a,b) => a[0] - b[0]);
                    for(const [index, content] of remaining) {
                        finalLine += content;
                    }
                    break;
                }
            }
        }
        return finalLine;
    }



    /**
     * Inverts a character-level cdiff patch.
     *
     * @param patch The patch array to invert.
     * @param debug If true, logs the inversion process.
     * @returns A new patch array that represents the reverse operation.
     */
    public static invertPatch(
        patch: string[],
        debug: boolean = false
    ): string[] {
        if (debug) console.log(`[CdiffCharService.invertPatch] Inverting patch:`, patch);
        
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
                default:
                    return command;
            }
        });

        if (debug) console.log(`[CdiffCharService.invertPatch] Inverted result:`, inverted);
        return inverted;
    }
}
