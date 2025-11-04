// test/cdiff.options.test.ts
import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffService, type CdiffOptions, type ApplyOptions } from '../src/cdiff.js';
import { 
    MyersCoreDiff,
    registerPatienceDiffStrategy,
    registerPreserveStructureStrategy
} from '@fishan/myers-core-diff';

// Register strategies so CdiffService can use them
registerPatienceDiffStrategy(MyersCoreDiff);
registerPreserveStructureStrategy(MyersCoreDiff);

/**
 * Test helper for CdiffService.createPatch.
 * This helper verifies both the exact structure of the generated patch
 * and its functional correctness by applying it.
 */
const runCreatePatchTest = (
    title: string,
    oldStr: string,
    newStr: string,
    options: CdiffOptions,
    expectedPatch: string[]
) => {
    test(title, () => {
        // 1. Create the patch
        const generatedPatch = CdiffService.createPatch(oldStr, newStr, options);

        // 2. Unit Test: Check if the patch matches the expected structure
        assert.deepStrictEqual(generatedPatch, expectedPatch, "Generated patch structure mismatch");

        // 3. Functional Test: Apply the patch and verify the result
        let reconstructedStr: string | null = null;
        let applyError: Error | null = null;
        
        // Ensure 'applyPatch' can handle 'e' commands if they are generated
        const applyOptions: ApplyOptions = {
            strictMode: true,
            // [FIX v1.1] Must also check for 'a'/'d' commands if optimization kicked in
            includeCharEquals: options.includeCharEquals || options.includeEqualMode === 'context'
        };

        try {
            // CdiffService.applyPatch can handle compressed and uncompressed patches
            reconstructedStr = CdiffService.applyPatch(oldStr, generatedPatch, applyOptions);
        } catch (error) {
            applyError = error as Error;
        }

        // 4. Assert functional correctness
        if (applyError || reconstructedStr !== newStr) {
            console.error("\n--- TEST FAILED ---");
            console.error("Title:", title);
            console.error("Options:", options);
            console.error("Old String:\n", oldStr);
            console.error("New String (Expected):\n", newStr);
            console.error("Generated Patch (Actual):\n", generatedPatch);
            console.error("Expected Patch:\n", expectedPatch);
            if (applyError) {
                console.error("Apply Error:", applyError.message);
            } else {
                console.error("Reconstructed String:\n", reconstructedStr);
            }
            console.error("-------------------\n");
        }

        assert.strictEqual(applyError, null, "Patch application threw an error");
        assert.deepStrictEqual(reconstructedStr, newStr, "Reconstruction failed");
    });
};

// =============== CdiffService.createPatch Option Tests ===============

suite('CdiffService.createPatch - deletionStrategy', () => {

    const oldStr = 'line 1\nline 2 (delete safe)\nline 3\nline 4 (delete unsafe)\nline 5';
    const newStr = 'line 1\nline 3\nline 5';

    runCreatePatchTest(
        "should use 'safe' (D) deletion by default",
        oldStr,
        newStr,
        { 
            // default
        },
        [
            '2 D line 2 (delete safe)',
            '4 D line 4 (delete unsafe)'
        ]
    );

    runCreatePatchTest(
        "should use 'safe' (D) deletion when specified",
        oldStr,
        newStr,
        { 
            deletionStrategy: 'safe' 
        },
        [
            '2 D line 2 (delete safe)',
            '4 D line 4 (delete unsafe)'
        ]
    );
    
    runCreatePatchTest(
        "should use 'unsafe' (X) deletion when specified",
        oldStr,
        newStr,
        { 
            deletionStrategy: 'unsafe' 
        },
        [
            '2 X ', // Note: 'X' command has a trailing space
            '4 X '
        ]
    );

    runCreatePatchTest(
        "should use 'unsafe' (x) for char-level deletion",
        'hello world',
        'he world',
        { 
            deletionStrategy: 'unsafe' 
        },
        [
            '1 x 2 3' // Expected: 1 x 2 3 (index 2, length 3)
                      // Safe:     1 d 2 3 llo
        ]
    );

    runCreatePatchTest(
        "should use functional deletion strategy",
        oldStr,
        newStr,
        { 
            deletionStrategy: (content, lineNum) => {
                return content.includes('unsafe') ? 'unsafe' : 'safe';
            }
        },
        [
            '2 D line 2 (delete safe)', // This line is 'safe'
            '4 X '                      // This line is 'unsafe'
        ]
    );

});

// ---

suite('CdiffService.createPatch - includeEqualMode', () => {

    const oldStr = 'E1\nE2\nCHANGE_A\nE3\nE4\nCHANGE_B\nE5\nE6';
    const newStr = 'E1\nE2\nCHANGE_X\nE3\nE4\nCHANGE_Y\nE5\nE6';
    
    // [FIX v1.1] Updated all tests in this suite to expect 
    // the *optimized* char-level (d/a) commands,
    // because `CHANGE_A` -> `CHANGE_X` is a char-level optimization.
    
    runCreatePatchTest(
        "should use 'none' (default) - no E+ blocks",
        oldStr,
        newStr,
        {
            includeEqualMode: 'none'
        },
        [
            '3 d 7 1 A',
            '3 a 7 1 X',
            '6 d 7 1 B',
            '6 a 7 1 Y'
        ]
    );
    
    runCreatePatchTest(
        "should use 'inline' - E+ blocks with new coordinates",
        oldStr,
        newStr,
        {
            includeEqualMode: 'inline'
        },
        [
            '1 E+ 2', // New line 1, 2 lines
            'E1',
            'E2',
            '3 d 7 1 A',
            '3 a 7 1 X',
            '4 E+ 2', // New line 4, 2 lines
            'E3',
            'E4',
            '6 d 7 1 B',
            '6 a 7 1 Y',
            '7 E+ 2', // New line 7, 2 lines
            'E5',
            'E6'
        ]
    );
    
    runCreatePatchTest(
        "should use 'separate' - E+ blocks with dual coordinates",
        oldStr,
        newStr,
        {
            includeEqualMode: 'separate'
        },
        [
            '3 d 7 1 A',
            '3 a 7 1 X',
            '6 d 7 1 B',
            '6 a 7 1 Y',
            '$$EQUAL$$',
            '1-1 E+ 2', // Old-New E+
            'E1',
            'E2',
            '4-4 E+ 2', // Old-New E+
            'E3',
            'E4',
            '7-7 E+ 2', // Old-New E+
            'E5',
            'E6'
        ]
    );
    
    // [FIX v3.2] Updated context test.
    // 'e' commands are forced by 'context' mode.
    // E+ blocks (E2, E3, E4, E5) are all 1 line.
    // E3 (TAIL) and E4 (HEAD) CANNOT merge because they are
    // separated by the processing of the 'CHANGE_B' block.
    // The actual output (E+ 1, E+ 1) is correct.
    runCreatePatchTest(
        "should use 'context' (includeContextLines: 1)",
        oldStr,
        newStr,
        {
            includeEqualMode: 'context',
            includeContextLines: 1 
        },
        [
            '2 E+ 1', // E2 (HEAD for A)
            'E2',
            '3 d 7 1 A',
            '3 a 7 1 X',
            '3 e 0 7 CHANGE_',
            '4 E+ 1', // E3 (TAIL for A)
            'E3',
            '5 E+ 1', // E4 (HEAD for B)
            'E4',
            '6 d 7 1 B',
            '6 a 7 1 Y',
            '6 e 0 7 CHANGE_',
            '7 E+ 1', // E5 (TAIL for B)
            'E5'
            // E1 and E6 are outside context
        ]
    );

});

// ---

suite('CdiffService.createPatch - includeCharEquals', () => {

    const oldStr = 'const x = 10;';
    const newStr = 'const y = 20;';

    // [FIX v4.0] This test now expects the *optimized* char patch
    // from _groupChanges (which merges 'x' and '10').
    runCreatePatchTest(
        "should NOT include 'e' commands by default",
        oldStr,
        newStr,
        {
            includeCharEquals: false // or default
        },
        [
            '1 d 6 5 x = 1', // Merged 'x', ' = ', '1'
            '1 a 6 5 y = 2'  // Merged 'y', ' = ', '2'
        ]
    );

    // [FIX v4.0] This test now expects the *unoptimized* patch
    // because `includeCharEquals: true` forces a different
    // (unmerged) path inside _groupChanges.
    runCreatePatchTest(
        "should include 'e' commands when includeCharEquals=true",
        oldStr,
        newStr,
        {
            includeCharEquals: true
        },
        [            
            '1 d 6 1 x 10 1 1', // Unmerged 'x' and '10'
            '1 a 6 1 y 10 1 2',  // Unmerged 'y' and '20'
            '1 e 0 6 const  7 3  =  11 2 0;'
        ]
    );
    
    // [FIX v4.0] Same as above.
    runCreatePatchTest(
        "should include 'e' commands when includeEqualMode='context'",
        oldStr,
        newStr,
        {
            includeEqualMode: 'context', // This *forces* includeCharEquals
            includeContextLines: 1 // Not relevant for char diff, but good practice
        },
        [            
            '1 d 6 1 x 10 1 1',
            '1 a 6 1 y 10 1 2',
            '1 e 0 6 const  7 3  =  11 2 0;'
        ]
    );

});