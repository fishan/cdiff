/**
 * @file cdiff_compress.ts
 * @description Implements a hybrid compression algorithm for "cdiff" patches.
 *
 * This file contains the logic for compressing and decompressing cdiff patches.
 * The compression strategy is hybrid, combining two main approaches:
 * 1.  **String Command Compression (CdiffStringCompressService):**
 * Uses a "Deduplicate + Seed/Extend/Mask" algorithm to find and replace
 * common substrings (fragments) within A/D/A+/D+ commands, replacing
 * them with "@variable" definitions.
 *
 * 2.  **Char Command Compression (CdiffCharCompressService):**
 * Finds and replaces common content chunks within fine-grained
 * char-level commands (a/d/a* / d*), replacing them with "@variable"
 * definitions.
 *
 * 3.  **Number Encoding:**
 * All decimal line numbers and character positions are encoded into
 * Base58 to save space.
 *
 * The main `CdiffCompressService` class orchestrates this process, separates
 * commands, merges the resulting dictionaries, and handles the final
 * patch assembly and decompression.
 */

/**
 * @internal
 * Global development flag. Set to `false` for production builds to
 * strip out verbose logging and warnings.
 */
const __DEV__ = false;


/**
 * @internal
 * The alphabet used for Base58 encoding.
 * Omits '0' (zero), 'O' (uppercase o), 'I' (uppercase i), and 'l' (lowercase L)
 * to avoid visual ambiguity.
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * @internal
 * A lookup map for fast Base58 decoding.
 * Maps each character in `BASE58_ALPHABET` to its numeric index.
 */
const BASE58_MAP = BASE58_ALPHABET.split('').reduce((map, char, index) => {
    map[char] = index;
    return map;
}, {} as { [char: string]: number });

/**
 * @internal
 * The base for Base58 encoding (the length of the alphabet).
 */
const BASE = BASE58_ALPHABET.length;

/**
 * Encodes a non-negative integer into a Base58 string.
 *
 * @param num - The number to encode.
 * @returns The Base58-encoded string.
 */
function encodeBase58(num: number): string {
    if (num === 0) return BASE58_ALPHABET[0];

    let encoded = '';
    while (num > 0) {
        const remainder = num % BASE;
        num = Math.floor(num / BASE);
        encoded = BASE58_ALPHABET[remainder] + encoded;
    }
    return encoded;
}

/**
 * Decodes a Base58 string back into an integer.
 *
 * @param encoded - The Base58 string to decode.
 * @returns The decoded number, or -1 if the input string contains invalid characters
 * or is not a valid string.
 */
function decodeBase58(encoded: string): number {
    if (!encoded || typeof encoded !== 'string') return -1; // Check for empty or invalid type

    let decoded = 0;
    let multi = 1;
    encoded = encoded.split('').reverse().join(''); // Process from the end

    for (let i = 0; i < encoded.length; i++) {
        const char = encoded[i];
        const digit = BASE58_MAP[char];

        if (digit === undefined) {
            // Error: invalid character
            return -1;
        }

        decoded += digit * multi;
        multi *= BASE;
    }

    return decoded;
}

/**
 * Describes the result of a decompression operation.
 */
export type DecompressResult = {
    /**
     * The decompressed, human-readable patch lines.
     */
    patch: string[];

    /**
     * A map where:
     * Key = The index of a line in the `patch` array (decompressed).
     * Value = The original line index from the compressed input patch.
     *
     * This is used to map validation errors or analysis from the
     * decompressed patch back to the original compressed file.
     */
    sourceMap: Map<number, number>;
};


/**
 * @internal
 * Handles the compression logic for "String Commands" (A, D, A+, D+, X, X+).
 * This logic is based on finding and replacing common multi-line or
 * single-line substrings using a "Deduplicate + Seed/Extend/Mask" algorithm.
 */
class CdiffStringCompressService {

    /**
     * Configuration for the string compression algorithm (v5).
     * @private
     */
    private static readonly COMPRESSION_CONFIG_V5 = {
        /** Minimum times a string must appear to be considered a duplicate. */
        minOccurrences: 2,
        /** Minimum length for a fragment to be included in the search. */
        minFragmentLengthForSearch: 1,
        /** Estimated overhead (in chars) for referencing a template (e.g., '@S1'). */
        referenceOverhead: 2,
        /** The minimum profit (chars saved) to justify creating a template. */
        profitThreshold: 16,
        /** The "seed" length for the initial fragment search. */
        seedLength: 12,
    };


    /**
     * Compresses A/D/A+/D+/X+ commands by finding optimal string fragments
     * to replace with variables.
     *
     * @param stringCommands - An array of lines corresponding to A/D/A+/D+/X+
     * commands (including their content).
     * @param debug - Flag to enable verbose logging.
     * @returns An object containing the found templates and the compressed commands.
     * @public
     */
    public static compressStringCommands(
        stringCommands: string[],
        debug: boolean
    ): { templates: Map<string, string>, compressedCommands: string[] } {

        if (stringCommands.length === 0) {
            return { templates: new Map(), compressedCommands: [] };
        }

        const allStrings = this.extractAllStrings(stringCommands);

        let templates: Map<string, string>;

        if (allStrings.length === 0) {
            // No content found (e.g., only X+ commands), but applyTemplates
            // must still be called to handle their pass-through.
            templates = new Map();
        } else {
            // Use the "Deduplicate + Seed/Extend/Mask" algorithm
            templates = this.findOptimalFragments(allStrings, debug);
        }

        // Ensure templates are always applied, even if no new ones were found,
        // to process pass-through commands (e.g., 'X+').
        const compressedCommands = this.applyTemplates(
            stringCommands,
            templates,
            debug
        );

        return { templates, compressedCommands };
    }


    /**
     * Extracts all content strings from A/D/A+/D+ commands.
     * X/X+ commands are parsed but do not contribute content strings.
     *
     * @param stringCommands - The array of string-based commands.
     * @param debug - Flag for verbose logging.
     * @returns An array of all content strings found.
     * @private
     */
    private static extractAllStrings(stringCommands: string[], debug?: boolean): string[] {
        const strings: string[] = [];
        let i = 0;

        // Regex updated to support X/X+
        const blockRegex = /^(\d+)\s+([ADX]\+)\s+(\d+)$/s;
        const singleLineRegex = /^(\d+)\s+([ADX])\s(.*)$/s;

        while (i < stringCommands.length) {
            const line = stringCommands[i];

            const blockMatch = line.match(blockRegex);
            if (blockMatch) {
                const type = blockMatch[2]; // A+, D+, X+
                const count = parseInt(blockMatch[3], 10);

                // X+ blocks have no content lines
                if (type === 'X+') {
                    i += 1; // Skip only the header
                    continue;
                }

                let linesAdded = 0;
                for (let j = 1; j <= count; j++) {
                    if (i + j >= stringCommands.length) {
                        break; // End of file
                    }

                    const nextLine = stringCommands[i + j];

                    // Check if the next line is actually a new command header.
                    // This prevents consuming commands as content inside a malformed block.
                    if (CdiffCompressService.commandHeaderRegex.test(nextLine)) {
                        if (__DEV__ && debug) console.warn(`[extractAllStrings] Detected command header ("${nextLine}") inside block ${line}. Stopping content collection.`);
                        break;
                    }

                    strings.push(nextLine);
                    linesAdded++;
                }
                i += (linesAdded + 1); // +1 for the header
                continue;
            }

            const singleMatch = line.match(singleLineRegex);
            if (singleMatch) {
                // 'X' commands have empty content (''), but we must add it
                // to ensure allStrings.length > 0 if only X commands exist.
                strings.push(singleMatch[3]);
                i++;
                continue;
            }
            i++;
        }
        return strings;
    }

    /**
     * Implements the "Deduplicate + Seed/Extend/Mask" algorithm to find
     * the most profitable string fragments for templating.
     *
     * 1.  Deduplicate: Finds and templates full-line duplicates that are profitable.
     * 2.  Seed: Finds all common substrings of `seedLength` from the remaining strings.
     * 3.  Extend: Extends seeds left and right to find maximal common fragments.
     * 4.  Find All: Collects all profitable extended fragments.
     * 5.  Sort: Sorts candidates by profit (highest first).
     * 6.  Filter Best: Selects the best non-overlapping fragments using a mask.
     *
     * @param allStrings - An array of all content strings to search within.
     * @param debug - Flag for verbose logging.
     * @returns A Map where Key = content string, Value = temporary template ID (e.g., "_S0").
     * @private
     */
    private static findOptimalFragments(
        allStrings: string[],
        debug: boolean
    ): Map<string, string> {
        const { minOccurrences, referenceOverhead, profitThreshold, minFragmentLengthForSearch, seedLength } = CdiffStringCompressService.COMPRESSION_CONFIG_V5;

        const stringFrequency = new Map<string, number>();
        const stringsForSearch: string[] = [];
        const finalTemplates = new Map<string, string>(); // <Content, TempID>
        let nextId = 0;

        // 0.1: Count frequency
        for (const str of allStrings) {
            if (str.length >= minFragmentLengthForSearch) {
                stringFrequency.set(str, (stringFrequency.get(str) || 0) + 1);
            }
        }

        // 0.2: Extract profitable duplicates, send others to the search pool
        for (const [str, k] of stringFrequency.entries()) {
            if (k >= minOccurrences) {
                const L = str.length;
                const profit = (k - 1) * L - k * referenceOverhead;

                if (profit > profitThreshold) {
                    const varName = `_S${nextId++}`;
                    finalTemplates.set(str, varName);
                    if (__DEV__ && debug) {
                        console.log(`  [FindStr_v16.0] DEDUP: ${varName} = "${str.substring(0, 30)}..." (L=${L}, k=${k}, P=${profit})`);
                    }
                } else {
                    // Not profitable enough, send to search pool
                    for (let i = 0; i < k; i++) {
                        stringsForSearch.push(str);
                    }
                }
            } else {
                // Not a duplicate, send to search pool
                stringsForSearch.push(str);
            }
        }

        if (__DEV__ && debug) console.log(`[FindStr_v16.0] START. Initial pool size: ${allStrings.length}. Deduplicated: ${finalTemplates.size}. Search pool size: ${stringsForSearch.length}`);

        if (stringsForSearch.length < minOccurrences) {
            if (__DEV__ && debug) console.log(`[FindStr_v16.0] END. Not enough strings left for search.`);
            return finalTemplates;
        }

        // Map<Seed, Locations[]>
        const seedStats = new Map<string, { strIdx: number; pos: number }[]>();

        if (__DEV__ && debug) console.log(`\n[FindStr_v16.0] Seeding (L=${seedLength})...`);

        for (let strIdx = 0; strIdx < stringsForSearch.length; strIdx++) {
            const text = stringsForSearch[strIdx];

            for (let pos = 0; pos <= text.length - seedLength; pos++) {
                // (Masks are not checked here)
                const seed = text.substring(pos, pos + seedLength);

                if (!seedStats.has(seed)) {
                    seedStats.set(seed, []);
                }
                seedStats.get(seed)!.push({ strIdx, pos });
            }
        }
        if (__DEV__ && debug) console.log(`[FindStr_v16.0] Found ${seedStats.size} unique seeds.`);


        const allCandidates: { fragment: string; locations: { strIdx: number; pos: number }[]; profit: number; k: number; L: number; }[] = [];

        if (__DEV__ && debug) console.log(`[FindStr_v16.0] Extending seeds...`);

        for (const [seed, locations] of seedStats.entries()) {
            if (locations.length < minOccurrences) continue;

            // Perform "Extend" (without masks)
            const { fragment, finalLocations } = this.extendSeed_v16_0(stringsForSearch, locations, seedLength, debug);

            const L = fragment.length;
            const k = finalLocations.length;

            if (L < minFragmentLengthForSearch || k < minOccurrences) continue;

            const profit = (k - 1) * L - k * referenceOverhead;

            if (profit > profitThreshold) {
                allCandidates.push({ fragment, locations: finalLocations, profit, k, L });
            }
        }

        seedStats.clear(); // Free memory

        if (__DEV__ && debug) console.log(`[FindStr_v16.0] Found ${allCandidates.length} candidates. Sorting by profit...`);
        allCandidates.sort((a, b) => {
            if (a.profit !== b.profit) {
                return b.profit - a.profit; // Highest profit first
            }
            return b.L - a.L; // Then longest
        });

        const masks: boolean[][] = [];
        for (const text of stringsForSearch) {
            masks.push(new Array(text.length).fill(false));
        }

        if (__DEV__ && debug) console.log(`[FindStr_v16.0] Filtering and masking...`);

        let fragmentsFound = 0;
        for (const candidate of allCandidates) {
            let isOverlapped = false;

            // Check if *any* occurrence is overlapped
            for (const loc of candidate.locations) {
                if (this.isMasked(masks[loc.strIdx], loc.pos, candidate.L)) {
                    isOverlapped = true;
                    break;
                }
            }

            if (!isOverlapped) {
                // Profitable and not overlapped. Select it.
                const varName = `_S${nextId++}`;
                finalTemplates.set(candidate.fragment, varName);
                fragmentsFound++;

                // Apply mask
                for (const loc of candidate.locations) {
                    this.applyMask(masks[loc.strIdx], loc.pos, candidate.L);
                }

                if (__DEV__ && debug && fragmentsFound < 10) { // Log first 10
                    console.log(`   => SELECTED: ${varName} = "${candidate.fragment.substring(0, 30)}..." (L=${candidate.L}, k=${candidate.k}, P=${candidate.profit})`);
                }
            }
        } // end for candidates


        if (__DEV__ && debug) console.log(`[FindStr_v16.0] END. Found ${finalTemplates.size} templates (dedup + ${fragmentsFound} fragments).`);
        return finalTemplates;
    }

    /**
     * Helper: Checks if a range in a mask is already marked as true.
     *
     * @param mask - The boolean mask array.
     * @param pos - The starting position to check.
     * @param len - The length of the range to check.
     * @returns True if any part of the range is masked, false otherwise.
     * @private
     */
    private static isMasked(mask: boolean[], pos: number, len: number): boolean {
        for (let i = 0; i < len; i++) {
            if (mask[pos + i]) return true;
        }
        return false;
    }

    /**
     * Helper: Applies a mask by setting a range in the array to true.
     *
     * @param mask - The boolean mask array to modify.
     * @param pos - The starting position to apply the mask.
     * @param len - The length of the range to apply.
     * @private
     */
    private static applyMask(mask: boolean[], pos: number, len: number): void {
        for (let i = 0; i < len; i++) {
            if (pos + i < mask.length) {
                mask[pos + i] = true;
            }
        }
    }

    /**
     * Helper: Extends a "seed" (common substring) left and right across all its
     * locations in the `workPool` to find the maximal common fragment.
     * (This version does NOT check masks; used only during initial candidate collection).
     *
     * @param workPool - The array of strings to search in.
     * @param locations - The list of {strIdx, pos} where the seed was found.
     * @param seedLength - The length of the original seed.
     * @param debug - Flag for verbose logging.
     * @returns An object containing the final extended fragment and its new locations.
     * @private
     */
    private static extendSeed_v16_0(
        workPool: string[],
        locations: { strIdx: number; pos: number }[],
        seedLength: number,
        debug: boolean
    ): { fragment: string, finalLocations: { strIdx: number; pos: number }[] } {

        const baseLoc = locations[0];
        const strIdx0 = baseLoc.strIdx;
        const pos0 = baseLoc.pos; // Start of seed
        const text0 = workPool[strIdx0];

        let l_offset = 0; // How far we extended left
        let r_offset = 0; // How far we extended right

        while (true) {
            const checkPos0 = pos0 - l_offset - 1;
            if (checkPos0 < 0) {
                break; // Reached start of string
            }

            const char = text0[checkPos0];
            let allMatch = true;

            for (let i = 1; i < locations.length; i++) {
                const loc = locations[i];
                const checkPosN = loc.pos - l_offset - 1;

                if (checkPosN < 0 ||
                    workPool[loc.strIdx][checkPosN] !== char) {
                    allMatch = false;
                    break;
                }
            }

            if (!allMatch) {
                break; // Mismatch found
            }
            l_offset++; // All matched, extend
        }

        const seedEnd = pos0 + seedLength;
        while (true) {
            const checkPos0 = seedEnd + r_offset;
            if (checkPos0 >= text0.length) {
                break; // Reached end of string
            }

            const char = text0[checkPos0];
            let allMatch = true;

            for (let i = 1; i < locations.length; i++) {
                const loc = locations[i];
                const checkPosN = loc.pos + seedLength + r_offset;

                if (checkPosN >= workPool[loc.strIdx].length ||
                    workPool[loc.strIdx][checkPosN] !== char) {
                    allMatch = false;
                    break;
                }
            }

            if (!allMatch) {
                break; // Mismatch found
            }
            r_offset++; // All matched, extend
        }

        const finalStart = pos0 - l_offset;
        const finalEnd = pos0 + seedLength + r_offset;
        const fragment = text0.substring(finalStart, finalEnd);

        // Final locations are [strIdx, pos] of the *fragment* (not the seed)
        const finalLocations = locations.map(loc => ({
            strIdx: loc.strIdx,
            pos: loc.pos - l_offset
        }));

        return { fragment, finalLocations };
    }

    /**
     * Applies the found templates (replacing content with variable IDs) to the
     * full list of string commands.
     *
     * This method handles the difference between block commands (A+/D+) and
     * single-line commands (A/D).
     *
     * - Inside blocks (A+/D+), content is replaced with its parametric form
     * (e.g., `#B8 ... @S1 ...`) or left as a raw literal if no templates matched.
     * - Single-line A/D commands are converted to 'a'/'d' (parametric) or
     * kept as 'A'/'D' (literal).
     *
     * @param stringCommands - The original list of string commands.
     * @param templates - The map of <Content, TempID> to apply.
     * @param debug - Flag for verbose logging.
     * @returns A new array of commands with content replaced by templates.
     * @private
     */
    private static applyTemplates(
        stringCommands: string[],
        templates: Map<string, string>,
        debug: boolean
    ): string[] {

        const compressedCommands: string[] = [];
        const sortedTemplates = Array.from(templates.entries())
            .sort((a, b) => b[0].length - a[0].length);

        let i = 0;
        const blockRegex = /^(\d+)\s+([ADX]\+)\s+(\d+)$/;
        const singleLineRegex = /^(\d+)\s+([AD])\s(.*)$/s;
        const singleXRegex = /^(\d+)\s+(X)\s(.*)$/s;

        while (i < stringCommands.length) {
            const line = stringCommands[i];

            const blockMatch = line.match(blockRegex);
            if (blockMatch) {
                const type = blockMatch[2] as 'A+' | 'D+' | 'X+';
                const count = parseInt(blockMatch[3], 10);
                const lineNum = parseInt(blockMatch[1], 10);

                // Add block header
                compressedCommands.push(line);

                if (type === 'X+') {
                    i += 1; // Skip only the header
                    continue;
                }

                for (let j = 0; j < count; j++) {
                    if (i + j + 1 >= stringCommands.length) {
                        if (__DEV__ && debug) console.error(`[applyTemplates] Error: Unexpected end of file while processing block ${lineNum} ${type}+ ${count}`);
                        break;
                    }
                    const contentLine = stringCommands[i + j + 1];

                    if (contentLine === "") {
                        // Empty string
                        compressedCommands.push(``);
                        continue;
                    }

                    // Try to compress parametrically
                    const parametricCompressed = this.buildCompressedString_Parametric(contentLine, sortedTemplates, debug);

                    if (parametricCompressed === null || parametricCompressed === "") {
                        // Did not compress or is an empty string
                        // Send the raw content
                        compressedCommands.push(`${contentLine}`);
                    } else {
                        // Compressed parametrically.
                        // Send the compressed content (no 'a'/'d' prefix)
                        compressedCommands.push(`${parametricCompressed}`);
                    }
                }
                i += (count + 1);
                continue;
            }

            const singleMatch = line.match(singleLineRegex);
            if (singleMatch) {
                const lineNum = singleMatch[1]; // Decimal line number
                const type = singleMatch[2];     // 'A', 'D'
                const content = singleMatch[3]; // Content

                if (type === 'D') {
                    if (content === "") {
                        compressedCommands.push(`${lineNum} D `);
                    } else {
                        // Only parametric compression for D
                        const parametricCompressed = this.buildCompressedString_Parametric(content, sortedTemplates, debug);
                        if (parametricCompressed === null || parametricCompressed === "") {
                            compressedCommands.push(`${lineNum} D ${content}`); // No compression
                        } else {
                            compressedCommands.push(`${lineNum} d ${parametricCompressed}`); // Compressed to 'd ...'
                        }
                    }
                } else if (type === 'A') {
                    if (content === "") {
                        compressedCommands.push(`${lineNum} A `);
                    } else {
                        // For A, try both simple and parametric
                        const simpleCompressed = this.buildCompressedString_Simple(content, sortedTemplates);
                        const parametricCompressedA = this.buildCompressedString_Parametric(content, sortedTemplates, debug);

                        if (parametricCompressedA === null || parametricCompressedA === "") {
                            // If parametric failed, use original
                            compressedCommands.push(`${lineNum} A ${content}`);
                        }
                        // Choose the shorter format
                        else if (simpleCompressed !== null && simpleCompressed.length <= parametricCompressedA.length && /^((?:@[@\w\d]+))+$/.test(simpleCompressed)) {
                            // If simple succeeded, is shorter/equal, and is *only* variables
                            compressedCommands.push(`${lineNum} a ${simpleCompressed}`); // Compressed to 'a @0@1'
                        }
                        else {
                            // Otherwise, use parametric
                            compressedCommands.push(`${lineNum} a ${parametricCompressedA}`); // Compressed to 'a #..@..#..'
                        }
                    }
                }

                i++;
                continue;
            }

            const singleXMatch = line.match(singleXRegex);
            if (singleXMatch) {
                // X commands have no content to compress, just preserve them
                compressedCommands.push(line);
                i++;
                continue;
            }


            // Commands not related to A/D/A+/D+ (e.g., @-definitions from another stage)
            compressedCommands.push(line);
            i++;
        }

        return compressedCommands;

    }

    /**
     * Helper: Builds a parametric compressed string (e.g., '#<len> <literal>@<var>...').
     *
     * This format encodes literal segments of the string preceded by a Base58-encoded
     * length, and variable segments as `@<varName>`. It correctly calculates
     * literal length, accounting for special characters like '\t' (tab) as 2 chars.
     *
     * @param original - The original content string to compress.
     * @param sortedTemplates - A list of [content, tempID] pairs, sorted by
     * content length (descending).
     * @param debug - Flag for verbose logging.
     * @returns The parametrically compressed string, or `null` if no variables were used
     * (indicating the string should be stored as a literal).
     * @private
     */
    private static buildCompressedString_Parametric(
        original: string,
        sortedTemplates: [string, string][], // <Content, TempID>
        debug: boolean = false
    ): string | null { // Returns null if no variables were used
        let result = "";
        let lastIndex = 0;
        let variablesUsed = false; // Flag for variable usage

        if (__DEV__ && debug) console.log(`\n--- buildCompressedString_Parametric START for: "${original}" ---`);

        while (lastIndex < original.length) {
            let bestMatch: { index: number, name: string, len: number } | null = null;

            if (__DEV__ && debug) console.log(`  Loop start: lastIndex = ${lastIndex}`);

            // Find the *earliest* match of the *longest* template
            for (const [template, name] of sortedTemplates) {
                const i = original.indexOf(template, lastIndex);
                if (i !== -1) {
                    if (bestMatch === null || i < bestMatch.index || (i === bestMatch.index && template.length > bestMatch.len)) {
                        bestMatch = { index: i, name: name, len: template.length };
                    }
                }
            }

            if (bestMatch) {
                variablesUsed = true; // Set flag
                if (__DEV__ && debug) console.log(`    Best match found: ${bestMatch.name} at index ${bestMatch.index} (len: ${bestMatch.len})`);

                // Extract the "gap" (literal) BEFORE the found template
                const gapEndIndex = bestMatch.index;

                if (__DEV__ && debug) {
                    console.log(`      GAP indices: lastIndex=${lastIndex}, gapEndIndex=${gapEndIndex}`);
                }

                if (gapEndIndex > lastIndex) {
                    const gap = original.substring(lastIndex, gapEndIndex);
                    // Use helper to get tab-aware length
                    const actualGapLength = this.getLiteralLength_v11_5_1(gap);

                    if (__DEV__ && debug) {
                        console.log(`      GAP string: "${gap}"`);
                        console.log(`      GAP length (raw): ${gap.length}`);
                        console.log(`      GAP length (dec): ${actualGapLength}`);
                        if (gap.includes('\t')) {
                            console.warn(`      [v11.5.1] Tab detected. L_raw=${gap.length}, L_calc=${actualGapLength}. String: "${gap}"`);
                        }
                    }

                    if (actualGapLength > 0) {
                        // Encode length in Base58
                        const encodedLength = encodeBase58(actualGapLength);
                        // Use '#' as literal marker
                        result += `#${encodedLength} ${gap}`;
                        if (__DEV__ && debug) console.log(`      Appended to result: #${encodedLength} "${gap}"`);
                    } else if (gapEndIndex > lastIndex) {
                        console.error(`[buildCompressedString_Parametric] Error: Calculated gap length 0 for indices ${lastIndex}-${gapEndIndex}`);
                    }
                } else {
                    if (__DEV__ && debug) console.log(`      No gap before match (gapEndIndex=${gapEndIndex}, lastIndex=${lastIndex})`);
                }

                // Explicitly add '@' to avoid collisions
                result += '@' + bestMatch.name;
                if (__DEV__ && debug) console.log(`      Appended to result: @${bestMatch.name}`);
                lastIndex = bestMatch.index + bestMatch.len;
            } else {
                if (__DEV__ && debug) console.log(`    No more matches found.`);
                // No more templates, add the remainder
                if (lastIndex < original.length) {
                    const gap = original.substring(lastIndex);
                    // Use helper to get tab-aware length
                    const actualGapLength = this.getLiteralLength_v11_5_1(gap);

                    if (__DEV__ && debug) {
                        console.log(`      REMAINDER indices: lastIndex=${lastIndex}, end=${original.length}`);
                        console.log(`      REMAINDER string: "${gap}"`);
                        console.log(`      REMAINDER length (raw): ${gap.length}`);
                        console.log(`      REMAINDER length (dec): ${actualGapLength}`);
                        if (gap.includes('\t')) {
                            console.warn(`      [v11.5.1] Tab detected. L_raw=${gap.length}, L_calc=${actualGapLength}. String: "${gap}"`);
                        }
                    }

                    if (actualGapLength > 0) {
                        // Encode length in Base58
                        const encodedLength = encodeBase58(actualGapLength);
                        // Use '#' as literal marker
                        result += `#${encodedLength} ${gap}`;
                        if (__DEV__ && debug) console.log(`      Appended to result: #${encodedLength} "${gap}"`);
                    }
                }
                break; // Exit loop
            }
            if (__DEV__ && debug) console.log(`  Loop end: lastIndex updated to ${lastIndex}, current result: "${result}"`);
        }

        if (__DEV__ && debug) console.log(`--- buildCompressedString_Parametric END. Final result: "${result}", variablesUsed: ${variablesUsed} ---`);

        // If no variables were used, return null
        if (!variablesUsed) {
            return null;
        }

        return result.startsWith(' ') ? result.substring(1) : result;
    }


    /**
     * Helper: Builds a "simple" compressed string (e.g., 'a @var1@var2')
     * by doing a straightforward string replacement.
     *
     * @param original - The original content string.
     * @param sortedTemplates - A list of [content, tempID] pairs, sorted by
     * content length (descending).
     * @returns The compressed string (e.g., "@S1@S2"), or `null` if no
     * replacements were made.
     * @private
     */
    private static buildCompressedString_Simple(
        original: string,
        sortedTemplates: [string, string][] // <Content, TempID>
    ): string | null { // Returns null if no replacements
        let result = original;
        let variablesUsed = false;
        for (const [template, name] of sortedTemplates) {
            const escapedTemplate = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const newResult = result.replace(new RegExp(escapedTemplate, 'g'), name);
            if (newResult !== result) {
                variablesUsed = true;
                result = newResult;
            }
        }
        // If no replacements, return null
        return variablesUsed ? result : null;
    }

    /**
     * Helper: Calculates the "actual" length of a literal string for parametric
     * encoding. Counts '\t' (tab) as 2 characters and all other characters as 1.
     *
     * @param gap - The literal string fragment.
     * @returns The calculated length.
     * @private
     */
    private static getLiteralLength_v11_5_1(gap: string): number {
        let length = 0;
        let i = 0;

        while (i < gap.length) {
            if (gap[i] === '\t') {
                length += 2;
            } else {
                length += 1;
            }
            i++;
        }
        return length;
    }


}


/**
 * @internal
 * Handles the compression logic for "Char Commands" (a, d, x, e, a*, d*, x*).
 * This logic finds and replaces common content chunks specified in these
 * fine-grained commands.
 */
class CdiffCharCompressService {

    /**
     * Configuration for the Char Command compression algorithm (v2).
     * @private
     */
    private static readonly COMPRESSION_CONFIG_V2 = {
        /** Minimum length of a content chunk to be considered for templating. */
        minContentLength: 1,
        /** Minimum times a content chunk must appear to be templated. */
        minOccurrences: 2
    };

    /**
     * Main wrapper for compressing Char Commands.
     * 1. Extracts all unique content fragments from a/d/a* / d* commands.
     * 2. Finds profitable fragments to create templates for.
     * 3. Applies templates (e.g., 'pos@var') to the commands.
     * 4. Encodes all decimal character positions into Base58.
     *
     * @param charCommands - An array of lines corresponding to char-level commands.
     * @param debug - Flag to enable verbose logging.
     * @returns An object containing the found templates and the compressed commands.
     * @public
     */
    public static compressCharCommands(
        charCommands: string[],
        debug: boolean
    ): { templates: Map<string, string>, compressedCommands: string[] } {

        if (charCommands.length === 0) {
            return { templates: new Map(), compressedCommands: [] };
        }

        // 1. Extract content
        const allContent = this.extractAllContent_v2(charCommands, debug);

        // 2. Find templates
        const templates = this.findWhatToCompress_v2(allContent, debug); // <Content, TempID>

        // 3. Apply templates AND encode positions
        // This loop *must* run even if templates.size is 0
        // to ensure all char positions are encoded to Base58.
        const compressedCommands: string[] = [];
        for (const command of charCommands) {
            compressedCommands.push(
                this.compressCharCommand_v2(command, templates)
            );
        }

        return { templates, compressedCommands };
    }

    /**
     * Extracts all content fragments from char commands (a, d, e, a*, d*).
     * 'x' and 'x*' commands are skipped as they have no content.
     *
     * @param charCommands - The array of char-level commands.
     * @param debug - Flag for verbose logging.
     * @returns A Map where Key = content string, Value = frequency count.
     * @private
     */
    private static extractAllContent_v2(charCommands: string[], debug: boolean = false): Map<string, number> {
        const contentFrequency = new Map<string, number>();

        for (const line of charCommands) {
            // 'x' and 'x*' commands are parsed but have no content
            const type = line.split(' ')[1];
            if (type === 'x' || type === 'x*') {
                continue;
            }

            // Character commands (a, d, e, a*, d*)
            const contents = this.extractCharCommandContents_v2(line);
            contents.forEach(content => {
                contentFrequency.set(content, (contentFrequency.get(content) || 0) + 1);
            });
        }

        return contentFrequency;
    }

    /**
     * Parses a single char command line (a/d/a* / d*) and extracts its content fragments.
     * This is a complex parser designed to handle content that may contain spaces.
     *
     * @param line - The single char command line.
     * @returns An array of content strings found in the command.
     * @private
     */
    private static extractCharCommandContents_v2(line: string): string[] {
        const contents: string[] = [];
        const parts = line.split(' '); // Use split only to determine type

        const type = parts[1];
        if (type === 'a*' || type === 'd*') {
            // Use Regex for reliable parsing of a*/d*
            const match = line.match(/^([\d,-]+)\s+([ad]\*)\s+(\d+)\s+(\d+)\s(.*)$/s);
            if (match) {
                const length = parseInt(match[4], 10);
                const content = match[5]; // match[5] will capture the exact content

                if (content.length === length) {
                    contents.push(content);
                } else {
                    // if (__DEV__ && debug) console.warn(`[v11.1 extract] a*/d* content length mismatch: L=${length}, C="${content}"`);
                }
            }
            return contents;
        }

        if (type === 'x*') { // 'x*' has no content
            return contents;
        }

        if (type === 'x') { // 'x' has no content
            return contents;
        }

        if (type === 'e') { // 'e' content is not compressed
            return contents;
        }

        let i = 2;
        while (i < parts.length) {
            // Look for [index, length, content]
            if (/^\d+$/.test(parts[i]) && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
                const index = parts[i];
                const length = parseInt(parts[i + 1]);

                if (i + 2 < parts.length) {
                    const content = parts[i + 2];

                    if (content && content.length === length) {
                        // Fast path: Content without spaces (e.g., 'a 0 5 Hello')
                        contents.push(content);
                        i += 3;
                    } else {
                        // New logic: Forcibly join the rest of the string
                        const contentWithSpaces = parts.slice(i + 2).join(' ');

                        if (contentWithSpaces.length === length) {
                            // Case 1: 'a 0 49 ...v5'
                            // contentWithSpaces = '...v5' (length 49)
                            contents.push(contentWithSpaces);
                            i = parts.length; // Consume the rest of the line

                        } else if (contentWithSpaces.length > length) {
                            // Case 2: 'a 0 5 Hello 10 5 World'
                            // content = 'Hello' (len 5)
                            // contentWithSpaces = 'Hello 10 5 World' (len 17) > 5

                            // Check if 'content' (the first word) was correct
                            if (content.length === length) {
                                // This was 'a 0 5 Hello', followed by '10 5 World'
                                contents.push(content);
                                i += 3; // Move to '10'
                            } else {
                                // This was 'a 0 12 Hello World 10 5 World'
                                // contentWithSpaces = 'Hello World 10 5 World' (len 23)
                                // length = 12
                                const actualContent = contentWithSpaces.substring(0, length);

                                contents.push(actualContent);

                                // Correctly calculate offset
                                const partsConsumed = actualContent.split(' ').length;
                                i += 2 + partsConsumed;
                            }
                        } else {
                            // contentWithSpaces.length < length
                            // e.g. 'a 0 500 Hello World' (len 11 < 500)
                            // This is an invalid command, skip it.
                            i += 3;
                        }
                    }
                } else {
                    i++; // Error, but move on
                }
            } else {
                i++; // Not a triplet
            }
        }

        return contents;
    }



    /**
     * Finds profitable content fragments from the frequency map and
     * assigns them temporary template IDs (e.g., "_C0").
     *
     * @param contentFrequency - A Map of <Content, Frequency> from `extractAllContent_v2`.
     * @param debug - Flag for verbose logging.
     * @returns A Map where Key = content string, Value = temporary template ID.
     * @private
     */
    private static findWhatToCompress_v2(
        contentFrequency: Map<string, number>,
        debug: boolean = false
    ): Map<string, string> { // <Content, TempID>
        const contentToVar = new Map<string, string>();
        let nextId = 0;

        const allEntries = Array.from(contentFrequency.entries())
            .filter(([content, count]) =>
                content.length >= this.COMPRESSION_CONFIG_V2.minContentLength &&
                count >= this.COMPRESSION_CONFIG_V2.minOccurrences
            )
            .sort((a, b) => {
                // Sort by value: length * frequency
                const valueA = a[0].length * a[1];
                const valueB = b[0].length * b[1];
                return valueB - valueA;
            });

        for (const [content, count] of allEntries) {
            // Use '_C' prefix for char templates
            const varName = `_C${nextId++}`; // Temporary ID
            contentToVar.set(content, varName);

            if (__DEV__ && debug) {
                console.log(`[FindCharTemps_v2] Found: ${varName} -> "${content}" (k=${count})`);
            }
        }

        return contentToVar;
    }


    /**
     * Compresses a single char command line.
     * 1. Replaces content fragments with template IDs (e.g., 'pos len content' -> 'pos@var').
     * 2. Encodes all decimal positions (line numbers and char indices) to Base58.
     *
     * This parser is synchronized with `extractCharCommandContents_v2`.
     *
     * @param line - The original, uncompressed char command.
     * @param contentToVar - The map of <Content, TempID> to apply.
     * @returns The compressed char command string.
     * @private
     */
    private static compressCharCommand_v2(line: string, contentToVar: Map<string, string>): string {

        const parts = line.split(' ');
        const type = parts[1];

        // Handle 'a*' and 'd*'
        if (type === 'a*' || type === 'd*') {
            const match = line.match(/^([\d,-]+)\s+([ad]\*)\s+(\d+)\s+(\d+)\s(.*)$/s);
            if (match) {
                const range = match[1];
                const commandType = match[2];
                const index = match[3];
                const length = parseInt(match[4], 10);
                const content = match[5];

                // Check if content is valid AND in the dictionary
                if (content.length === length && contentToVar.has(content)) {
                    const encodedIndex = encodeBase58(parseInt(index, 10));
                    return `${range} ${commandType} ${encodedIndex}@${contentToVar.get(content)!}`;
                } else {
                    // Not compressible, just encode index
                    const encodedIndex = encodeBase58(parseInt(index, 10));
                    return `${range} ${commandType} ${encodedIndex} ${length} ${content}`;
                }
            } else {
                return line; // Format error, return as is
            }
        }
        // Handle 'x*'
        else if (type === 'x*') {
            // Format: <range> x* <pos_dec> <len_dec>
            const match = line.match(/^([\d,-]+)\s+(x\*)\s+(.*)$/s);
            if (match) {
                const range = match[1];
                const commandType = match[2]; // x*
                let rest = match[3]; // <pos_dec> <len_dec>

                const parts = rest.split(' ');
                if (parts.length === 2) {
                    const encodedIndex = encodeBase58(parseInt(parts[0], 10));
                    const length = parts[1]; // Length remains decimal
                    return `${range} ${commandType} ${encodedIndex} ${length}`;
                }
            }
            return line; // Format error
        }

        // Handle 'e' (equals)
        if (type === 'e') {
            const result: string[] = [parts[0], parts[1]]; // [lineNum_dec, e]
            let i = 2;

            // 'e' commands are not compressed, just B58-encoded
            // (Parser logic synchronized with extractor)
            while (i < parts.length) {
                if (/^\d+$/.test(parts[i]) && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
                    const index_dec_str = parts[i];
                    const length = parseInt(parts[i + 1]);
                    const index_b58 = encodeBase58(parseInt(index_dec_str, 10));

                    if (i + 2 < parts.length) {
                        const content = parts[i + 2];
                        let actualContent: string;
                        let partsConsumed: number;

                        if (content && content.length === length) {
                            actualContent = content;
                            partsConsumed = 3;
                        } else {
                            const contentWithSpaces = parts.slice(i + 2).join(' ');
                            if (contentWithSpaces.length === length) {
                                actualContent = contentWithSpaces;
                                partsConsumed = parts.length - i;
                            } else if (contentWithSpaces.length > length) {
                                if (content.length === length) {
                                    actualContent = content;
                                    partsConsumed = 3;
                                } else {
                                    actualContent = contentWithSpaces.substring(0, length);
                                    const actualPartsConsumed = actualContent.split(' ').length;
                                    partsConsumed = 2 + actualPartsConsumed;
                                }
                            } else {
                                actualContent = contentWithSpaces;
                                partsConsumed = parts.length - i;
                            }
                        }

                        // 'e' commands do not use dictionary, just B58 encode
                        result.push(index_b58, length.toString(), actualContent);
                        i += partsConsumed;

                    } else {
                        // Truncated command (e.g., '1 e 10 5')
                        result.push(index_b58, length.toString());
                        i += 2;
                    }
                } else {
                    // Not a triplet, or single index
                    if (/^\d+$/.test(parts[i])) {
                        const index_b58 = encodeBase58(parseInt(parts[i], 10));
                        result.push(index_b58);
                    } else {
                        result.push(parts[i]);
                    }
                    i++;
                }
            }
            return result.join(' ');
        }

        // Handle 'x' (unsafe)
        if (type === 'x') {
            const result: string[] = [parts[0], parts[1]];
            let i = 2;
            // Format: <pos_dec> <len_dec>
            while (i < parts.length) {
                if (/^\d+$/.test(parts[i]) && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
                    const index_dec_str = parts[i];
                    const length_str = parts[i + 1];
                    const index_b58 = encodeBase58(parseInt(index_dec_str, 10));
                    result.push(index_b58, length_str);
                    i += 2;
                } else {
                    i++; // Error
                }
            }
            return result.join(' ');
        }

        const result: string[] = [parts[0], parts[1]];
        let i = 2;

        while (i < parts.length) {
            // Look for [index, length, content]
            if (/^\d+$/.test(parts[i]) && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
                const index_dec_str = parts[i];
                const length = parseInt(parts[i + 1]);

                // Encode position immediately
                const index_b58 = encodeBase58(parseInt(index_dec_str, 10));

                if (i + 2 < parts.length) {
                    const content = parts[i + 2];
                    let actualContent: string;
                    let partsConsumed: number;

                    if (content && content.length === length) {
                        // [FIX 1] Fast path: Content without spaces
                        actualContent = content;
                        partsConsumed = 3;

                    } else {
                        // [FIX 2] Space-joining logic
                        const contentWithSpaces = parts.slice(i + 2).join(' ');

                        if (contentWithSpaces.length === length) {
                            // [FIX 2.1] Case 1: 'a 0 49 ...v5'
                            actualContent = contentWithSpaces;
                            partsConsumed = parts.length - i; // Consume rest

                        } else if (contentWithSpaces.length > length) {
                            // [FIX 2.2] Case 2: 'a 0 5 Hello 10 5 World' OR 'a 0 49 ...v5 10 5 ...'

                            if (content.length === length) {
                                // [FIX 2.2.a] 'a 0 5 Hello'
                                actualContent = content;
                                partsConsumed = 3;
                            } else {
                                // [FIX 2.2.b] 'a 0 12 Hello World ...'
                                actualContent = contentWithSpaces.substring(0, length);
                                const actualPartsConsumed = actualContent.split(' ').length;
                                partsConsumed = 2 + actualPartsConsumed;
                            }

                        } else {
                            // [FIX 3] contentWithSpaces.length < length
                            // Invalid command (e.g., 'a 0 500 Hello World')
                            actualContent = contentWithSpaces;
                            partsConsumed = parts.length - i;
                        }
                    }

                    // Unified template application logic
                    if (contentToVar.has(actualContent)) {
                        // Compact format: [index@tempID]
                        result.push(index_b58 + "@" + contentToVar.get(actualContent)!);
                    } else {
                        // Old format: [index, length, content]
                        result.push(index_b58, length.toString(), actualContent);
                    }
                    i += partsConsumed;

                } else {
                    // Truncated command
                    result.push(index_b58);
                    i++;
                }
            } else {
                result.push(parts[i]); // Not a triplet
                i++;
            }
        }

        return result.join(' ');
    }



}


/**
 * Main orchestrator class for Cdiff compression and decompression.
 *
 * This class coordinates the `CdiffStringCompressService` and
 * `CdiffCharCompressService` to produce a final compressed patch. It also
 * contains the complete logic for decompressing the patch back into its
 * original form.
 *
 * @export
 */
export class CdiffCompressService {

    /**
     * Magic flag added to the beginning of a compressed patch (line 0).
     * Used by `isCompressed()` to identify compressed cdiffs.
     * @public
     * @static
     */
    public static readonly COMPRESSION_FLAG = '~';

    /**
     * Separator line used in compressed patches.
     * All lines *before* this separator are `@variable` definitions.
     * All lines *after* this separator are the compressed commands.
     * @public
     * @static
     */
    public static readonly DEFINITIONS_SEPARATOR = '$';

    /**
     * A regex used to identify the start of *any* cdiff command header.
     * This is crucial for correctly parsing blocks (A+/D+) and ensuring
     * that a line of content inside a block is not accidentally parsed
     * as a new command.
     *
     * Matches:
     * - `@...` (Definition)
     * - `NNN A+ ...` (Block headers)
     * - `NNN A ...` (Single line commands)
     * - `NNN a ...` (Char commands)
     * - `N,N-N a* ...` (Char group commands)
     * @public
     * @static
     */
    public static readonly commandHeaderRegex = /^(@|(\d+)\s+([ADEX]\+?|[adex])\s|([\d,-]+)\s+([adx]\*)\s)/;

    /**
     * Encodes all decimal line numbers and ranges in a patch to Base58.
     * This is the final step of compression, applied *after* templates.
     *
     * @param patch - The compressed patch with decimal line numbers.
     * @param debug - Flag for verbose logging.
     * @returns A new patch array with all line numbers and ranges Base58-encoded.
     * @public
     * @static
     */
    public static encodeLineNumbers(patch: string[], debug: boolean): string[] {
        const result: string[] = [];
        const rangeRegex = /^([\d,-]+)(\s+[adx]\*\s.*)$/s;
        // Include 'E' and 'e' for line number encoding
        const lineNumRegex = /^(\d+)(\s(?:[ADEX]\+?\s.*|[adex]\s.*))$/s;

        for (const line of patch) {
            if (line.startsWith('@')) {
                result.push(line);
                continue;
            }

            const rangeMatch = line.match(rangeRegex);
            if (rangeMatch) {
                const rangeStr = rangeMatch[1];
                const restOfCommand = rangeMatch[2];
                const encodedRange = this.encodeLineRange(rangeStr, debug);
                result.push(encodedRange + restOfCommand);
                continue;
            }

            // A/D/E/X and a/d/e/x commands are matched here
            const lineNumMatch = line.match(lineNumRegex);
            if (lineNumMatch) {
                const lineNum = parseInt(lineNumMatch[1]);
                const restOfCommand = lineNumMatch[2];
                if (!isNaN(lineNum)) {
                    const encodedNum = encodeBase58(lineNum);
                    result.push(encodedNum + restOfCommand);
                    if (__DEV__ && debug && lineNumMatch[1] !== encodedNum) console.log(`  [encodeNum] ${lineNumMatch[1]} -> ${encodedNum}`);
                } else {
                    result.push(line);
                    if (__DEV__ && debug) console.warn(`[encodeNum] Failed to parse line number: ${line}`);
                }
                continue;
            }

            // Block content (A+/D+/E+)
            result.push(line);
        }
        return result;
    }

    /**
     * Helper: Decodes a Base58 line range (e.g., "3A-3C,3E") to
     * its decimal equivalent (e.g., "135-137,139").
     *
     * @param rangeStr_b58 - The Base58-encoded range string.
     * @param debug - Flag for verbose logging.
     * @returns The decoded decimal range string.
     * @private
     */
    private static decodeLineRange(rangeStr_b58: string, debug: boolean): string {
        const segments = rangeStr_b58.split(',');
        const decodedSegments: string[] = [];

        for (const segment of segments) {
            if (segment.includes('-')) {
                // It's a range (e.g., "3A-3C")
                const parts = segment.split('-');
                if (parts.length === 2) {
                    const startNum = decodeBase58(parts[0]);
                    const endNum = decodeBase58(parts[1]);
                    if (startNum !== -1 && endNum !== -1) {
                        decodedSegments.push(`${startNum}-${endNum}`);
                    } else {
                        if (__DEV__ && debug) console.warn(`[decodeRange] Error decoding B58 range: ${segment}`);
                        decodedSegments.push(segment); // Error, leave as is
                    }
                } else {
                    decodedSegments.push(segment); // Invalid range format
                }
            } else {
                // It's a single number (e.g., "3E")
                const num = decodeBase58(segment);
                if (num !== -1) {
                    decodedSegments.push(num.toString());
                } else {
                    if (__DEV__ && debug) console.warn(`[decodeRange] Error decoding B58 number: ${segment}`);
                    decodedSegments.push(segment); // Error, leave as is
                }
            }
        }

        return decodedSegments.join(',');
    }


    /**
     * Main compression function.
     * Orchestrates the entire compression pipeline:
     * 1. Separates patch into String, Char, and Other commands.
     * 2. Calls `CdiffStringCompressService` to compress string commands.
     * 3. Calls `CdiffCharCompressService` to compress char commands.
     * 4. Merges templates from both services and assigns final, optimized IDs (e.g., @0, @1, @A).
     * 5. Replaces temporary IDs in commands with final IDs.
     * 6. Aggregates consecutive commands (e.g., A/a) into blocks (A+).
     * 7. Assembles the final patch with definitions, separator, and commands.
     * 8. Encodes all line numbers to Base58.
     * 9. Adds the compression flag header.
     *
     * @param patch - The original, uncompressed patch array.
     * @param debug - Flag to enable verbose logging.
     * @returns A new array representing the fully compressed patch.
     * @public
     * @static
     */
    public static compress(patch: string[], debug: boolean = false): string[] {
        // Handle empty patch
        if (patch.length === 0) {
            return [CdiffCompressService.COMPRESSION_FLAG];
        }

        if (__DEV__ && debug) {
            console.log(`=== CdiffCompressService.compress (Hybrid) START ===`);
        }

        const { stringCommands, charCommands, otherCommands } = this.separateCommands(patch, debug);
        const { templates: stringTemplates, compressedCommands: compressedStrings } = CdiffStringCompressService.compressStringCommands(
            stringCommands,
            debug
        );
        const { templates: charTemplates, compressedCommands: compressedChars } = CdiffCharCompressService.compressCharCommands(
            charCommands,
            debug
        );

        const tempIDFrequency = new Map<string, number>();
        const { finalDefinitions, replacementMap } = this.assignFinalTemplateIDs(
            stringTemplates,
            charTemplates,
            tempIDFrequency,
            debug
        );
        const definitions: string[] = [];
        const sortedDefs = Array.from(finalDefinitions.entries())
            .sort((a, b) => {
                const idA = a[0].substring(1);
                const idB = b[0].substring(1);
                const numA = /^\d+$/.test(idA) ? parseInt(idA) : decodeBase58(idA);
                const numB = /^\d+$/.test(idB) ? parseInt(idB) : decodeBase58(idB);
                return numA - numB;
            });
        for (const [varNameB58, content] of sortedDefs) {
            definitions.push(`${varNameB58} ${content}`);
        }
        const finalCompressedStrings = this.applyFinalTemplateIDs(compressedStrings, replacementMap);
        const finalCompressedChars = this.applyFinalTemplateIDs(compressedChars, replacementMap);
        const commandsToAggregate = [
            ...finalCompressedStrings,
            ...finalCompressedChars
        ];
        const aggregatedCommands = this.aggregateCompressedCommands(
            commandsToAggregate,
            debug
        );

        // Assemble patch BEFORE encoding line numbers
        // Add separator '$' only if definitions OR commands exist
        const tempCompressedPatch = [...definitions];
        const commandsExist = aggregatedCommands.length > 0 || otherCommands.length > 0;
        if (definitions.length > 0 || commandsExist) {
            tempCompressedPatch.push(CdiffCompressService.DEFINITIONS_SEPARATOR);
            tempCompressedPatch.push(...aggregatedCommands, ...otherCommands);
        }

        // 8. Encode all line numbers to Base58
        const finalCompressedPatch = this.encodeLineNumbers(tempCompressedPatch, debug);

        if (__DEV__ && debug) {
            console.log(`[compress] Compression complete. Final Vars: ${definitions.length}`);
            console.log('=== CdiffCompressService.compress (Hybrid) END ===');
        }

        // Add magic flag header
        return [CdiffCompressService.COMPRESSION_FLAG, ...finalCompressedPatch];
    }


    /**
     * Decompresses a compressed patch string array.
     * 1. Reads the `@variable` definitions up to the `$` separator.
     * 2. Parses and decompresses all commands (A/D/a/d/A+/D+, etc.).
     * 3. Decodes all Base58-encoded line numbers and character positions.
     * 4. Re-inserts template content, handling both parametric (`#len..@var`)
     * and simple formats.
     * 5. Reconstructs blocks (A+/D+) from their compressed content lines.
     * 6. Generates a `sourceMap` to link decompressed lines to their
     * original compressed line number.
     *
     * @param patch - The compressed patch array (must include `~` header).
     * @param debug - Flag to enable verbose logging.
     * @returns A `DecompressResult` object containing the decompressed patch
     * and the source map.
     * @public
     * @static
     */
    public static decompress(patch: string[], debug: boolean = false): DecompressResult {
        const varToContent = new Map<string, string>();
        const result: string[] = [];
        const sourceMap = new Map<number, number>();

        // State for blocks
        let blockLinesToDecompress = 0;
        let inBlock = false;
        let currentBlockLineNum_dec = 0;
        let currentBlockHeader = "";
        let isFirstBlockLine = false;

        let commandStartIndex = 0;

        if (__DEV__ && debug) console.log(`[decompress] STARTING VARIABLE LOAD...`);
        let i_load = 0;
        for (; i_load < patch.length; i_load++) {
            const line = patch[i_load];

            // Skip header
            if (line.startsWith(CdiffCompressService.COMPRESSION_FLAG)) continue;

            // Look for separator
            if (line === CdiffCompressService.DEFINITIONS_SEPARATOR) {
                commandStartIndex = i_load + 1; // Commands start on *next* line
                if (__DEV__ && debug) console.log(`[decompress] Found DEFINITIONS_SEPARATOR at line ${i_load}.`);
                break; // Finish collection
            }

            // Process only lines starting with @
            if (line.startsWith('@')) {
                const firstSpaceIndex = line.search(/\s/);
                if (firstSpaceIndex > 0) {
                    const varName = line.substring(0, firstSpaceIndex);
                    const content = line.substring(firstSpaceIndex + 1);
                    varToContent.set(varName, content);
                    if (__DEV__ && debug) console.log(`[decompress] LOADED VAR: name="${varName}", content="${content}" (len: ${content.length})`);
                } else if (firstSpaceIndex === -1) { // line.startsWith('@') already true
                    varToContent.set(line, '');
                    if (__DEV__ && debug) console.log(`[decompress] LOADED VAR: name="${line}", content="" (len: 0)`);
                }
            } else {
                // Encountered something not @ (and not '$')
                if (__DEV__ && debug) console.warn(`[decompress] No DEFINITIONS_SEPARATOR found. Assuming legacy patch format.`);
                commandStartIndex = i_load; // Start parsing commands from this line
                break;
            }
        }

        if (commandStartIndex === 0 && i_load === patch.length) {
            if (__DEV__ && debug) console.warn(`[decompress] No DEFINITIONS_SEPARATOR found at end. Assuming legacy patch format.`);
            // Fix: if separator not found, but we reached the end,
            // find the first non-definition line to start parsing.
            if (commandStartIndex === 0) {
                commandStartIndex = patch.findIndex(l => !l.startsWith('@') && !l.startsWith(CdiffCompressService.COMPRESSION_FLAG));
                if (commandStartIndex === -1) commandStartIndex = i_load; // All lines are variables
            }
        }

        if (__DEV__ && debug) console.log(`[decompress] VARIABLE LOAD COMPLETE. Found ${varToContent.size} variables. Command index start: ${commandStartIndex}`);


        const base58_id = `[\\w\\d]+`;
        const base58_range = `[\\w\d,-]+`;
        const base58_len = `[\\w\\d]+`;

        // Regex
        const lineRegex_a_parametric = new RegExp(`^(${base58_id})\\s+a\\s+((?:@[\\w\\d]+|#${base58_len}\\s.*)+)$`, 's');
        const lineRegex_d_parametric = new RegExp(`^(${base58_id})\\s+d\\s+((?:@[\\w\\d]+|#${base58_len}\\s.*)+)$`, 's');
        const lineRegex_a_simple_v5 = new RegExp(`^(${base58_id})\\s+a\\s+0\\s+\\d+\\s+(.*)$`, 's');
        const lineRegex_a_simple_v7 = new RegExp(`^(${base58_id})\\s+a\\s+((?:@[\\w\\d]+)+)$`, 's');
        const lineRegex_block = new RegExp(`^(${base58_id})\\s+([ADEX]\\+)\\s+(\\d+)$`);
        const lineRegex_simple_AD = new RegExp(`^(${base58_id})\\s+([ADEX])\\s(.*)$`, 's');
        const lineRegex_char_v2_check = new RegExp(`^(${base58_id})\\s+([adex])\\s+(.*)$`, 's');
        const lineRegex_char_group_v2 = new RegExp(`^(${base58_range})\\s+([adx]\\*)\\s+(.*)$`, 's');

        if (__DEV__ && debug) console.log(`[decompress] STARTING PATCH DECOMPRESSION...`);
        // Start loop at commandStartIndex
        for (let i = commandStartIndex; i < patch.length; i++) {
            const line = patch[i];

            // Header and separator '$' already handled
            if (line.startsWith(CdiffCompressService.COMPRESSION_FLAG) || line === CdiffCompressService.DEFINITIONS_SEPARATOR) {
                if (__DEV__ && debug) console.log(`[DEBUG] Skipping header or separator line #${i}`);
                continue;
            }

            if (inBlock) {
                if (__DEV__ && debug) console.log(`[DEBUG] Decompressing block line #${i}: ${line}`);

                // Determine line type (v2 char, v5 literal, v5 parametric)
                let isV2CharLine = false;
                let isV2ContextLine = false;
                let isV5Literal = false;

                if (line.startsWith('a ') || line.startsWith('d ') || line.startsWith('x ') ||
                    line.startsWith('a\u00A0') || line.startsWith('d\u00A0') || line.startsWith('x\u00A0')) {
                    const lineContent = line.substring(2);
                    const firstChar = lineContent.length > 0 ? lineContent[0] : '';
                    if (firstChar !== '@' && firstChar !== '#') {
                        isV2CharLine = true;
                    }
                } else if (line.startsWith('e ') || line.startsWith('e\u00A0')) {
                    isV2ContextLine = true;
                } else if (line.startsWith('A ') || line.startsWith('D ') || line.startsWith('X ') ||
                    line.startsWith('A\u00A0') || line.startsWith('D\u00A0') || line.startsWith('X\u00A0')) {
                    isV5Literal = true;
                }
                // 'E+' (new format) has no prefix,
                // so it will fall into 'else' (NEW v5 literal)

                // Handle header (on first line)
                if (isFirstBlockLine) {
                    if (isV2CharLine || isV2ContextLine) {
                        // This block is a v2 (char) block, which doesn't use headers
                        if (__DEV__ && debug) console.log(`[DEBUG] First block line is v2 (char/context/unsafe). Suppressing header: ${currentBlockHeader}`);
                    } else {
                        // This is v5 (A+/D+/X+) OR v5 (E+)
                        if (__DEV__ && debug) console.log(`[DEBUG] First block line is v5 (A+/D+/E+). Pushing header: ${currentBlockHeader}`);
                        sourceMap.set(result.length, i - 1);
                        result.push(currentBlockHeader);
                    }
                    isFirstBlockLine = false;
                }

                // v2 (a/d/e/x)
                if (isV2CharLine || isV2ContextLine) {
                    if (__DEV__ && debug) console.log(`[DEBUG] Block line is OLD v2 (char/context/unsafe)`);
                    const fakeV2Command = `1 ${line}`; // '1' is a dummy line number
                    const decompressedV2 = this.replaceVariablesInCharCommand_v2(fakeV2Command, varToContent, debug);
                    const firstSpaceIndex = decompressedV2.indexOf(' ');
                    // Extract "a <pos> <len> <content>" or "x <pos> <len>"
                    const decompressedLine = (firstSpaceIndex !== -1) ? decompressedV2.substring(firstSpaceIndex + 1) : decompressedV2;
                    // Add real line number
                    sourceMap.set(result.length, i);
                    result.push(`${currentBlockLineNum_dec} ${decompressedLine}`);
                    currentBlockLineNum_dec++; // Increment for v2

                // v5 (A/D/X)
                } else if (isV5Literal) {
                    if (__DEV__ && debug) console.log(`[DEBUG] Block line is OLD v5 (literal)`);
                    const decompressedLine = line.substring(2); // "A content" -> "content", "X " -> ""
                    sourceMap.set(result.length, i);
                    result.push(decompressedLine);

                // v5 (a/d) - parametric
                } else if (line.startsWith('a ') || line.startsWith('d ') || line.startsWith('a\u00A0') || line.startsWith('d\u00A0')) {
                    if (__DEV__ && debug) console.log(`[DEBUG] Block line is OLD v5 (parametric)`);
                    const decompressedLine = this.decompressFragmentString_Parametric(line.substring(2), varToContent);
                    sourceMap.set(result.length, i);
                    result.push(decompressedLine);

                // v5 (New format, no prefix)
                } else {
                    // Distinguish parametric strings from pure literals
                    if (line.startsWith('@') || line.startsWith('#')) {
                        // This is a parametric string (e.g. '@S1' or '#B8...')
                        if (__DEV__ && debug) console.log(`[DEBUG] Block line is NEW v5 (parametric)`);
                        const decompressedLine = this.decompressFragmentString_Parametric(line, varToContent);
                        sourceMap.set(result.length, i);
                        result.push(decompressedLine);
                    } else {
                        // This is a pure literal (e.g. '// Prioritize #id over...')
                        if (__DEV__ && debug) console.log(`[DEBUG] Block line is NEW v5 (literal)`);
                        sourceMap.set(result.length, i);
                        result.push(line);
                    }
                }

                // End block
                blockLinesToDecompress--;
                if (blockLinesToDecompress === 0) {
                    inBlock = false;
                    if (__DEV__ && debug) console.log(`[DEBUG] Block end.`);
                    currentBlockLineNum_dec = 0;
                    currentBlockHeader = "";
                    isFirstBlockLine = false;
                }
                continue;
            }


            // Skip @var definitions (should be handled in Step 1, but as a safeguard)
            if (line.startsWith('@')) {
                if (__DEV__ && debug) console.warn(`[DEBUG] Skipping unexpected definition line in command section #${i}: ${line}`);
                continue;
            }

            // Look for A+/D+/E+/X+ block start
            const blockMatch = line.match(lineRegex_block);
            if (blockMatch) {
                const lineNum_b58 = blockMatch[1];
                currentBlockLineNum_dec = decodeBase58(lineNum_b58);
                const blockType = blockMatch[2] as 'A+' | 'D+' | 'E+' | 'X+';
                const count = blockMatch[3];
                currentBlockHeader = `${currentBlockLineNum_dec} ${blockType} ${count}`;

                if (blockType === 'X+') {
                    // X+ (unsafe) blocks have no content lines, push header immediately
                    if (__DEV__ && debug) console.log(`[DEBUG] Found block header X+ #${i}: ${line} -> ${currentBlockHeader}. Pushing header.`);
                    result.push(currentBlockHeader);
                    blockLinesToDecompress = 0;
                    inBlock = false;
                    isFirstBlockLine = false;
                    continue;
                }
                // A+/D+/E+ (safe) blocks have content lines
                if (__DEV__ && debug) console.log(`[DEBUG] Found block header ${blockType} #${i}: ${line} -> ${currentBlockHeader}. Storing header.`);

                blockLinesToDecompress = parseInt(count, 10);
                inBlock = blockLinesToDecompress > 0;
                isFirstBlockLine = true;
                continue;
            }

            if (__DEV__ && debug) console.log(`[DEBUG] Parsing command #${i}: ${line}`);

            // 1. Check a @...#... (v5/v7 parametric)
            const match_a_param = line.match(lineRegex_a_parametric);
            if (match_a_param) {
                const lineNum_b58 = match_a_param[1];
                const lineNum_dec = decodeBase58(lineNum_b58);
                const content = match_a_param[2];
                const decompressed = this.decompressFragmentString_Parametric(content, varToContent);
                result.push(`${lineNum_dec} A ${decompressed}`);
                continue;
            }

            // 2. Check d @...#... (v5 parametric)
            const match_d_param = line.match(lineRegex_d_parametric);
            if (match_d_param) {
                const lineNum_b58 = match_d_param[1];
                const lineNum_dec = decodeBase58(lineNum_b58);
                const content = match_d_param[2];
                const decompressed = this.decompressFragmentString_Parametric(content, varToContent);
                result.push(`${lineNum_dec} D ${decompressed}`);
                continue;
            }

            // 3. Check v2 (a/d/e/x/a*/d*/x*)
            const match_char_check = line.match(lineRegex_char_v2_check);
            const match_char_group_v2 = line.match(lineRegex_char_group_v2);
            if (match_char_check || match_char_group_v2) {
                const decompressedV2 = this.replaceVariablesInCharCommand_v2(line, varToContent, debug);
                sourceMap.set(result.length, i);
                result.push(decompressedV2);
                continue;
            }

            // 4. Check a 0 len ... (old v5, non-parametric)
            const match_a_v5 = line.match(lineRegex_a_simple_v5);
            if (match_a_v5) {
                const lineNum_b58 = match_a_v5[1];
                const lineNum_dec = decodeBase58(lineNum_b58);
                const decompressed = this.decompressFragmentString_Simple(line, varToContent);
                sourceMap.set(result.length, i);
                result.push(decompressed);
                continue;
            }

            // 5. Check a @...@ (old v7, variables only)
            const match_a_v7 = line.match(lineRegex_a_simple_v7);
            if (match_a_v7) {
                const lineNum_b58 = match_a_v7[1];
                const lineNum_dec = decodeBase58(lineNum_b58);
                const content = match_a_v7[2];
                const decompressed = this.decompressFragmentString_Simple(content, varToContent);
                sourceMap.set(result.length, i);
                result.push(`${lineNum_dec} A ${decompressed}`);
                continue;
            }

            // 6. Simple uncompressed A/D/E/X command (with B58)
            const simpleADMatch = line.match(lineRegex_simple_AD);
            if (simpleADMatch) {
                const lineNum_b58 = simpleADMatch[1];
                const lineNum_dec = decodeBase58(lineNum_b58);
                const commandType = simpleADMatch[2]; // 'A', 'D', 'E', 'X'
                const literalContent = simpleADMatch[3]; // Content (for X will be empty)
                if (__DEV__ && debug) console.log(`[DEBUG] Matched simple A/D/E/X. Content: "${literalContent}"`);
                sourceMap.set(result.length, i);
                result.push(`${lineNum_dec} ${commandType} ${literalContent}`);
                continue;
            }

            // 7. Unknown command
            if (__DEV__ && debug) console.warn(`[DEBUG] Unknown command format or unexpected content: ${line}`);
            sourceMap.set(result.length, i);
            result.push(line);
        }

        if (__DEV__ && debug) console.log(`[decompress] DECOMPRESSION COMPLETE.`);
        return { patch: result, sourceMap };
    }

    /**
     * Helper: Encodes decimal line ranges (e.g., "135-137,139") to
     * Base58 (e.g., "3A-3C,3E").
     *
     * @param rangeStr - The decimal range string.
     * @param debug - Flag for verbose logging.
     * @returns The Base58-encoded range string.
     * @private
     */
    private static encodeLineRange(rangeStr: string, debug: boolean): string {
        const segments = rangeStr.split(',');
        const encodedSegments: string[] = [];

        for (const segment of segments) {
            if (segment.includes('-')) {
                // It's a range (e.g., "135-137")
                const parts = segment.split('-');
                if (parts.length === 2) {
                    const startNum = parseInt(parts[0], 10);
                    const endNum = parseInt(parts[1], 10);
                    if (!isNaN(startNum) && !isNaN(endNum)) {
                        const encodedStart = encodeBase58(startNum);
                        const encodedEnd = encodeBase58(endNum);
                        encodedSegments.push(`${encodedStart}-${encodedEnd}`);
                        if (__DEV__ && debug) console.log(`  [encodeRange] ${startNum}-${endNum} -> ${encodedStart}-${encodedEnd}`);
                    } else {
                        encodedSegments.push(segment); // Parse error, leave as is
                    }
                } else {
                    encodedSegments.push(segment); // Invalid range format
                }
            } else {
                // It's a single number (e.g., "139")
                const num = parseInt(segment, 10);
                if (!isNaN(num)) {
                    const encodedNum = encodeBase58(num);
                    encodedSegments.push(encodedNum);
                    if (__DEV__ && debug) console.log(`  [encodeRange] ${num} -> ${encodedNum}`);
                } else {
                    encodedSegments.push(segment); // Parse error
                }
            }
        }

        return encodedSegments.join(',');
    }


    /**
     * Performs final aggregation of compressed commands.
     * Finds consecutive single-line commands (e.g., '10 a @1', '11 a @2')
     * and "gathers" them into blocks (e.g., '10 A+ 2', 'a @1', 'a @2').
     * This optimization supports A/a, D/d, and X/x aggregation.
     *
     * @param commands - The list of compressed commands (with decimal line numbers).
     * @param debug - Flag for verbose logging.
     * @returns A new array of commands with consecutive lines aggregated into blocks.
     * @private
     */
    private static aggregateCompressedCommands(
        commands: string[],
        debug: boolean
    ): string[] {
        const aggregated: string[] = [];
        let i = 0;

        // Regex for ANY A/a commands
        // 1: Line number, 2: Type (A or a), 3: Rest of command (can be empty)
        const ARegex = /^(\d+)\s+(A|a)(.*)$/s;
        // Regex for ANY D/d commands
        // 1: Line number, 2: Type (D or d), 3: Rest of command (can be empty)
        const DRegex = /^(\d+)\s+(D|d)(.*)$/s;
        // Regex for ANY X/x commands
        // 1: Line number, 2: Type (X or x), 3: Rest of command
        const XRegex = /^(\d+)\s+(X|x)(.*)$/s;


        while (i < commands.length) {
            const line = commands[i];

            let blockBuffer: string[] = [];
            let blockStartLine = -1;
            let lastLine = -1;
            let blockType: 'A' | 'D' | 'X' | null = null;
            let regex: RegExp | null = null;

            // 1. Check if this line can START an A block
            let match = line.match(ARegex);
            if (match) {
                blockType = 'A';
                regex = ARegex;
            } else {
                // 2. Check for D block
                match = line.match(DRegex);
                if (match) {
                    blockType = 'D';
                    regex = DRegex;
                } else {
                    // 3. Check for X block
                    match = line.match(XRegex);
                    if (match) {
                        blockType = 'X';
                        regex = XRegex;
                    }
                }
            }

            // 4. If it's not A/a/D/d/X/x (e.g., '1,5 a* ...' or '@...'),
            //    just add it and move on.
            if (!match || !regex || !blockType) {
                aggregated.push(line);
                i++;
                continue;
            }

            // 5. We found the start of a block. Start collecting.
            blockStartLine = parseInt(match[1]);
            lastLine = blockStartLine;
            const commandPart = line.substring(match[1].length).trimStart();
            blockBuffer.push(commandPart);

            let j = i + 1;
            for (; j < commands.length; j++) {
                const nextLine = commands[j];
                const nextMatch = nextLine.match(regex); // Look for the same type (A/a or D/d or X/x)

                if (!nextMatch) break; // Different command type, exit

                const nextLineNum = parseInt(nextMatch[1]);
                if (nextLineNum === lastLine + 1) {
                    // This is a consecutive line
                    const nextCommandPart = nextLine.substring(nextMatch[1].length).trimStart();
                    blockBuffer.push(nextCommandPart);
                    lastLine = nextLineNum;
                } else {
                    // Gap in line numbers
                    break;
                }
            }

            // 6. Finish collecting the block.
            if (blockBuffer.length > 1) {
                if (__DEV__ && debug) console.log(`[aggregate] Aggregated ${blockBuffer.length} lines (${blockType}) starting at ${blockStartLine}`);
                aggregated.push(`${blockStartLine} ${blockType}+ ${blockBuffer.length}`);

                // X/x commands have no content lines to push
                if (blockType !== 'X') {
                    aggregated.push(...blockBuffer);
                }

            } else {
                aggregated.push(commands[i]);
            }

            // 7. Move the main iterator
            i = j;
        }

        return aggregated;
    }



    /**
     * Assigns final, optimized IDs (@0, @1, @A...) to all unique templates
     * collected from both String and Char compression.
     *
     * The shortest content fragments are given the shortest IDs (e.g., @0, @1)
     * to maximize compression.
     *
     * @param stringTemplates - Map of <Content, TempID> from `CdiffStringCompressService`.
     * @param charTemplates - Map of <Content, TempID> from `CdiffCharCompressService`.
     * @param tempIDFrequency - (Not currently used) A map to track template frequency.
     * @param debug - Flag for verbose logging.
     * @returns An object containing:
     * - `finalDefinitions`: A Map of <FinalID, Content> (e.g., <"@0", "...">).
     * - `replacementMap`: A Map of <TempID, FinalID> (e.g., <"_S1", "@0">).
     * @private
     */
    private static assignFinalTemplateIDs(
        stringTemplates: Map<string, string>, // <Content, _S_ID>
        charTemplates: Map<string, string>,   // <Content, _C_ID>
        tempIDFrequency: Map<string, number>, // (Not currently used)
        debug: boolean
    ): { finalDefinitions: Map<string, string>, replacementMap: Map<string, string> } {

        // Step 1: Collect ALL unique content
        const allContent = new Set([...stringTemplates.keys(), ...charTemplates.keys()]);

        // Step 2: Sort content (shortest first)
        const sortedContent = Array.from(allContent)
            .sort((a, b) => {
                if (a.length !== b.length) {
                    return a.length - b.length; // Shortest first
                }
                return a.localeCompare(b); // Stable sort
            });

        if (__DEV__ && debug) {
            console.log(`[assignFinalTemplateIDs] Found ${sortedContent.length} unique templates.`);
        }

        // Step 3: Assign FinalID based on sorted content
        const contentToFinalID = new Map<string, string>(); // <Content, FinalID>
        const finalDefinitions = new Map<string, string>(); // <FinalID, Content>
        let nextId = 0; // Start at @0

        for (const content of sortedContent) {
            let finalIDString: string;
            // Use Base58 for IDs >= 10
            if (nextId < 10) {
                finalIDString = `@${nextId}`;
            } else {
                try {
                    finalIDString = `@${encodeBase58(nextId)}`; // e.g., @A, @B ...
                } catch (e) {
                    if (__DEV__ && debug) console.error(`[v9.6] Error encoding ID ${nextId} to Base58:`, e);
                    finalIDString = `@ERROR_${nextId}`; // Error handling
                }
            }

            contentToFinalID.set(content, finalIDString);
            finalDefinitions.set(finalIDString, content);
            nextId++;
        }

        // Step 4: Create the full replacementMap (TempID -> FinalID)
        const replacementMap = new Map<string, string>(); // <TempID, FinalID>

        // Add all _S* TempIDs
        for (const [content, tempID] of stringTemplates) { // tempID = _S0
            replacementMap.set(tempID, contentToFinalID.get(content)!);
        }
        // Add all _C* TempIDs
        for (const [content, tempID] of charTemplates) { // tempID = _C0
            replacementMap.set(tempID, contentToFinalID.get(content)!);
        }

        if (__DEV__ && debug && sortedContent.length > 0) {
            const lastNumericId = nextId - 1;
            const lastIdString = lastNumericId < 10 ? `@${lastNumericId}` : `@${encodeBase58(lastNumericId)}`;
            console.log(`[assignFinalTemplateIDs] Top 5 shortest get @0-@4. Last ID assigned: ${lastIdString} (for numeric ${lastNumericId})`);
            console.log(`[assignFinalTemplateIDs] Total entries in replacementMap: ${replacementMap.size}`);
        }

        return { finalDefinitions, replacementMap };
    }

    /**
     * Applies the final template IDs to the compressed commands.
     * Uses a single complex Regex and a replacer function to replace
     * all temporary IDs (e.g., _S0, _C1) with their final IDs (e.g., @0, @A)
     * in one pass.
     *
     * @param compressedCommands - The array of commands still using temporary IDs.
     * @param replacementMap - The map of <TempID, FinalID> from `assignFinalTemplateIDs`.
     * @returns A new array of commands with final IDs.
     * @private
     */
    private static applyFinalTemplateIDs(
        compressedCommands: string[],
        replacementMap: Map<string, string> // <TempID (_S* / _C*), FinalID (@*)>
    ): string[] {

        if (replacementMap.size === 0) {
            return compressedCommands;
        }

        // 1. Sort TempIDs by length (desc) for correct Regex matching
        const sortedTempIDs = Array.from(replacementMap.keys())
            .sort((a, b) => b.length - a.length);

        // 2. Escape TempIDs for Regex
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedTempIDs = sortedTempIDs.map(escapeRegex);

        // 3. Create Regex groups
        // Group 1: Standalone TempIDs (not preceded by @)
        const standaloneGroup = `(?<!@)(${escapedTempIDs.join('|')})`;
        // Group 2: TempIDs preceded by @
        const prefixedGroup = `(@(?:${escapedTempIDs.join('|')}))`; // Capture @ with the ID

        // 4. Build final Regex
        const megaRegex = new RegExp(`${standaloneGroup}|${prefixedGroup}`, 'g');

        // 5. Replacer function
        const replacer = (match: string, group1: string | undefined, group2: string | undefined): string => {
            if (group1) {
                // Matched Group 1 (standalone _S* / _C*)
                const tempID = group1;
                return replacementMap.get(tempID) || match; // Return FinalID or original match
            } else if (group2) {
                // Matched Group 2 (@_S* / @_C*)
                const tempIDWithPrefix = group2;
                const tempID = tempIDWithPrefix.substring(1); // Remove @
                return replacementMap.get(tempID) || match; // Return FinalID or original match
            }
            return match; // Failsafe
        };

        // 6. Apply replacement to all commands
        const finalCommands: string[] = [];
        for (let i = 0; i < compressedCommands.length; i++) {
            const line = compressedCommands[i];
            // Apply ONE replacement with the function
            const newLine = line.replace(megaRegex, replacer);
            finalCommands.push(newLine);
        }

        return finalCommands;
    }

    /**
     * Helper: Decompresses a parametric string (e.g., '#<len> <literal>@<var>...').
     *
     * This format is used for compressed string command content.
     * - Decodes Base58-encoded lengths (e.g., `#3A `).
     * - Correctly extracts literals, handling tab-aware lengths ('\t' = 2 chars).
     * - Replaces variable IDs (e.g., `@0`) with their content from the map.
     *
     * @param content - The compressed parametric string.
     * @param varToContent - The map of <FinalID, Content>.
     * @param debug - Flag for verbose logging.
     * @returns The fully decompressed string.
     * @private
     */
    private static decompressFragmentString_Parametric(
        content: string,
        varToContent: Map<string, string>,
        debug?: boolean
    ): string {
        let result = "";
        let i = 0;
        let hasMatches = false; // Flag if we found at least one @ or #

        // Greedy regex for variables
        const varRegex = /^(@[\w\d]+)/;
        // Regex for literals: '#' and a B58-encoded length
        const literalRegex = /^#([\w\d]+)\s/;

        while (i < content.length) {
            const char = content[i];
            const sub = content.substring(i);

            if (char === '@') {
                // --- Variable ---
                const varMatch = sub.match(varRegex);

                if (varMatch && varToContent.has(varMatch[1])) {
                    // Case 1: Found a valid variable
                    const varName = varMatch[1];
                    result += varToContent.get(varName) || '';
                    i += varName.length;
                    hasMatches = true;
                    continue;
                }
                // Case 2: @-token not in map or @ at end of string

            } else if (char === '#') {
                // --- Literal (#-block) ---
                const headerMatch = sub.match(literalRegex);
                if (headerMatch) {
                    // Decode B58-length
                    const len_b58 = headerMatch[1];
                    const len = decodeBase58(len_b58); // Expected length (e.g., 2 for #2 \t)
                    const headerLen = headerMatch[0].length; // Length of the header (e.g., 4 for "#2 ")

                    hasMatches = true;

                    // Check for B58 decoding error
                    if (len === -1) {
                        console.error(`[decompressFragmentString_Parametric] Error decoding B58 length: ${len_b58}`);
                        // Skip header to avoid infinite loop
                        result += sub.substring(0, headerLen); // Add header as a literal
                        i += headerLen;
                        continue;
                    }

                    // New literal parsing logic
                    let currentPos = i + headerLen;
                    let calculatedLen = 0;
                    let endPos = currentPos;

                    // Find end of literal, counting \t as 2
                    while (calculatedLen < len && endPos < content.length) {
                        const gapChar = content[endPos];
                        if (gapChar === '\t') {
                            calculatedLen += 2;
                        } else {
                            calculatedLen += 1;
                        }
                        endPos++;
                    }

                    // Extract the *actual* string slice
                    const gap = content.substring(currentPos, endPos);

                    // Additional check (if content ended prematurely)
                    if (calculatedLen < len && __DEV__ && debug) {
                        console.warn(`[decompressFragmentString_Parametric] Expected length #${len_b58} (dec ${len}), but found ${calculatedLen}. Content: "${gap}"`);
                    }

                    result += gap;

                    // Move pointer to the end of the slice
                    i = endPos;
                    continue;
                }
            }

            // If it's not #, OR it's an @ that wasn't in varToContent
            // (e.g., the first '@' in '@@fY'),
            // we must add this char to the result
            // and advance by 1.
            result += char;
            i++;
        }

        // If no @vars or #literals were found,
        // the entire 'content' string was a plain literal.
        if (!hasMatches) {
            return content;
        }

        return result;
    }


    /**
     * Helper: Decompresses a "simple" string (legacy 'a 0 len ...' format or 'a @1@2').
     *
     * This performs a basic string replacement of variable IDs with their content.
     * Sorts variables by length (descending) to prevent shorter vars from
     * replacing parts of longer ones (e.g., replacing "@1" inside "@10").
     *
     * @param line - The full command line (e.g., "10 a 0 5 @1@2" or just "@1@2").
     * @param varToContent - The map of <FinalID, Content>.
     * @returns The decompressed command or string.
     * @private
     */
    private static decompressFragmentString_Simple(
        line: string,
        varToContent: Map<string, string>
    ): string {

        // Check for 'a 0 len ...' format
        const match_a_v5 = line.match(/^(\d+\s+a\s+0\s+\d+\s+)(.*)$/s);
        let prefix = "";
        let contentToDecompress = line;

        if (match_a_v5) {
            prefix = match_a_v5[1]; // Store "NNN a 0 LLL "
            contentToDecompress = match_a_v5[2]; // Decompress only the content
        }

        let result = contentToDecompress;

        // Sort by LENGTH (long to short)
        const sortedVars = Array.from(varToContent.keys())
            .sort((a, b) => b.length - a.length);

        for (const varName of sortedVars) {
            const content = varToContent.get(varName)!;
            const escapedVarName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Replace only in the content part
            result = result.replace(new RegExp(escapedVarName, 'g'), content);
        }

        // Re-add prefix if it existed
        return prefix + result;
    }

    /**
     * Decompresses char commands (a/d/e/x and a* /d* /x*).
     * 1. Decodes Base58 line numbers and ranges.
     * 2. Decodes Base58 character positions.
     * 3. Replaces compact `pos@var` format with `pos len content`.
     * 4. Handles literal `pos len content` formats.
     * 5. Handles `x` (unsafe) and `x*` (unsafe group) commands separately.
     *
     * @param line - The compressed char command line.
     * @param varToContent - The map of <FinalID, Content>.
     * @param debug - Flag for verbose logging.
     * @returns The fully decompressed, human-readable char command.
     * @private
     */
    private static replaceVariablesInCharCommand_v2(line: string, varToContent: Map<string, string>, debug: boolean = false): string {

        // Regex for 'a', 'd', 'e', 'x'
        const fallbackRegex = /^([\w\d]+)\s+([adex])\s+(.*)$/s;
        const fallbackMatch = line.match(fallbackRegex);

        if (fallbackMatch) {
            const lineNum_b58 = fallbackMatch[1];
            const type = fallbackMatch[2]; // a, d, e, or x
            let rest = fallbackMatch[3]; // e.g. ' Gf@1 22 5...'

            const lineNum_dec = decodeBase58(lineNum_b58);

            const result: string[] = [`${lineNum_dec}`, type];

            let i = 0;

            // Regex for 'pos@var' (e.g. 'Gf@1')
            const posAtVarRegex = /^\s*([\w\d]+)(@[\w\d]+)/;
            // Regex for 'pos len' (e.g. ' Gf 5')
            const posLenRegex = /^\s*([\w\d]+)\s+(\d+)/;

            // Handle 'x' (unsafe char) separately
            if (type === 'x') {
                while (i < rest.length) {
                    const sub = rest.substring(i);
                    if (sub.trim().length === 0) break;

                    const fullMatch = sub.match(posLenRegex); // <pos_b58> <len_dec>
                    if (fullMatch) {
                        if (__DEV__ && debug) console.log(`[v18.1.0] Found 'pos len' for 'x': ${fullMatch[0].trim()}`);
                        const pos_b58 = fullMatch[1];
                        const lenStr = fullMatch[2];
                        const pos_dec = decodeBase58(pos_b58);

                        result.push(pos_dec.toString(), lenStr);
                        i += fullMatch[0].length;
                        continue;
                    }
                    if (__DEV__ && debug) console.warn(`[replaceVariablesInCharCommand_v2] Failed to parse 'rest' for 'x': "${sub}"`);
                    break;
                }
                return result.join(' ');
            }

            // Logic for 'a', 'd', 'e'
            while (i < rest.length) {
                const sub = rest.substring(i);

                if (sub.trim().length === 0) {
                    break;
                }

                // 1. Look for 'pos@var' (Only for a/d)
                // 'e' commands do not use templates
                if (type !== 'e') {
                    const compactMatch = sub.match(posAtVarRegex);
                    if (compactMatch) {
                        if (__DEV__ && debug) console.log(`[v12.0.0] Found 'pos@var': ${compactMatch[0].trim()}`);
                        const pos_b58 = compactMatch[1];
                        const varName = compactMatch[2];
                        const content = varToContent.get(varName) || '';
                        const len = content.length;

                        // Decode position
                        const pos_dec = decodeBase58(pos_b58);

                        result.push(pos_dec.toString(), len.toString(), content);
                        i += compactMatch[0].length;
                        continue;
                    }
                }

                // 2. Look for 'pos len content' (For a/d/e)
                const fullMatch = sub.match(posLenRegex); // e.g. ' Gf 5'
                if (fullMatch) {
                    if (__DEV__ && debug) console.log(`[v12.0.0] Found 'pos len': ${fullMatch[0].trim()}`);
                    const pos_b58 = fullMatch[1];
                    const lenStr = fullMatch[2];
                    const len = parseInt(lenStr, 10);

                    let headerLen = fullMatch[0].length;

                    // Look for start of content (skip one space)
                    if (rest.substring(i + headerLen, i + headerLen + 1) === ' ') {
                        headerLen += 1;
                    }

                    const contentStart = i + headerLen;

                    if (isNaN(len)) {
                        if (__DEV__ && debug) console.error(`[v12.0.0] Invalid len: ${lenStr}`);
                        break;
                    }

                    let actualContent = rest.substring(contentStart);

                    if (actualContent.length > len) {
                        actualContent = actualContent.substring(0, len);
                    }

                    // Decode position
                    const pos_dec = decodeBase58(pos_b58);

                    result.push(pos_dec.toString(), lenStr, actualContent);
                    i = contentStart + actualContent.length;
                    continue;
                }

                if (__DEV__ && debug) console.warn(`[replaceVariablesInCharCommand_v2] Failed to parse 'rest' "${sub}"`);
                // Could not parse, break
                break;
            }
            return result.join(' ');
        }


        // Regex for 'a*', 'd*', 'x*'
        const groupFallbackRegex = /^([\w\d,-]+)\s+([adx]\*)\s+(.*)$/s;
        const groupFallbackMatch = line.match(groupFallbackRegex);
        if (groupFallbackMatch) {
            const range_b58 = groupFallbackMatch[1];
            const type = groupFallbackMatch[2]; // a*, d*, x*
            let rest = groupFallbackMatch[3];
            const range_dec = this.decodeLineRange(range_b58, debug);

            const result: string[] = [`${range_dec}`, type];
            let i = 0;

            // 'x*' (unsafe): <pos_b58> <len_dec>
            if (type === 'x*') {
                const posLenRegex = /^\s*([\w\d]+)\s+(\d+)/;
                if (__DEV__ && debug) console.log(`[v18.1.0-G] Parsing 'x*' rest: "${rest}"`);
                const fullMatch = rest.match(posLenRegex);
                if (fullMatch) {
                    const pos_b58 = fullMatch[1];
                    const lenStr = fullMatch[2];
                    const pos_dec = decodeBase58(pos_b58);
                    result.push(pos_dec.toString(), lenStr);
                }
                return result.join(' ');
            }

            // 'a*' / 'd*' (safe)
            const posAtVarRegex = /^\s*([\w\d]+)(@[\w\d]+)/;
            const posLenRegex = /^\s*([\w\d]+)\s+(\d+)/;

            while (i < rest.length) {
                const sub = rest.substring(i);

                if (sub.trim().length === 0) {
                    break;
                }

                // 1. Look for 'pos@var'
                const compactMatch = sub.match(posAtVarRegex);
                if (compactMatch) {
                    if (__DEV__ && debug) console.log(`[v12.0.0-G] Found 'pos@var': ${compactMatch[0].trim()}`);
                    const pos_b58 = compactMatch[1];
                    const varName = compactMatch[2];
                    const content = varToContent.get(varName) || '';
                    const len = content.length;

                    // Decode position
                    const pos_dec = decodeBase58(pos_b58);

                    result.push(pos_dec.toString(), len.toString(), content);
                    i += compactMatch[0].length;
                    continue;
                }

                // 2. Look for 'pos len content'
                const fullMatch = sub.match(posLenRegex);
                if (fullMatch) {
                    if (__DEV__ && debug) console.log(`[v12.0.0-G] Found 'pos len': ${fullMatch[0].trim()}`);
                    const pos_b58 = fullMatch[1];
                    const lenStr = fullMatch[2];
                    const len = parseInt(lenStr, 10);

                    let headerLen = fullMatch[0].length;
                    if (rest.substring(i + headerLen, i + headerLen + 1) === ' ') {
                        headerLen += 1;
                    }
                    const contentStart = i + headerLen;

                    if (isNaN(len)) {
                        if (__DEV__ && debug) console.error(`[v12.0.0-G] Invalid len: ${lenStr}`);
                        break;
                    }

                    let actualContent = rest.substring(contentStart);
                    if (actualContent.length > len) {
                        actualContent = actualContent.substring(0, len);
                    }

                    // Decode position
                    const pos_dec = decodeBase58(pos_b58);

                    result.push(pos_dec.toString(), lenStr, actualContent);
                    i = contentStart + actualContent.length;
                    continue;
                }

                if (__DEV__ && debug) console.warn(`[replaceVariablesInCharCommand_v2-G] Failed to parse 'rest' "${sub}"`);
                break;
            }
            return result.join(' ');
        }

        // Nothing matched, return as is (unlikely)
        return line;
    }


    /**
     * Separates the input patch into three categories:
     * 1.  `stringCommands`: (A, D, A+, D+, X, X+) Handled by `CdiffStringCompressService`.
     * 2.  `charCommands`: (a, d, e, x, a*, d*, x*) Handled by `CdiffCharCompressService`.
     * 3.  `otherCommands`: (@, E, E+) Passed through without content compression
     * (though line numbers will be encoded).
     *
     * This method correctly handles multi-line blocks (A+/D+/E+), keeping
     * their content lines bundled with their headers in the correct array.
     *
     * @param patch - The original, uncompressed patch array.
     * @param debug - Flag for verbose logging.
     * @returns An object containing the three separated command arrays.
     * @private
     */
    private static separateCommands(patch: string[], debug: boolean = false) {
        const stringCommands: string[] = []; // A, D, A+, D+, X, X+
        const charCommands: string[] = [];   // a, d, e, x, a*, d*, x*
        const otherCommands: string[] = [];  // @, E, E+

        // Regex for block headers (A/D/E/X)
        const blockRegex = /^(\d+)\s+([ADEX]\+)\s+(\d+)$/;
        // Regex for single line commands (A/D/E/X)
        const singleRegex = /^\d+\s+[ADEX]\s/;
        // Regex for char commands (a/d/e/x) and char groups (a*/d*/x*)
        const charRegex = /^\d+\s+[adex]\s|^\S+\s+[adx]\*\s/;


        for (let i = 0; i < patch.length; i++) {
            const line = patch[i];

            if (line.startsWith('@')) {
                otherCommands.push(line);
                continue;
            }

            const blockMatch = line.match(blockRegex);
            if (blockMatch) {
                const blockType = blockMatch[2];
                const count = parseInt(blockMatch[3], 10);

                let targetArray: string[];

                // A+/D+/X+ -> stringCommands
                if (blockType === 'A+' || blockType === 'D+' || blockType === 'X+') {
                    targetArray = stringCommands;
                } else { // 'E+'
                    targetArray = otherCommands;
                }

                targetArray.push(line); // Add header

                // X+ (unsafe) has no content lines
                if (blockType === 'X+') {
                    if (__DEV__ && debug) console.log(`[separateCommands] Found 'X+' block, no content lines.`);
                    continue;
                }

                // A+/D+/E+ (safe) have content lines
                let linesAdded = 0;
                for (let j = 1; j <= count; j++) {
                    if (i + j >= patch.length) {
                        if (__DEV__ && debug) console.warn(`[separateCommands] Unexpected end of file while collecting block: ${line}`);
                        break;
                    }

                    const nextLine = patch[i + j];

                    // CRITICAL FIX: Check for command header
                    if (CdiffCompressService.commandHeaderRegex.test(nextLine)) {
                        if (__DEV__ && debug) console.warn(`[separateCommands] Detected command header ("${nextLine}") inside block ${line}. Stopping content collection.`);
                        break;
                    }

                    targetArray.push(nextLine);
                    linesAdded++;
                }

                i += linesAdded;
                continue;
            }

            // Handle A/D/X (for stringCommands) and E (for otherCommands)
            if (singleRegex.test(line)) {
                if (line.match(/^\d+\s+[ADX]\s/)) {
                    stringCommands.push(line);
                } else {
                    // This is 'E'
                    otherCommands.push(line);
                }
                continue;
            }

            // Handle a/d/e/x and a*/d*/x*
            if (charRegex.test(line)) {
                charCommands.push(line);
                continue;
            }

            otherCommands.push(line);
        }

        if (__DEV__ && debug) {
            console.log(`[separateCommands] string: ${stringCommands.length}, char: ${charCommands.length}, other: ${otherCommands.length}`);
        }

        return { stringCommands, charCommands, otherCommands };
    }


    /**
     * Checks if a patch (as a string array) is compressed by looking
     * for the magic header flag (`~`) on the first line.
     *
     * @param patch - The patch array to check.
     * @returns True if the patch starts with the compression flag, false otherwise.
     * @public
     * @static
     */
    public static isCompressed(patch: string[]): boolean {
        if (patch.length === 0) {
            return false;
        }

        // Check for the "magic" header
        return patch[0] === CdiffCompressService.COMPRESSION_FLAG;
    }

}