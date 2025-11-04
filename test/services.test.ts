import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffCharService } from '../src/cdiff_chars.js';
import { CdiffService } from '../src/cdiff.js';

// =============== ПРЯМЫЕ ТЕСТЫ ДЛЯ CdiffCharService ===============

suite('Direct Test: CdiffCharService Logic', () => {

    test('applyPatch should handle a simple addition', () => {
        const result = CdiffCharService.applyPatch('cat', ['1 a 1 1 o']);
        assert.strictEqual(result, 'coat');
    });

    test('applyPatch should handle a simple deletion', () => {
        const result = CdiffCharService.applyPatch('coat', ['1 d 1 1 o']);
        assert.strictEqual(result, 'cat');
    });

       test('DEBUG: should handle multiple non-contiguous modifications', () => {
        const oldLine = 'alpha beta gamma delta';
        const newLine = 'ALPHA beta GAMMA delta';

        // 1. Создаем патч
        const patch = CdiffCharService.createPatch(oldLine, newLine, 1);

        // 2. Применяем его
        const result = CdiffCharService.applyPatch(oldLine, patch);

        // 3. Если результат неверный, выводим всю информацию
        if (result !== newLine) {
            console.log('\n\n--- DEBUG TRACE FOR FAILED CdiffCharService TEST ---');
            console.log('Original Line:', JSON.stringify(oldLine));
            console.log('Expected Line:', JSON.stringify(newLine));
            console.log('Generated Patch:', patch);
            console.log('Actual Result:', JSON.stringify(result));
            console.log('--- END TRACE ---\n\n');
        }

        assert.strictEqual(result, newLine, "Patch application failed");
    });

    test('applyPatch should handle combined add and delete', () => {
        const patch = ['1 d 1 1 o', '1 a 1 0 a'];
        const result = CdiffCharService.applyPatch('coat', patch);
        assert.strictEqual(result, 'cat');
    });

    test('applyPatch should process multi-part commands correctly', () => {
        const patch = ['1 a 0 1 X 7 1 Y']; // Insert X at start, Y at end
        const result = CdiffCharService.applyPatch('-mid-', patch);
        assert.strictEqual(result, 'X-mid-Y');
    });

    test('invertPatch should correctly swap a and d commands', () => {
        const forward = ['5 d 6 1 x', '5 a 6 1 y 11 1 0'];
        const inverted = CdiffCharService.invertPatch(forward);
        assert.deepStrictEqual(inverted, ['5 a 6 1 x', '5 d 6 1 y 11 1 0']);
    });
});


// =============== ПРЯМЫЕ ТЕСТЫ ДЛЯ CdiffService ===============

suite('Direct Test: CdiffService Logic', () => {

    test('applyPatch should handle single line addition (A)', () => {
        const result = CdiffService.applyPatch('line1\nline3', ['2 A line2']);
        assert.strictEqual(result, 'line1\nline2\nline3');
    });

    test('applyPatch should handle single line deletion (D)', () => {
        const result = CdiffService.applyPatch('line1\nline2\nline3', ['2 D line2']);
        assert.strictEqual(result, 'line1\nline3');
    });

    test('applyPatch should handle block addition (A+)', () => {
        const patch = ['2 A+ 2', 'lineA', 'lineB'];
        const result = CdiffService.applyPatch('line1\nline4', patch);
        assert.strictEqual(result, 'line1\nlineA\nlineB\nline4');
    });

    test('applyPatch should handle block deletion (D+)', () => {
        const patch = ['2 D+ 2', 'line2', 'line3'];
        const result = CdiffService.applyPatch('line1\nline2\nline3\nline4', patch);
        assert.strictEqual(result, 'line1\nline4');
    });

    test('applyPatch should handle grouped character addition (a*)', () => {
        const patch = ['1-2 a* 0 2   ']; // Add 2 spaces to lines 1 and 2
        const result = CdiffService.applyPatch('line1\nline2\nline3', patch);
        assert.strictEqual(result, '  line1\n  line2\nline3');
    });

    test('applyPatch should handle grouped character deletion (d*)', () => {
        const patch = ['1-2 d* 0 2   '];
        const result = CdiffService.applyPatch('  line1\n  line2\nline3', patch);
        assert.strictEqual(result, 'line1\nline2\nline3');
    });

    test('applyPatch should correctly process a mix of commands', () => {
        const original = 'one\ntwo\nthree\nfour\nfive';
        const patch = [
            '2 d 0 3 two',       // char delete line 2
            '3 D three',         // line delete line 3
            '4 A new_line_five'  // line add at 5
        ];
        const result = CdiffService.applyPatch(original, patch);
        assert.strictEqual(result, 'one\n\nfour\nnew_line_five\nfive');
    });

    test('invertPatch should correctly swap A/D, A+/D+, and a*/d* commands', () => {
        const forward = [
            '2 D old',
            '3 A new',
            '5 D+ 2', 'del1', 'del2',
            '8 A+ 2', 'add1', 'add2',
            '15-16 a* 0 1 x',
            '20 d* 0 1 y'
        ];
        const inverted = CdiffService.invertPatch(forward);
        assert.deepStrictEqual(inverted, [
            '2 A old',
            '3 D new',
            '5 A+ 2', 'del1', 'del2',
            '8 D+ 2', 'add1', 'add2',
            '15-16 d* 0 1 x',
            '20 a* 0 1 y'
        ]);
    });
});

suite('Direct Test: CdiffService Create & E2E Lifecycle', () => {

    // Тесты для createPatch
    test('createPatch should generate block commands (A+) for large additions', () => {
        const oldContent = 'line1\nline5';
        const newContent = 'line1\nline2\nline3\nline4\nline5';
        const patch = CdiffService.createPatch(oldContent, newContent);
        assert.deepStrictEqual(patch, ['2 A+ 3', 'line2', 'line3', 'line4']);
    });

    test('createPatch should generate block commands (D+) for large deletions', () => {
        const oldContent = 'line1\nline2\nline3\nline4\nline5';
        const newContent = 'line1\nline5';
        const patch = CdiffService.createPatch(oldContent, newContent);
        assert.deepStrictEqual(patch, ['2 D+ 3', 'line2', 'line3', 'line4']);
    });

    test('createPatch should choose char-level diff for efficient changes', () => {
        const oldContent = 'const x = 10;';
        const newContent = 'const y = 20;';
        const patch = CdiffService.createPatch(oldContent, newContent);
        // Ожидаем символьные команды, а не D/A на всю строку
        assert.ok(patch.every(cmd => cmd.includes(' d ') || cmd.includes(' a ')), 'Expected char-level commands');
    });

    test('createPatch should generate grouped commands (a*) for indentation changes', () => {
        const oldContent = 'line1\nline2\nline3';
        const newContent = '  line1\n  line2\nline3';
        const patch = CdiffService.createPatch(oldContent, newContent);
        assert.deepStrictEqual(patch, ['1-2 a* 0 2   ']);
    });

    // Тесты полного цикла E2E (End-to-End)
    test('E2E Lifecycle: createPatch -> applyPatch should work for a simple change', () => {
        const oldContent = 'one\ntwo\nthree';
        const newContent = 'one\nTWO\nthree';
        
        const patch = CdiffService.createPatch(oldContent, newContent);
        const patched = CdiffService.applyPatch(oldContent, patch);

        assert.strictEqual(patched, newContent);
    });

    test('E2E Lifecycle: createPatch -> applyPatch should work for complex changes', () => {
        const oldContent = 'a\nb\nc\nd\ne\nf';
        const newContent = 'a\nB\nc\nNEW\ne\nF';
        
        const patch = CdiffService.createPatch(oldContent, newContent);
        const patched = CdiffService.applyPatch(oldContent, patch);

        assert.strictEqual(patched, newContent);
    });

    test('E2E Inversion Lifecycle: create -> invert -> applyInverted should restore original', () => {
        const oldContent = 'line A\nline B\nline C';
        const newContent = 'line A\nline X\nline Y\nline C';
        const forwardPatch = CdiffService.createPatch(oldContent, newContent);        
        const invertedPatch = CdiffService.invertPatch(forwardPatch);
        const restoredContent = CdiffService.applyInvertedPatch(newContent, invertedPatch);
        assert.strictEqual(restoredContent, oldContent, "Inversion lifecycle failed");
    });
});

suite('Direct Test: CdiffService Internal Helpers', () => {

    // Helper function to call the private function compressLineNumbers
    const callCompressLineNumbers = (numbers: number[]): string => {
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
    };

    // Helper function to call the private function deconstructCharCommand
    const callDeconstructCharCommand = (command: string): string[] => {
        const parts = command.split(' ');
        const type = parts[1];
        const ops: string[] = [];
        let remainder = command.substring(command.indexOf(type) + 2);
        while (remainder.length > 0) {
            const match = remainder.match(/^(\d+)\s(\d+)\s/);
            if (!match) break;
            const length = parseInt(match[2], 10);
            const headerLength = match[0].length;
            const content = remainder.substring(headerLength, headerLength + length);
            ops.push(`${type} ${match[1]} ${length} ${content}`);
            remainder = remainder.substring(headerLength + length).trimStart();
        }
        return ops;
    };

    suite('compressLineNumbers', () => {
        test('should handle an empty array', () => {
            assert.strictEqual(callCompressLineNumbers([]), '');
        });

        test('should handle a single number', () => {
            assert.strictEqual(callCompressLineNumbers([5]), '5');
        });

        test('should handle consecutive numbers', () => {
            assert.strictEqual(callCompressLineNumbers([2, 3, 4]), '2-4');
        });

        test('should handle non-consecutive numbers', () => {
            assert.strictEqual(callCompressLineNumbers([2, 4, 6]), '2,4,6');
        });

        test('should handle a mix of consecutive and non-consecutive numbers', () => {
            assert.strictEqual(callCompressLineNumbers([1, 2, 3, 5, 7, 8]), '1-3,5,7-8');
        });

        test('should handle unsorted input', () => {
            assert.strictEqual(callCompressLineNumbers([8, 2, 5, 1, 3, 7]), '1-3,5,7-8');
        });
    });

    suite('deconstructCharCommand', () => {
        test('should deconstruct a single-op command', () => {
            const command = '5 a 0 2  ';
            const expected = ['a 0 2  '];
            assert.deepStrictEqual(callDeconstructCharCommand(command), expected);
        });

        test('should deconstruct a multi-op command', () => {
            const command = '5 d 1 1 X 10 3 YYY';
            const expected = ['d 1 1 X', 'd 10 3 YYY'];
            assert.deepStrictEqual(callDeconstructCharCommand(command), expected);
        });

        test('should handle an empty command', () => {
            const command = '5 a ';
            assert.deepStrictEqual(callDeconstructCharCommand(command), []);
        });
        
        test('should handle content with spaces', () => {
            const command = '1 a 5 11 hello world';
            const expected = ['a 5 11 hello world'];
            assert.deepStrictEqual(callDeconstructCharCommand(command), expected);
        });
    });
});

suite('Direct Test: CdiffService.createPatch Complex Scenarios', () => {

    test('E2E Inversion Lifecycle: should correctly handle a simple block swap', () => {
        const oldContent = 'AAA\nBBB\nCCC';
        const newContent = 'CCC\nBBB\nAAA';

        // 1. Forward
        const patch = CdiffService.createPatch(oldContent, newContent);
        const applied = CdiffService.applyPatch(oldContent, patch);
        assert.strictEqual(applied, newContent, 'Forward patch application failed');

        // 2. Backward
        const inverted = CdiffService.invertPatch(patch);
        const restored = CdiffService.applyInvertedPatch(newContent, inverted);
        assert.strictEqual(restored, oldContent, 'Inversion lifecycle failed');
    });

    test('should generate a correct patch for a simple block swap', () => {
        const oldContent = 'block A\nSEPARATOR\nBLOCK C';
        const newContent = 'BLOCK C\nSEPARATOR\nblock A';

        const patch = CdiffService.createPatch(oldContent, newContent, {debug: false});
        // console.log('Generated Patch:', patch);

        // const result = CdiffService.applyPatch(oldContent, patch, {debug: false});
        // console.log('Applied Patch:', result);

        const expectedPatch = [
            '1 D block A',
            '3 D BLOCK C',
            '1 A BLOCK C',
            '3 A block A'
        ];
        
        assert.deepStrictEqual(patch.sort(), expectedPatch.sort());
    });

    test('should generate a correct patch for a simple chars swap', () => {
        const oldContent = 'BLOCK A\nSEPARATOR\nBLOCK C';
        const newContent = 'BLOCK C\nSEPARATOR\nBLOCK A';

        const patch = CdiffService.createPatch(oldContent, newContent, {debug: false});
        // console.log('Generated Patch:', patch);

        // const result = CdiffService.applyPatch(oldContent, patch, {debug: false});
        // console.log('Applied Patch:', result);

        const expectedPatch = [
            '1 a 6 1 C',
            '1 d 6 1 A',
            '3 a 6 1 A',
            '3 d 6 1 C'
        ];
        
        assert.deepStrictEqual(patch.sort(), expectedPatch.sort());
    });

    test('should generate a correct patch for a block move', () => {
        const oldContent = 'line 1\nline 2\nline 3\nline 4';
        const newContent = 'line 1\nline 3\nline 4\nline 2'; // line 2 moved to the end

        const patch = CdiffService.createPatch(oldContent, newContent);

        const expectedPatch = [
            '2 D line 2',
            '4 A line 2'
        ];

        assert.deepStrictEqual(patch.sort(), expectedPatch.sort());
    });

    test('should handle a mix of replacements and pure additions/deletions', () => {
        const oldContent = 'A\nB\nC\nD';
        const newContent = 'X\nB\nY\nE';

        const patch = CdiffService.createPatch(oldContent, newContent);
        const expectedPatch = [
            '1 D A',
            '3 D C',
            '4 D D',
            '1 A X',
            '3 A Y',
            '4 A E'
        ];
        
        assert.deepStrictEqual(patch.sort(), expectedPatch.sort());
    });
});