import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffCharService } from '../src/cdiff_chars.js';

suite('CdiffCharService: Character-level Patching (Comprehensive)', () => {

    // #################################################################
    // ## Unit Tests: createPatch
    // #################################################################
    suite('createPatch: Generation Logic', () => {

        test('should return an empty array for identical strings', () => {
            assert.deepStrictEqual(CdiffCharService.createPatch('hello', 'hello', 1), []);
        });

        test('should generate a simple addition patch', () => {
            const expected = ['1 a 5 6  world'];
            assert.deepStrictEqual(CdiffCharService.createPatch('hello', 'hello world', 1), expected);
        });

        test('should generate a simple deletion patch', () => {
            const expected = ['1 d 5 6  world'];
            assert.deepStrictEqual(CdiffCharService.createPatch('hello world', 'hello', 1), expected);
        });


        test('should generate a patch that correctly transforms the string', () => {
            const oldLine = 'this is a very long original line of text';
            const newLine = 'this is a very long original line of changed text';
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            const result = CdiffCharService.applyPatch(oldLine, patch);
            assert.strictEqual(result, newLine, `Patch failed. Generated: ${JSON.stringify(patch)}`);
        });
    });

    // #################################################################
    // ## Whitespace Handling Tests
    // #################################################################
    suite('Whitespace Handling', () => {

        test('should correctly handle leading/trailing whitespace in content', () => {
            const oldLine = 'a b';
            const newLine = 'a  b'; // Note the extra space
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            assert.deepStrictEqual(patch, ['1 a 2 1  ']);
            const result = CdiffCharService.applyPatch(oldLine, patch);
            assert.strictEqual(result, newLine);
        });

        test('should handle changes involving only whitespace (E2E check)', () => {
            const oldLine = 'a b c';
            const newLine = 'a\tb\tc';
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            const restored = CdiffCharService.applyPatch(oldLine, patch);
            assert.strictEqual(restored, newLine);
        });

        test('should handle patches for whitespace-only strings', () => {
            const oldLine = '   ';
            const newLine = ' \t ';
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            const result = CdiffCharService.applyPatch(oldLine, patch);
            assert.strictEqual(result, newLine);
        });
    });

    // #################################################################
    // ## Robustness and Edge Cases
    // #################################################################
    suite('Robustness and Edge Cases', () => {
    
        test('should handle multiple non-contiguous modifications', () => {
            const oldLine = 'alpha beta gamma delta';
            const newLine = 'ALPHA beta GAMMA delta';
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            const result = CdiffCharService.applyPatch(oldLine, patch);
            assert.strictEqual(result, newLine);
        });

        test('should handle a very long string with a small change', () => {
            const longStr = 'A'.repeat(500);
            const oldLine = `start-${longStr}-end`;
            const newLine = `start-${longStr.substring(0, 250)}B${longStr.substring(251)}-end`;
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            const result = CdiffCharService.applyPatch(oldLine, patch);
            assert.strictEqual(result, newLine);
        });

        test('should apply patch regardless of command order in array', () => {
            const original = 'axc';
            // Note: 'a' command comes before 'd' command in the array
            const patch = ['1 a 1 1 y', '1 d 1 1 x'];
            assert.strictEqual(CdiffCharService.applyPatch(original, patch), 'ayc');
        });
    });


    // #################################################################
    // ## E2E Tests
    // #################################################################
    suite('End-to-End Lifecycle', () => {
        
        const runCharE2ETest = (title: string, oldLine: string, newLine: string) => {
            test(title, () => {
                const lineNumber = 1;
                // --- Forward ---
                const patch = CdiffCharService.createPatch(oldLine, newLine, lineNumber);
                const appliedResult = CdiffCharService.applyPatch(oldLine, patch);
                assert.strictEqual(appliedResult, newLine, 'Forward: Applying patch failed');

                // --- Backward ---
                const invertedPatch = CdiffCharService.invertPatch(patch);
                const restoredResult = CdiffCharService.applyPatch(newLine, invertedPatch);
                assert.strictEqual(restoredResult, oldLine, 'Backward: Applying inverted patch failed');
            });
        };

        runCharE2ETest('should handle simple modification', 'const x = 10;', 'const y = 10;');
        runCharE2ETest('should handle additions at the beginning', 'world', 'hello world');
        runCharE2ETest('should handle deletions from the end', 'hello cruel world', 'hello world');
        runCharE2ETest('should handle creating a string from empty', '', 'new content');
        runCharE2ETest('should handle deleting the entire string', 'delete all of this', '');
        runCharE2ETest('should handle complete rewrite (line-level patch)', 'abcdefg', '1234567890');
        runCharE2ETest('should handle multiple changes (line-level patch)', 'A B C D E', 'A X C Y E');
        runCharE2ETest('should handle changes with special characters', 'A line with unicode 😊.', 'A new line with unicode 🚀.');
        runCharE2ETest('should handle multiple non-contiguous modifications', 'alpha beta gamma delta', 'ALPHA beta GAMMA delta');
    });
});