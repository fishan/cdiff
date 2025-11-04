/* [FILE: cdiff_binary.test.ts] - v19.1 (Corrected Types) */
import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffService, type CdiffOptions, type ApplyOptions } from '../src/cdiff.js';

// We must import these for CdiffService to load, even if binary mode doesn't use them
import { 
    MyersCoreDiff,
    registerPatienceDiffStrategy,
    registerPreserveStructureStrategy
} from '@fishan/myers-core-diff';

// Register strategies
registerPatienceDiffStrategy(MyersCoreDiff);
registerPreserveStructureStrategy(MyersCoreDiff);

// --- Test Data ---

// Helper function to create "binary" strings from byte arrays
const bin = (bytes: number[]): string => String.fromCharCode(...bytes);

// --- Test Data Payloads ---
const BIN_A = bin([0x01]); // 'AQ=='
const BIN_B = bin([0x02]); // 'Ag=='
const BIN_C = bin([0xFF]); // '/w=='
const BIN_D = bin([0x03]); // 'Aw=='
const BIN_E = bin([0x04]); // 'BA=='
const BIN_F = bin([0xAA, 0xBB]); // 'qrs='

const B64_A = 'AQ==';
const B64_B = 'Ag==';
const B64_C = '/w==';
const B64_D = 'Aw==';
const B64_F = 'qrs=';

// --- Test Scenarios ---

// 1. Replacement
const OLD_REPLACE = bin([0x01, 0x02, 0x03]); // A, B, D
const NEW_REPLACE = bin([0x01, 0xFF, 0x03]); // A, C, D

// 2. Deletion
const OLD_DELETE = bin([0x01, 0x02, 0x03, 0x04]); // A, B, D, E
const NEW_DELETE = bin([0x01, 0x04]);             // A, E

// 3. Addition
const OLD_ADD = bin([0x01, 0x02]);       // A, B
const NEW_ADD = bin([0x01, 0xAA, 0xBB, 0x02]); // A, F, B

// 4. Complex (for context/compression)
const OLD_COMPLEX = bin([0x01, 0x01, 0x01, 0xDE, 0xAD, 0xBE, 0xEF, 0x02, 0x02, 0x02]);
const NEW_COMPLEX = bin([0x01, 0x01, 0x01, 0xCA, 0xFE, 0xBA, 0xBE, 0x02, 0x02, 0x02]);

/**
 * Test helper for CdiffService.createPatch in binary mode.
 * This helper verifies both the exact structure of the generated patch
 * (if expectedPatch is provided) and its functional correctness.
 */
const runBinaryPatchTest = (
    title: string,
    oldStr: string,
    newStr: string,
    options: CdiffOptions, // This type is imported from cdiff.ts
    expectedPatch?: string[]
) => {
    test(title, () => {

        // 1. Create the patch
        const generatedPatch = CdiffService.createPatch(oldStr, newStr, options);

        // 2. Unit Test (Optional): Check if the patch matches the expected structure
        if (expectedPatch) {
            assert.deepStrictEqual(generatedPatch, expectedPatch, "Generated patch structure mismatch");
        }

        // 3. Functional Test: Apply the patch and verify the result
        let reconstructedStr: string | null = null;
        let applyError: Error | null = null;
        
        // [FIX] Ensure this object *exactly* matches the ApplyOptions type
        const applyOptions: ApplyOptions = {
            strictMode: true, // <-- The property is 'strictMode', not 'strict'
            mode: 'binary',   // Hardcode binary mode for apply
            includeCharEquals: options.includeCharEquals || options.includeEqualMode === 'context'
        };

        try {
            reconstructedStr = CdiffService.applyPatch(oldStr, generatedPatch, applyOptions);
        } catch (error) {
            applyError = error as Error;
        }

        // 4. Assert functional correctness
        if (applyError || reconstructedStr !== newStr) {
            console.error("\n--- TEST FAILED ---");
            console.error("Title:", title);
            console.error("Options:", options);
            console.error("Generated Patch (Actual):\n", generatedPatch);
            if(expectedPatch) console.error("Expected Patch:\n", expectedPatch);
            if (applyError) {
                console.error("Apply Error:", applyError.message);
            } else {
                // Log binary strings as byte arrays for readability
                const actualBytes = reconstructedStr ? Array.from(reconstructedStr).map(c => c.charCodeAt(0)) : [];
                const expectedBytes = Array.from(newStr).map(c => c.charCodeAt(0));
                console.error("Reconstructed String (Bytes):\n", actualBytes);
                console.error("Expected String (Bytes):\n", expectedBytes);
            }
            console.error("-------------------\n");
        }

        assert.strictEqual(applyError, null, "Patch application threw an error");
        assert.deepStrictEqual(reconstructedStr, newStr, "Reconstruction failed");
    });
};

// =============== CdiffService.createPatch - mode: 'binary' ===============

suite("CdiffService.createPatch - mode: 'binary' (Unit Tests)", () => {

    runBinaryPatchTest(
        "should create a 'd' and 'a' patch (replacement)",
        OLD_REPLACE, // 01 02 03
        NEW_REPLACE, // 01 FF 03
        {            
            mode: 'binary' as const // [FIX] 'as const' helps TypeScript
        },
        [
            // '1' (line num), 'd' (op), '1' (index), '4' (B64 length), 'Ag==' (Base64 for 0x02)
            `1 d 1 4 ${B64_B}`,
            // '1' (line num), 'a' (op), '1' (index), '4' (B64 length), '//w==' (Base64 for 0xFF)
            `1 a 1 4 ${B64_C}`
        ]
    );

    runBinaryPatchTest(
        "should create a 'd' patch (deletion)",
        OLD_DELETE, // 01 02 03 04
        NEW_DELETE, // 01 04
        {
            mode: 'binary' as const
        },
        [
            // Delete at index 1, 2 bytes (0x02, 0x03)
            // B64 for [0x02, 0x03] is 'AgM=' (length 4)
            '1 d 1 4 AgM=' // [FIXED]
        ]
    );

    runBinaryPatchTest(
        "should create an 'a' patch (addition)",
        OLD_ADD, // 01 02
        NEW_ADD, // 01 AA BB 02
        {
            mode: 'binary' as const
        },
        [
            // Add at index 1, 2 bytes (0xAA, 0xBB)
            // B64 for [0xAA, 0xBB] is 'qrs=' (length 4)
            `1 a 1 4 ${B64_F}`
        ]
    );

    runBinaryPatchTest(
        "should create an 'x' patch (unsafe deletion)",
        OLD_DELETE, // 01 02 03 04
        NEW_DELETE, // 01 04
        {
            debug: false,
            mode: 'binary' as const,
            deletionStrategy: 'unsafe'
        },
        [
            // Delete at index 1, 2 bytes.
            // 'x' commands store *binary* length, not Base64 length.
            '1 x 1 2'
        ]
    );

    runBinaryPatchTest(
        "should include 'e' commands (includeCharEquals: true)",
        OLD_REPLACE, // 01 02 03
        NEW_REPLACE, // 01 FF 03
        {
            debug: false,
            mode: 'binary' as const,
            includeCharEquals: true
        },
        [
            // Sorted 'd', 'a', 'e'
            `1 d 1 4 ${B64_B}`,
            `1 a 1 4 ${B64_C}`,
            // 'e' (op), '0' (index), '4' (B64 len), 'AQ==' (0x01)
            // '2' (index), '4' (B64 len), 'Aw==' (0x03)
            `1 e 0 4 ${B64_A} 2 4 ${B64_D}`
        ]
    );
});

// ---

suite("CdiffService.createPatch - mode: 'binary' (E2E Lifecycle)", () => {

    // This suite does not check the exact patch, only functional correctness.
    
    runBinaryPatchTest(
        "should correctly patch when compress=true",
        OLD_COMPLEX,
        NEW_COMPLEX,
        {
            mode: 'binary' as const,
            compress: true
        }
    );

    runBinaryPatchTest(
        "should correctly patch with includeEqualMode='context'",
        OLD_COMPLEX,
        NEW_COMPLEX,
        {
            mode: 'binary' as const,
            includeEqualMode: 'context',
            includeContextLines: 2 // This option is ignored in binary mode, but we test it
        }
    );
    
    runBinaryPatchTest(
        "should correctly patch with includeEqualMode='inline'",
        OLD_COMPLEX,
        NEW_COMPLEX,
        {
            mode: 'binary' as const,
            includeEqualMode: 'inline'
        }
    );

    runBinaryPatchTest(
        "should correctly patch with includeEqualMode='separate'",
        OLD_COMPLEX,
        NEW_COMPLEX,
        {
            mode: 'binary' as const,
            includeEqualMode: 'separate'
        }
    );

    runBinaryPatchTest(
        "should pass 'all-invert' validation (for a 'safe' patch)",
        OLD_REPLACE,
        NEW_REPLACE,
        {
            mode: 'binary' as const,
            validationLevel: 'all-invert' // Should pass
        }
    );
    
    runBinaryPatchTest(
        "should pass 'all-invert' validation (for an 'unsafe' patch)",
        OLD_DELETE,
        NEW_DELETE,
        {
            mode: 'binary' as const,
            deletionStrategy: 'unsafe',
            validationLevel: 'all-invert' // Should pass (and skip invert)
        }
    );
});

// ---

suite("CdiffService.invertPatch - mode: 'binary'", () => {

    test("should successfully invert a 'safe' binary patch", () => {
        const oldStr = OLD_REPLACE;
        const newStr = NEW_REPLACE;
        const options: CdiffOptions = { mode: 'binary' as const };

        // 1. Create forward patch
        const forwardPatch = CdiffService.createPatch(oldStr, newStr, options);
        // Expected: ['1 d 1 4 Ag==', '1 a 1 4 //w==']
        
        // 2. Invert patch
        const invertedPatch = CdiffService.invertPatch(forwardPatch, options);
        // Expected: ['1 a 1 4 Ag==', '1 d 1 4 //w==']

        // 3. Apply inverted patch to NEW content
        const reconstructedOld = CdiffService.applyPatch(newStr, invertedPatch, { mode: 'binary', strictMode: true });
        
        assert.deepStrictEqual(reconstructedOld, oldStr, "Inverted patch did not reconstruct original binary string");
    });

    test("should FAIL to invert an 'unsafe' binary patch", () => {
        const oldStr = OLD_DELETE;
        const newStr = NEW_DELETE;
        const options: CdiffOptions = { mode: 'binary' as const, deletionStrategy: 'unsafe' };

        // 1. Create forward patch
        const forwardPatch = CdiffService.createPatch(oldStr, newStr, options);
        // Expected: ['1 x 1 2']

        // 2. Assert that inverting this patch throws an error
        assert.throws(
            () => {
                CdiffService.invertPatch(forwardPatch, options);
            },
            Error,
            "Expected invertPatch to throw an error for 'unsafe' commands"
        );
    });

});