import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffCharService } from '../src/cdiff_chars.js';

import { 
    MyersCoreDiff, 
    DiffOperation, 
    type DiffResult, 
    DiffOperation as op,
} from '@fishan/myers-core-diff';

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
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1, { debug: false});
            const result = CdiffCharService.applyPatch(oldLine, patch, { debug: false });
            assert.strictEqual(result, newLine, `Patch failed. Generated: ${JSON.stringify(patch)}`);
        });
    });

    // #################################################################
    // ## Unit Tests: createPatch (Grouping Logic)
    // #################################################################
    suite('createPatch: Grouping Logic', () => {

        test('should NOT merge distant changes separated by a long EQUAL block', () => {
            const oldLine = 'start middle end';
            const newLine = 'Xtart middle enD'; // Changes at index 0 and 15
            // The separator 'tart middle en' has length 14 (> 4), so changes should not be merged.
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            // console.log('Patch:', patch);
            
            // Sort arrays to ensure comparison is order-independent
            assert.deepStrictEqual(patch.sort(), [
                '1 a 0 1 X 15 1 D',
                '1 d 0 1 s 15 1 d'
            ].sort());
        });

        test('should merge close changes separated by a short EQUAL block (<= 4 chars)', () => {
            const oldLine = 'abc 123 def';
            const newLine = 'axc 1y3 def';
            // Changes 'b'->'x' and '2'->'y' are separated by 'c 1' (length 3), so they should be merged.
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            // The patch should absorb 'c 1' into a single operation.
            assert.deepStrictEqual(patch.sort(), [
                '1 a 1 5 xc 1y',
                '1 d 1 5 bc 12'
            ].sort());
        });

        test('should handle a single continuous change correctly', () => {
            const oldLine = 'start middle end';
            const newLine = 'START MIDDLE END';
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            assert.deepStrictEqual(patch.sort(), [
                '1 a 0 16 START MIDDLE END',
                '1 d 0 16 start middle end'
            ].sort());
        });

        test('should merge changes where separators are single chars', () => {
            const oldLine = 'a b c';
            const newLine = 'a_b-c';
            // Separator is 'b' (length 1), so changes should be merged
            const patch = CdiffCharService.createPatch(oldLine, newLine, 1);
            assert.deepStrictEqual(patch.sort(), [
                '1 a 1 3 _b-',
                '1 d 1 3  b '
            ].sort());
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

        // --- E2E tests for grouping logic ---
        runCharE2ETest(
            'E2E: should correctly patch and invert MERGED changes',
            'abc 123 def',
            'axc 1y3 def'
        );

        runCharE2ETest(
            'E2E: should correctly patch and invert SEPARATE changes',
            'start middle end',
            'Xtart middle enD'
        );
        
        runCharE2ETest(
            'E2E: should correctly handle complex real-world case with merging',
            'const { data, error } = await supabase.from(\'profiles\').select(\'*\');',
            'const { data: a, error: b } = await supabase.from(\'profiles\').select(\'id\');'
        );
    });

    suite('Direct Test: CdiffCharService.groupChanges', () => {

        // Helper function to call the private method
        const callGroupChanges = (changes: [import('@fishan/myers-core-diff').DiffOperation, string][]) => {
            // return (CdiffCharService as any)._groupChanges(changes);
            return (CdiffCharService as any).groupChanges(changes);
        };

        // Helper to create diff results easily
        

        test('should group a simple replacement', () => {
            const changes: [import('@fishan/myers-core-diff').DiffOperation, string][] = [
                [op.REMOVE, 'a'],
                [op.ADD, 'b']
            ];
            const { additions, deletions } = callGroupChanges(changes);
            assert.deepStrictEqual(deletions, [{ index: 0, content: 'a' }]);
            assert.deepStrictEqual(additions, [{ index: 0, content: 'b' }]);
        });

        test('should merge changes around a short EQUAL block', () => {
            const changes: [import('@fishan/myers-core-diff').DiffOperation, string][] = [
                [op.REMOVE, 'X'],
                [op.EQUAL, ' '], // Separator of length 1
                [op.ADD, 'Y']
            ];
            const { additions, deletions } = callGroupChanges(changes);
            // Ожидаем, что пробел будет "втянут" в изменения
            assert.deepStrictEqual(deletions, [{ index: 0, content: 'X ' }]);
            assert.deepStrictEqual(additions, [{ index: 0, content: ' Y' }]);
        });

        test('should NOT merge changes around a long EQUAL block', () => {
            const changes: [import('@fishan/myers-core-diff').DiffOperation, string][] = [
                [op.REMOVE, 'start'],
                [op.EQUAL, ' '], [op.EQUAL, 'm'], [op.EQUAL, 'i'], [op.EQUAL, 'd'], [op.EQUAL, ' '], // Separator of length 5
                [op.ADD, 'end']
            ];
            const { additions, deletions } = callGroupChanges(changes);
            // Ожидаем два отдельных блока изменений
            assert.deepStrictEqual(deletions, [{ index: 0, content: 'start' }]);
            // Индекс для 'end' будет 5, так как он вставляется после ' start'
            assert.deepStrictEqual(additions, [{ index: 5, content: 'end' }]);
        });

        test('should correctly calculate indices with multiple groups', () => {
            const changes: [import('@fishan/myers-core-diff').DiffOperation, string][] = [
                [op.REMOVE, 'a'], [op.ADD, 'A'], // group 1
                [op.EQUAL, 'l'], [op.EQUAL, 'o'], [op.EQUAL, 'n'], [op.EQUAL, 'g'], [op.EQUAL, ' '], // long separator
                [op.REMOVE, 'b'], [op.ADD, 'B']  // group 2
            ];
            const { additions, deletions } = callGroupChanges(changes);

            assert.deepStrictEqual(deletions, [
                { index: 0, content: 'a' },
                { index: 6, content: 'b' } // 'a' (1) + 'long ' (5) = 6
            ]);
            assert.deepStrictEqual(additions, [
                { index: 0, content: 'A' },
                { index: 6, content: 'B' } // 'A' (1) + 'long ' (5) = 6
            ]);
        });
    });
});