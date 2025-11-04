import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffService } from '../src/cdiff.js';

suite('CdiffService: Uni-Coordinate Lifecycle', () => {

    test('[Apply] should add a single line', () => {
        const original = 'line 1\nline 3';
        const cdiff = ['2 A line 2'];
        const expected = 'line 1\nline 2\nline 3';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Apply] should delete a single line', () => {
        const original = 'line 1\nline 2\nline 3';
        const cdiff = ['2 D line 2'];
        const expected = 'line 1\nline 3';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });
    
    test('[Apply] should handle file creation from empty', () => {
        const original = '';
        const cdiff = ['1 A hello', '2 A world'];
        const expected = 'hello\nworld';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Apply] should handle deleting all content', () => {
        const original = 'line 1\nline 2';
        const cdiff = ['1 D line 1', '2 D line 2'];
        const expected = '';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Create] should generate an empty cdiff for identical files', () => {
        const text = 'line 1\nline 2';
        assert.deepStrictEqual(CdiffService.createPatch(text, text), []);
    });

    test('[Create] should generate correct A command for addition', () => {
        const oldC = 'line 1\nline 3';
        const newC = 'line 1\nline 2\nline 3';
        assert.deepStrictEqual(CdiffService.createPatch(oldC, newC), ['2 A line 2']);
    });

    test('[Create] should generate correct D command for deletion', () => {
        const oldC = 'line 1\nline 2\nline 3';
        const newC = 'line 1\nline 3';
        assert.deepStrictEqual(CdiffService.createPatch(oldC, newC), ['2 D line 2']);
    });

    test('[Create] should generate correct d and a commands for modification', () => {
        const oldC = 'line 1\nold line\nline 3';
        const newC = 'line 1\nnew line\nline 3';
        assert.deepStrictEqual(CdiffService.createPatch(oldC, newC), ['2 d 0 3 old', '2 a 0 3 new']);
    });

    test('[E2E] should correctly apply a patch it just created', () => {
        const oldContent = "A\nB\nC\nD\nE\nF\nG";
        const newContent = "A\nX\nY\nE\nF\nG-modified";
        
        const cdiff = CdiffService.createPatch(oldContent, newContent, { debug: false });
        const result = CdiffService.applyPatch(oldContent, cdiff, { debug: false});
        
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle multiple additions in different positions', () => {
        const oldContent = 'A\nC\nE';
        const newContent = 'A\nB\nC\nD\nE';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle multiple deletions in different positions', () => {
        const oldContent = 'A\nB\nC\nD\nE';
        const newContent = 'A\nD\nE';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle complex modifications (delete, add, replace)', () => {
        const oldContent = 'line1\nold2\nold3\nline4';
        const newContent = 'line1\nnew2\nline3\nline4';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle adding lines at the end', () => {
        const oldContent = 'A\nB';
        const newContent = 'A\nB\nC\nD';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle deleting lines from the beginning', () => {
        const oldContent = 'A\nB\nC';
        const newContent = 'B\nC';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle empty lines correctly', () => {
        const oldContent = 'A\n\nC';
        const newContent = 'A\nB\n\nC';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle single-line file modification', () => {
        const oldContent = 'old';
        const newContent = 'new';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle complete deletion of multiple lines', () => {
        const oldContent = 'line1\nline2\nline3';
        const newContent = '';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle adding empty lines', () => {
        const oldContent = 'A';
        const newContent = 'A\n\nB';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle line moves (delete and re-add)', () => {
        const oldContent = '1\n2\n3';
        const newContent = '2\n3\n1';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Apply] should handle multiple additions in the middle', () => {
        const original = 'line 1\nline 4';
        const cdiff = [
            '2 A line 2',
            '3 A line 3'
        ];
        const expected = 'line 1\nline 2\nline 3\nline 4';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Apply] should handle multiple deletions in the middle', () => {
        const original = 'line 1\nline 2\nline 3\nline 4';
        const cdiff = [
            '2 D line 2',
            '3 D line 3'
        ];
        const expected = 'line 1\nline 4';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Apply] should handle additions at the end', () => {
        const original = 'line 1\nline 2';
        const cdiff = [
            '3 A line 3',
            '4 A line 4'
        ];
        const expected = 'line 1\nline 2\nline 3\nline 4';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });
    
    test('[Create] should generate patch for replacement with empty line', () => {
        const oldC = 'line 1\nold\nline 3';
        const newC = 'line 1\n\nline 3';
        const cdiff = CdiffService.createPatch(oldC, newC);
        assert.deepStrictEqual(cdiff, ['2 d 0 3 old']);
    });

    test('[Create] should generate patch for moving a line (delete + add elsewhere)', () => {
        const oldC = 'line 1\nline 2\nline 3';
        const newC = 'line 1\nline 3\nline 2';
        
        const expectedPatch = [
            '2 D line 2',
            '3 A line 2'
        ];

        const actualPatch = CdiffService.createPatch(oldC, newC);      
        assert.deepStrictEqual(actualPatch, expectedPatch);
        const applied = CdiffService.applyPatch(oldC, actualPatch);
        assert.strictEqual(applied, newC, 'The generated patch did not produce the correct result');
    });

    test('[Invert] should correctly invert a complex patch with multiple changes', () => {
        const cdiff = [
            '2 D B',
            '3 D C',
            '2 A X',
            '3 A Y'
        ];
        const inverted = CdiffService.invertPatch(cdiff);
        const expected = [
            
            '2 A B',
            '3 A C',
            '2 D X',
            '3 D Y'
        ];
        assert.deepStrictEqual(inverted, expected);
    });

    test('[Create] should generate intra-line patches for aligned multi-line blocks', () => {
        const oldContent = `const a = 1;
    const b = 2;`;
        const newContent = `const a = 100;
    const b = 200;`;
        const cdiff = CdiffService.createPatch(oldContent, newContent);        
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward patch application failed');        
        assert.ok(!cdiff.some(cmd => cmd.includes('D+') || cmd.includes('A+')), 'Should not use block commands for aligned changes');        
        assert.ok(cdiff.some(cmd => cmd.includes(' d ') || cmd.includes(' a ')), 'Should use character-level commands');
    });

    const runE2E_Test = (title: string, oldContent: string, newContent: string) => {
        test(title, () => {
            const cdiff = CdiffService.createPatch(oldContent, newContent);
            const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
            assert.strictEqual(appliedResult, newContent, "Forward patch application failed");
            const invertedCdiff = CdiffService.invertPatch(cdiff);
            const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
            assert.strictEqual(restoredResult, oldContent, "Inverted patch application failed to restore original content");
        });
    };

    runE2E_Test(
        '[E2E-Invert] should handle multiple separate blocks of changes',
        `// start\n\nconst a = 1;\nconst b = 2;\n\n// middle\n\nconst c = 3;\nconst d = 4;\n\n// end`,
        `// start\n\nconst a = 100; // changed\nconst b = 2;\n\n// middle section\n\nconst d = 400; // changed\n\n// end`
    );

    runE2E_Test(
        '[E2E-Invert] should handle changes at the very beginning of the file',
        `first line\nsecond line\nthird line`,
        `- first line changed\n- added line\nsecond line\nthird line`
    );

    runE2E_Test(
        '[E2E-Invert] should handle changes at the very end of the file',
        `first line\nsecond line\nthird line`,
        `first line\nsecond line\n- third line changed\n- added line at end`
    );

    runE2E_Test(
        '[E2E-Invert] should handle complete replacement of a block',
        `start\n-- block start --\nline 1\nline 2\nline 3\n-- block end --\nend`,
        `start\n-- new block --\nnewline A\nnewline B\n-- new block end --\nend`
    );

    runE2E_Test(
        '[E2E-Invert] should handle a completely rewritten file',
        `one\ntwo\nthree`,
        `alpha\nbeta\ngamma\ndelta`
    );

    runE2E_Test(
        '[E2E-Invert] should handle deletion of all content',
        `line 1\nline 2\nline 3`,
        ``
    );

    runE2E_Test(
        '[E2E-Invert] should handle creation of a file from empty',
        ``,
        `first line of new file\nsecond line`
    );

    runE2E_Test(
        '[E2E-Invert] should correctly handle empty lines in changes',
        `start\n\nend`,
        `start\nline 1\n\nline 3\nend`
    );

    runE2E_Test(
        '[E2E-Invert] should handle aligned multi-line block changes',
        `const a = 1;
    const b = 2;`,
        `const a = 100;
    const b = 200;`
    );
});

suite('CdiffService: Additional Edge Cases and Robustness', () => {

    test('[Apply] should ignore invalid patch commands', () => {
        const original = 'line 1\nline 2\nline 3';
        const cdiff = [
            '2 A line 2.5',
            'invalid command',
            '4 X bad',
            '3 D line 3'
        ];
        const expected = 'line 1\nline 2.5\nline 2';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Apply] should handle multiple additions at the same position', () => {
        const original = 'line 1\nline 3';
        const cdiff = [
            '2 A insert 1',
            '2 A insert 2',
            '2 A insert 3'
        ];
        const expected = 'line 1\ninsert 1\ninsert 2\ninsert 3\nline 3';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Apply] should ignore duplicate deletions at the same position', () => {
        const original = 'line 1\nline 2\nline 3';
        const cdiff = [
            '2 D line 2',
            '2 D line 2',
            '3 A new line'
        ];
        const expected = 'line 1\nline 3\nnew line';
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), expected);
    });

    test('[Create+Apply] should handle large file with multiple changes', () => {
        const oldContent = Array(100).fill(0).map((_, i) => `line ${i + 1}`).join('\n');
        const newContent = Array(100).fill(0).map((_, i) => {
            if (i === 10) return 'modified 11';
            if (i === 50) return 'inserted 51';
            if (i === 90) return '';
            return `line ${i + 1}`;
        }).filter((_, i) => i !== 20).join('\n');
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle only additions', () => {
        const oldContent = 'line 1\nline 2';
        const newContent = 'line 1\nnew 1\nnew 2\nline 2\nnew 3';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle only deletions', () => {
        const oldContent = 'line 1\nline 2\nline 3\nline 4';
        const newContent = 'line 2\nline 4';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Create+Apply] should handle lines with spaces and special characters', () => {
        const oldContent = 'line 1\n  spaces  \n\t\t\ntabbed\n😊 unicode';
        const newContent = 'line 1\nnew line\n\t\t\ntabbed\n😊 unicode';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '2 D   spaces  ',
            '2 A new line'
        ];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Apply] should return original content for empty patch', () => {
        const original = 'line 1\nline 2\nline 3';
        const cdiff: string[] = [];
        assert.strictEqual(CdiffService.applyPatch(original, cdiff), original);
    });

    test('[Create+Apply] should handle multiple consecutive replacements', () => {
        const oldContent = 'line 1\nline 2\nline 3\nline 4';
        const newContent = 'line 1\nnew 2\nnew 3\nline 4';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '2 D line 2',
            '3 D line 3',
            '2 A new 2',
            '3 A new 3'
        ];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[E2E-Invert] should handle patch with out-of-bounds positions', () => {
        const oldContent = 'line 1\nline 2';
        const newContent = 'line 1\nline 2\nextra';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward application failed');

        const invertedCdiff = CdiffService.invertPatch(cdiff).concat(['999 D invalid']);
        const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
        assert.strictEqual(restoredResult, oldContent, 'Inverted restoration failed');
    });

    test('[E2E-Invert] should handle trailing newlines', () => {
        const oldContent = 'line 1\nline 2\n';
        const newContent = 'line 1\nnew line\nline 2\n';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward application failed');

        const invertedCdiff = CdiffService.invertPatch(cdiff);
        const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
        assert.strictEqual(restoredResult, oldContent, 'Inverted restoration failed');
    });

    test('[E2E-Invert] should handle single-line file with changes', () => {
        const oldContent = 'single';
        const newContent = 'modified';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward application failed');

        const invertedCdiff = CdiffService.invertPatch(cdiff);
        const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
        assert.strictEqual(restoredResult, oldContent, 'Inverted restoration failed');
    });
});

suite('CdiffService: Extended Robustness Tests', () => {

    test('[Apply] should handle chaotic patch command order', () => {
        const original = 'line 1\nline 2\nline 3\nline 4';
        const cdiff = [
            '3 A new 3',
            '2 D line 2',
            '2 A new 2',
            '3 D line 3'
        ];
        const expected = 'line 1\nnew 2\nnew 3\nline 4';
        const result = CdiffService.applyPatch(original, cdiff);
        assert.strictEqual(result, expected);
    });

    test('[Apply] should handle multiple changes at the same line', () => {
        const original = 'line 1\nline 2\nline 3';
        const cdiff = [
            '2 D line 2',
            '2 A insert 1',
            '2 A insert 2',
            '2 A insert 3'
        ];
        const expected = 'line 1\ninsert 1\ninsert 2\ninsert 3\nline 3';
        const result = CdiffService.applyPatch(original, cdiff);
        assert.strictEqual(result, expected);
    });

    test('[E2E-Invert] should handle multiple consecutive empty lines', () => {
        const oldContent = 'line 1\n\n\n\nline 2';
        const newContent = 'line 1\nnew\n\n\n\nline 2';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = ['2 A new'];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward application failed');
        const invertedCdiff = CdiffService.invertPatch(cdiff);
        const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
        assert.strictEqual(restoredResult, oldContent, 'Inverted restoration failed');
    });

    test('[Apply] should ignore deletion with incorrect content', () => {
        const original = 'line 1\nline 2\nline 3';
        const cdiff = [
            '2 D wrong content', 
            '2 A new line'
        ];
        const expected = 'line 1\nnew line\nline 2\nline 3';
        const result = CdiffService.applyPatch(original, cdiff);
        assert.strictEqual(result, expected);
    });

    test('[E2E-Invert] should handle very large file with multiple changes', () => {
        const oldContent = Array(1000).fill(0).map((_, i) => `line ${i + 1}`).join('\n');
        const newContent = Array(1000).fill(0).map((_, i) => {
            if (i % 100 === 0) return `modified ${i + 1}`;
            if (i % 200 === 0) return '';
            return `line ${i + 1}`;
        }).filter((_, i) => i % 150 !== 0).join('\n'); 
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward application failed');
        const invertedCdiff = CdiffService.invertPatch(cdiff);
        const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
        assert.strictEqual(restoredResult, oldContent, 'Inverted restoration failed');
    });
});

suite('CdiffService: Whitespace and Special Characters', () => {
    test('[Create+Apply] should handle exact whitespace in deletions', () => {
        const oldContent = 'line 1\n  spaces  \nline 3';
        const newContent = 'line 1\nnew line\nline 3';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '2 D   spaces  ',
            '2 A new line'
        ];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[E2E-Invert] should handle multiple spaces and tabs', () => {
        const oldContent = 'line 1\n \t spaces\t \nline 3';
        const newContent = 'line 1\nnew line\nline 3';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '2 D  \t spaces\t ',
            '2 A new line'
        ];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward application failed');

        const invertedCdiff = CdiffService.invertPatch(cdiff);
        const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
        assert.strictEqual(restoredResult, oldContent, 'Inverted restoration failed');
    });

    test('[Apply] should ignore whitespace mismatch in non-strict mode', () => {
        const original = 'line 1\n  spaces  \nline 3';
        const cdiff = ['2 D spaces', '2 A new line'];
        const expected = 'line 1\nnew line\n  spaces  \nline 3';
        const result = CdiffService.applyPatch(original, cdiff, { strictMode: false });
        assert.strictEqual(result, expected);
    });

    test('[Apply] should throw on whitespace mismatch in strict mode', () => {
        const original = 'line 1\n  spaces  \nline 3';
        const cdiff = ['2 D spaces', '2 A new line'];
        let errorThrown = false;
        try {
            CdiffService.applyPatch(original, cdiff, { strictMode: true });
        } catch (e) {
            errorThrown = true;
            if (e instanceof Error) {
                assert.strictEqual(e.message.includes('Deletion mismatch for line 2'), true, 'Expected deletion mismatch error');
            } else {
                throw e;
            }
        }
        assert.strictEqual(errorThrown, true, 'Expected error to be thrown');
    });
});

suite('CdiffService: Advanced Whitespace and Obfuscation', () => {

    test('[Create+Apply] should handle obfuscated whitespace', () => {
        const oldContent = 'line 1\n\t\t  \tcode\t  \nline 3';
        const newContent = 'line 1\nnew code\nline 3';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '2 D \t\t  \tcode\t  ',
            '2 A new code'
        ];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[E2E-Invert] should handle empty line with mixed whitespace', () => {
        const oldContent = 'line 1\n \t  \t \nline 3';
        const newContent = 'line 1\nnew line\nline 3';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '2 D  \t  \t ',
            '2 A new line'
        ];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const appliedResult = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(appliedResult, newContent, 'Forward application failed');

        const invertedCdiff = CdiffService.invertPatch(cdiff);
        const restoredResult = CdiffService.applyInvertedPatch(newContent, invertedCdiff);
        assert.strictEqual(restoredResult, oldContent, 'Inverted restoration failed');
    });

    test('[Create+Apply] should handle whitespace-only line', () => {
        const oldContent = 'line 1\n\t  \nline 3';
        const newContent = 'line 1\nnew line\nline 3';
        const cdiff = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '2 D \t  ',
            '2 A new line'
        ];
        assert.deepStrictEqual(cdiff, expectedPatch);
        const result = CdiffService.applyPatch(oldContent, cdiff);
        assert.strictEqual(result, newContent);
    });

    test('[Apply] should handle additions after intermediate content is exhausted', () => {
        const original = 'line 1\nline 2\nline 3';
        const cdiff = [
            '2 D line 2',
            '100 A+ 2', 
            'new line A',
            'new line B'
        ];
        const expected = 'line 1\nline 3\nnew line A\nnew line B';
        const result = CdiffService.applyPatch(original, cdiff, { debug: false });
        assert.strictEqual(result, expected);
    });
        test('[Apply] should insert additions at exact positions', () => {
        const original = 'line 1\nline 2\nline 3\nline 4';
        const cdiff = [
            '2 A+ 2',
            'inserted A',
            'inserted B'
        ];
        const expected = 'line 1\ninserted A\ninserted B\nline 2\nline 3\nline 4';
        const result = CdiffService.applyPatch(original, cdiff, { debug: false });
        assert.strictEqual(result, expected);
    });

});

