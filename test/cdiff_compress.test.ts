/* [FILE: cdiff_compress.test.ts] - v17.3 (Tests for B58, $, blocks) */

import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffCompressService } from '../src/cdiff_compress.js';
import { CdiffOptions, CdiffService } from '../src/cdiff.js';

/**
 * Helper for E2E testing of the Compression -> Decompression cycle.
 * [v1.1.0] Added compression flag check.
 */
function assertCompressionE2E(
    title: string,
    originalPatch: string[],
    debug: boolean = false
) {
    if (debug) {
        console.log(`\n--- [Test START: ${title}] ---`);
        console.log('Original Patch:', originalPatch);
    }

    // 1. Compress
    const compressedPatch = CdiffCompressService.compress(originalPatch, debug);

    if (debug) {
        console.log('Compressed Patch:', compressedPatch);
    }

    // [v1.1.0] Verify that the flag is set (if patch is not empty)
    if (originalPatch.length > 0) {
        assert.strictEqual(
            compressedPatch[0],
            CdiffCompressService.COMPRESSION_FLAG,
            `[${title}] Compressed patch must contain flag '${CdiffCompressService.COMPRESSION_FLAG}'`
        );
    } else {
        // [v17.3] Empty patch compresses to ['~']
        assert.strictEqual(compressedPatch.length, 1, 'Empty patch must compress only to the flag');
        assert.strictEqual(compressedPatch[0], CdiffCompressService.COMPRESSION_FLAG);
    }

    // 2. Decompress
    const decompressedPatch = CdiffCompressService.decompress(compressedPatch, debug).patch;

    if (debug) {
        console.log('Decompressed Patch:', decompressedPatch);
    }

    // 3. Compare
    assert.deepStrictEqual(
        decompressedPatch,
        originalPatch,
        `E2E test "${title}" failed. Decompressed patch (${decompressedPatch.length} lines) does not match original (${originalPatch.length} lines).`
    );

    if (debug) {
        console.log(`--- [Test SUCCESS: ${title}] ---\n`);
    }
}

/**
 * [v18.0] Helper for E2E testing of the CdiffService.createPatch -> CdiffService.applyPatch cycle.
 * This is used to validate high-level option interactions (compress, validationLevel, etc.)
 */
function assertCreatePatchE2E(
    title: string,
    oldStr: string,
    newStr: string,
    options: CdiffOptions, // Use CdiffOptions from cdiff.ts
    debug: boolean = false
) {
    if (debug) {
        console.log(`\n--- [Test START: ${title}] ---`);
        console.log('Options:', options);
    }

    // 1. Create the patch
    // This step now INCLUDES compression AND internal validation (if specified in options)
    let generatedPatch: string[] = [];
    let createError: Error | null = null;
    try {
        generatedPatch = CdiffService.createPatch(oldStr, newStr, options);
    } catch (e) {
        createError = e as Error;
    }
    assert.strictEqual(createError, null, `[${title}] CdiffService.createPatch threw an error: ${createError?.message}`);
    
    // 2. Decompress (if compressed)
    // CdiffService.applyPatch handles decompression automatically.

    // 3. Apply and Verify
    let reconstructedStr: string = "";
    let applyError: Error | null = null;
    const applyOptions = { 
        strictMode: true, 
        // Ensure applyPatch can handle 'e' commands if they were generated
        includeCharEquals: options.includeCharEquals || options.includeEqualMode === 'context'
    };

    try {
        reconstructedStr = CdiffService.applyPatch(oldStr, generatedPatch, applyOptions);
    } catch (e) {
        applyError = e as Error;
    }

    // 4. Assert
    if (applyError || reconstructedStr !== newStr) {
            console.error(`\n--- TEST FAILED: ${title} ---`);
            console.error('Options:', options);
            console.error('Original Old:\n', oldStr);
            console.error('Original New:\n', newStr);
            console.error('Generated Patch:\n', generatedPatch);
            if (applyError) {
                console.error("Apply Error:", applyError.message);
            } else {
                console.error("Reconstructed String:\n", reconstructedStr);
            }
            console.error("-------------------\n");
    }
    
    assert.strictEqual(applyError, null, `[${title}] CdiffService.applyPatch threw an error: ${applyError?.message}`);
    assert.deepStrictEqual(reconstructedStr, newStr, `[${title}] E2E reconstruction failed.`);
    
    if (debug) {
        console.log(`--- [Test SUCCESS: ${title}] ---\n`);
    }
}

// [v17.3] Updated suite version
suite('CdiffCompressService: End-to-End Compression Cycle (v17.3)', () => {

    test('[E2E] should return an empty array for an empty patch', () => {
        const patch: string[] = [];
        // [v17.3] Call E2E helper for full verification
        assertCompressionE2E('Empty patch', patch);
    });

    test('[E2E] should not create definitions for a patch with no profitable repetitions', () => {
        const originalPatch = [
            '1 A line 1',
            '2 D line 2',
            '3 a 0 1 a',
            '4 d 0 1 b'
        ];

        const compressed = CdiffCompressService.compress(originalPatch, false);

        // [v17.3] The patch will be encoded in B58, get a flag and a '$' separator,
        // but should NOT contain @-definitions.
        assert.strictEqual(compressed[0], CdiffCompressService.COMPRESSION_FLAG, 'Missing compression flag');
        assert.strictEqual(compressed[1], CdiffCompressService.DEFINITIONS_SEPARATOR, 'Missing definitions separator');

        const definitions = compressed.slice(1, compressed.indexOf(CdiffCompressService.DEFINITIONS_SEPARATOR));
        assert.strictEqual(definitions.length, 0, "Patch without repetitions must not contain @-definitions");

        // Run E2E to ensure B58 encoding is reversible
        assertCompressionE2E('No Repetitions (B58 only)', originalPatch);
    });

    // --- Tests for String Commands (v5 / v16+ logic) ---

    suite('String Commands (v16+ Logic)', () => {

        test('[String v16 E2E] should compress and decompress repeated A+ blocks', () => {
            const patch = [
                '10 A+ 2',
                'common line 1',
                'common line 2',
                '50 A+ 2',
                'common line 1',
                'common line 2'
            ];
            // Expected result:
            // ~
            // @0 common line 1
            // @1 common line 2
            // $
            // B A+ 2  (10 -> B)
            // @0
            // @1
            // 1f A+ 2 (50 -> 1f)
            // @0
            // @1
            assertCompressionE2E('Repeated A+ Blocks (commandless content)', patch);
        });

        test('[String v16 E2E] should compress and decompress repeated D+ blocks', () => {
            const patch = [
                '10 D+ 2',
                'deleted common 1',
                'deleted common 2',
                '50 D+ 2',
                'deleted common 1',
                'deleted common 2'
            ];
            // Expected result (same as A+):
            // ~
            // @0 deleted common 1
            // @1 deleted common 2
            // $
            // B D+ 2
            // @0
            // @1
            // 1f D+ 2
            // @0
            // @1
            assertCompressionE2E('Repeated D+ Blocks (commandless content)', patch);
        });

        test('[String v16 E2E] should compress and decompress repeated single A/D lines', () => {
            const patch = [
                '10 A This is a unique common line A', // -> B a @0
                '20 D This is a unique common line D', // -> M d @1
                '30 A This is a unique common line A', // -> X a @0
                '40 D This is a unique common line D', // -> h d @1
            ];
            assertCompressionE2E('Repeated A/D Lines', patch);
        });

        test('[String v16 E2E] should handle parametric (d #...@...#...) decompression with gaps', () => {
            // [v1.1.0] Updated: 'C' replaced with '#'
            // [v17.3] Added B58 length check
            const patch = [
                '100 D prefix_common_fragment_suffix',
                '200 D prefix_common_fragment_suffix'
            ];
            // Expect compressor to find '@0 = common_fragment'
            // and generate 'd #7 prefix_@0#7 _suffix' -> 'd #7 prefix_@0#7 _suffix' (lengths 7 -> B58 '7')
            // B58 line nums: 100 -> '2k', 200 -> '4j'
            // ~
            // @0 common_fragment
            // $
            // 2k d #7 prefix_@0#7 _suffix
            // 4j d #7 prefix_@0#7 _suffix
            assertCompressionE2E('Parametric d #B58... gaps', patch);
        });

        test('[String v16 E2E] should handle simple (a @...) decompression (v7.2 format)', () => {
            const patch = [
                '100 A fragment1fragment2',
                '200 A fragment1fragment2'
            ];
            // Expect compressor to find '@0=fragment1', '@1=fragment2'
            // and generate 'a @0@1'
            // ~
            // @0 fragment1
            // @1 fragment2
            // $
            // 2k a @0@1
            // 4j a @0@1
            assertCompressionE2E('Simple a @...@ (v7 style)', patch);
        });
    });

    // --- Tests for Char Commands (v2) ---

    suite('Char Commands (v2 Logic)', () => {

        test('[Char v2 E2E] should compress and decompress repeated char insertions (a)', () => {
            // [v17.3] Added B58 position check
            const patch = [
                '10 a 5 7 content', // 10 -> B, 5 -> 6 (B58) -> B a 6@0
                '20 a 1 7 content'  // 20 -> M, 1 -> 2 (B58) -> M a 2@0
            ];
            assertCompressionE2E('Repeated (a) commands B58 pos', patch);
        });

        test('[Char v2 E2E] should compress and decompress repeated char deletions (d)', () => {
            // [v17.3] Added B58 position check
            const patch = [
                '10 d 5 7 content', // -> B d 6@0
                '20 d 1 7 content'  // -> M d 2@0
            ];
            assertCompressionE2E('Repeated (d) commands B58 pos', patch);
        });

        test('[Char v2 E2E] should correctly decompress (a index_B58@var) format', () => {
            // This test checks the full E2E cycle
            const patch = [
                '10 a 5 5 Hello', // -> B a 6@0
                '20 a 1 5 Hello'  // -> M a 2@0
            ];
            assertCompressionE2E('Decompress a indexB58@var', patch);
        });

        test('[Char v2 E2E] should correctly decompress (d index_B58@var) format', () => {
             // This test checks the full E2E cycle
            const patch = [
                '10 d 0 5 World', // -> B d 1@0
                '20 d 0 5 World'  // -> M d 1@0
            ];
            assertCompressionE2E('Decompress d indexB58@var', patch);
        });

        test('[Char v2 E2E] should compress and decompress a* or d* commands (v11.0 logic)', () => {
            // [v1.1.0] Logic v11+ COMPRESSES grouped command content
            // [v17.3] Verify B58 for range and pos
            const patch = [
                '1-5 a* 0 5 12345',  // range "1-5" -> "1-6" (B58), pos 0 -> 1 (B58) => "1-6 a* 1@0"
                '10-15 a* 0 5 12345' // range "10-15" -> "B-G" (B58), pos 0 -> 1 (B58) => "B-G a* 1@0"
            ];
            assertCompressionE2E('Grouped a*/d* commands B58 range/pos', patch);
        });

    });

    // --- Tests for hybrid compression ---

    suite('Hybrid Compression (v5 + v2)', () => {

        test('[Hybrid E2E] should correctly compress/decompress mixed commands', () => {
            const patch = [
                // v5
                '10 A common string line 1',
                '20 A common string line 1',
                // v2
                '30 a 0 12 char_content',
                '40 a 5 12 char_content',
            ];
            assertCompressionE2E('Hybrid v5 string + v2 char', patch);
        });

        test('[Hybrid E2E] should correctly prioritize and merge templates', () => {
            const commonContent = "This is a very long string used in both v2 and v5";
            assert.strictEqual(commonContent.length, 49, 'Internal test error: commonContent length is not 49');

            const originalPatch = [
                // v5
                '10 A ' + commonContent,
                '20 D ' + commonContent,
                // v2
                '30 a 0 49 ' + commonContent, // pos 0
                '40 d 5 49 ' + commonContent  // pos 5
            ];

            const compressed = CdiffCompressService.compress(originalPatch, false);

            // 1. Check structure and template
            assert.strictEqual(compressed[0], CdiffCompressService.COMPRESSION_FLAG, 'Missing flag');
            assert.strictEqual(compressed[1], `@0 ${commonContent}`, 'Incorrect or missing definition');
            assert.strictEqual(compressed[2], CdiffCompressService.DEFINITIONS_SEPARATOR, 'Missing separator');

            const finalID = '@0';
            const b58_10 = 'B'; // 10 -> B
            const b58_20 = 'M'; // 20 -> M
            const b58_30 = 'X'; // 30 -> X
            const b58_40 = 'h'; // 40 -> h
            const b58_pos_0 = '1'; // 0 -> 1
            const b58_pos_5 = '6'; // 5 -> 6

            // 2. Check commands
            const expectedCommands = [
                `${b58_10} a ${finalID}`,
                `${b58_20} d ${finalID}`,
                `${b58_30} a ${b58_pos_0}${finalID}`,
                `${b58_40} d ${b58_pos_5}${finalID}`
            ];

            const actualCommands = compressed.slice(3); // Commands after '$'
            assert.deepStrictEqual(actualCommands.sort(), expectedCommands.sort(), 'Compressed commands do not match expected');

            // 3. E2E test
            assertCompressionE2E('Hybrid template merging (v17)', originalPatch);
        });

    });

    // --- Regression tests (v11.8.1+) ---

    suite('Regression Tests (v11.8+)', () => {

        test('[Regression v11.8.1] should handle JSDoc @param bug', () => {
            const commonPart = '{String|Object} configOrUrl';
            const patch = [
                '10 A+ 4',
                ` * @param ${commonPart}`, // Line 1
                ` * @return {Promise}`,     // Line 2 (not compressed)
                ` * @param ${commonPart}`, // Line 3 (repeat of line 1)
                ` * @other ${commonPart}`  // Line 4 (different @, but shared content)
            ];
            // Expect compression/decompression to pass correctly
            assertCompressionE2E('JSDoc @param bug (v11.8.1+)', patch);
        });

        test('[Regression v11.8.1] should handle literal @ and # in content', () => {
            const commonEmail = 'user@example.com';
            const commonColor = '#FFFFFF';
            const patch = [
                '10 A+ 4',
                `Email: ${commonEmail}`, // Line 1
                `Color: ${commonColor}`, // Line 2
                `Email: ${commonEmail}`, // Line 3 (repeat 1)
                `Color: ${commonColor}`  // Line 4 (repeat 2)
            ];
            // Expect compression/decompression to pass correctly
            assertCompressionE2E('Literal @ and # symbols in content (v11.8.1+)', patch);
        });

        test('[JSDoc Fail v11.8.15] should reproduce @return bug correctly now', () => {
            const commonPart = " {Axios} A new instance of Axios";
            const patch = [
                '10 A+ 2',
                ` * @return${commonPart}`,
                ` * @return${commonPart}`
            ];
            // Expect compression/decompression to pass correctly since v12+
            assertCompressionE2E('JSDoc @return fail fixed (v11.8.15+)', patch, false);
        });

        test('[JSDoc Fail v11.8.15] should reproduce @param bug correctly now', () => {
            const commonPart = " {String|Object} configOrUrl The config specific for this request (merged with this.defaults)";
            const patch = [
                '10 A+ 2',
                ` * @param${commonPart}`,
                ` * @param${commonPart}`
            ];
            // Expect compression/decompression to pass correctly since v12+
            assertCompressionE2E('JSDoc @param fail fixed (v11.8.15+)', patch, false);
        });

        test('[BugFix E2E v12+] should correctly handle D+ block with empty string', () => {
            const patch = [
                '10 D+ 3',
                'line 1',
                '', // Empty line
                'line 3',
            ];
            // Expect compression/decompression to pass correctly
            assertCompressionE2E('D+ with empty string (v12+)', patch);
        });

        test('[BugFix E2E v12+] should correctly handle A+ block with empty string', () => {
            const patch = [
                '10 A+ 3',
                'line 1',
                '', // Empty line
                'line 3',
            ];
            // Expect compression/decompression to pass correctly
            assertCompressionE2E('A+ with empty string (v12+)', patch);
        });

    });

   // --- Tests for Decompressor / isCompressed ---

    suite('Decompressor Standalone (v11.8+)', () => {

        test('[isCompressed v11.8.0] should return true only for patches with COMPRESSION_FLAG', () => {
            assert.strictEqual(CdiffCompressService.isCompressed(['~']), true, 'Failed on ~ flag');
            assert.strictEqual(CdiffCompressService.isCompressed(['~', '@0 test', '$']), true, 'Failed on ~ flag + def + sep');
            assert.strictEqual(CdiffCompressService.isCompressed(['~', '$', 'B a @0']), true, 'Failed on ~ flag + sep + command');
        });

        test('[isCompressed v11.8.0] should return false for uncompressed or empty patches', () => {
            assert.strictEqual(CdiffCompressService.isCompressed([]), false, 'Failed on empty patch');
            assert.strictEqual(CdiffCompressService.isCompressed(['@0 test']), false, 'Failed on @ definition (no flag)');
            assert.strictEqual(CdiffCompressService.isCompressed(['$']), false, 'Failed on separator only (no flag)');
            assert.strictEqual(CdiffCompressService.isCompressed(['1 A line 1']), false, 'Failed on A command (no flag)');
            assert.strictEqual(CdiffCompressService.isCompressed(['B d #7 @0']), false, 'Failed on d # @ (no flag)');
            assert.strictEqual(CdiffCompressService.isCompressed(['B a 1@0']), false, 'Failed on a (v2) command (no flag)');
        });

    });

    // --- [v18.0] Tests for Hybrid Scenarios (Compress + Options) ---

suite('CdiffService.createPatch: Hybrid Option Interactions (v18.0)', () => {
    
    // Test data for hybrid scenarios
    const oldStr = [
        'common line A', // E
        'delete me (safe)', // D
        'common line B', // E
        'delete me (unsafe)', // X
        'common line C', // E
        'line to modify', // d/a
        'common line D' // E
    ].join('\n');
    
    const newStr = [
        'common line A', // E
        'common line B', // E
        'common line C', // E
        'line was modified', // d/a
        'common line D' // E
    ].join('\n');

    test('[Hybrid E2E] compress + unsafe + inline + validation', () => {
        const options: CdiffOptions = {
            compress: true,
            deletionStrategy: (content, lineNum) => {
                return content.includes('unsafe') ? 'unsafe' : 'safe';
            },
            includeEqualMode: 'inline',
            validationLevel: 'all-invert', // Test validation logic
            debug: false // Set to true to see validation logs
        };
        
        // This test proves that all 4 complex options can work together
        // and still produce a functionally correct patch.
        assertCreatePatchE2E(
            'Hybrid (Compress + Unsafe + Inline + Validation)',
            oldStr,
            newStr,
            options
        );
    });
    
    test('[Hybrid E2E] compress + safe + context + validation', () => {
        const options: CdiffOptions = {
            compress: true,
            deletionStrategy: 'safe', // Use 'safe'
            includeEqualMode: 'context', // Use 'context'
            includeContextLines: 1,
            validationLevel: 'all-invert', // Test validation logic
            debug: false 
        };
        
        // This test checks a different combination
        assertCreatePatchE2E(
            'Hybrid (Compress + Safe + Context + Validation)',
            oldStr,
            newStr,
            options
        );
    });

    test('[Hybrid E2E] compress + unsafe + separate', () => {
        const options: CdiffOptions = {
            compress: true,
            deletionStrategy: 'unsafe',
            includeEqualMode: 'separate', // Use 'separate'
            debug: false
        };
        
        // This test proves that the '$$EQUAL$$' separator
        // correctly co-exists with a compressed patch.
        assertCreatePatchE2E(
            'Hybrid (Compress + Unsafe + Separate)',
            oldStr,
            newStr,
            options
        );
    });

});

});
