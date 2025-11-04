import * as assert from 'assert';
import { 
    MyersCoreDiff, 
    DiffOperation
} from '@fishan/myers-core-diff';
import { CdiffService } from '../src/cdiff.js';
import { CdiffCharService } from '../src/cdiff_chars.js';

describe('MyersCoreDiff - Swapped Blocks Edge Cases', () => {
  const createSwappedBlocks = () => {
    const blockA = [
      '// Execute a callback for every element in the matched set.',
      'each: function( callback ) {',
      '    return jQuery.each( this, callback );',
      '},'
    ];
    const blockB = [
      'rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),',
      'rleadingCombinator = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" +',
      '    whitespace + "*" ),',
      'rdescend = new RegExp( whitespace + "|>" ),'
    ];
    const prefix = ['line0'];
    const suffix = ['line999'];

    const oldLines = [...prefix, ...blockA, ...blockB, ...suffix];
    const newLines = [...prefix, ...blockB, ...blockA, ...suffix];

    return { oldLines, newLines };
  };

  it('1. Raw diff from MyersCoreDiff must be valid and reversible', () => {
    const { oldLines, newLines } = createSwappedBlocks();
    const myers = new MyersCoreDiff();
    const diff = myers.diff(oldLines, newLines, false);

    let reconstructedOld = '';
    let reconstructedNew = '';
    for (const [op, token] of diff) {
      if (op === DiffOperation.REMOVE || op === DiffOperation.EQUAL) {
        reconstructedOld += token + '\n';
      }
      if (op === DiffOperation.ADD || op === DiffOperation.EQUAL) {
        reconstructedNew += token + '\n';
      }
    }
    reconstructedOld = reconstructedOld.slice(0, -1);
    reconstructedNew = reconstructedNew.slice(0, -1);

    assert.strictEqual(reconstructedOld, oldLines.join('\n'));
    assert.strictEqual(reconstructedNew, newLines.join('\n'));
  });

  it('2. _findMiddleSnake must not return invalid snake on swapped blocks', () => {
    const { oldLines, newLines } = createSwappedBlocks();
    const myers = new MyersCoreDiff();
    const { hashedOld, hashedNew } = myers['_tokenize'](oldLines, newLines);

    const snake = myers['_findMiddleSnake'](
      hashedOld, 0, hashedOld.length,
      hashedNew, 0, hashedNew.length,
      false
    );

    if (snake) {
      const N = hashedOld.length;
      const M = hashedNew.length;
      assert.ok(snake.x >= 0);
      assert.ok(snake.y >= 0);
      assert.ok(snake.u <= N);
      assert.ok(snake.v <= M);
      assert.ok(snake.u >= snake.x);
      assert.ok(snake.v >= snake.y);

      for (let i = 0; i < snake.u - snake.x; i++) {
        assert.strictEqual(hashedOld[snake.x + i], hashedNew[snake.y + i]);
      }
    }
  });

  it('3. calculateDiff must produce valid diff when _recursiveDiff fails', () => {
    const { oldLines, newLines } = createSwappedBlocks();
    const myers = new MyersCoreDiff();
    const { hashedOld, hashedNew, idToString } = myers['_tokenize'](oldLines, newLines);

    const diff = myers['calculateDiff'](
      hashedOld, 0, hashedOld.length,
      hashedNew, 0, hashedNew.length,
      idToString,
    );

    let reconstructedOld = '';
    let reconstructedNew = '';
    for (const [op, token] of diff) {
      if (op === DiffOperation.REMOVE || op === DiffOperation.EQUAL) {
        reconstructedOld += token + '\n';
      }
      if (op === DiffOperation.ADD || op === DiffOperation.EQUAL) {
        reconstructedNew += token + '\n';
      }
    }
    reconstructedOld = reconstructedOld.slice(0, -1);
    reconstructedNew = reconstructedNew.slice(0, -1);

    assert.strictEqual(reconstructedOld, oldLines.join('\n'));
    assert.strictEqual(reconstructedNew, newLines.join('\n'));
  });

  it('4. Full CdiffService patch must apply correctly on swapped blocks', () => {
    const { oldLines, newLines } = createSwappedBlocks();
    const oldContent = oldLines.join('\n');
    const newContent = newLines.join('\n');

    const patch = CdiffService.createPatch(oldContent, newContent, { debug: false });
    const patched = CdiffService.applyPatch(oldContent, patch, { strictMode: true });

    assert.strictEqual(patched, newContent);
  });

  it('5. Character-level patch must be valid and reversible', () => {
    const oldLine = '// Execute a callback for every element in the matched set.';
    const newLine = 'rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),';

    const charPatch = CdiffCharService.createPatch(oldLine, newLine, 1, { mode: 'text' });
    const patched = CdiffCharService.applyPatch(oldLine, charPatch, { mode: 'text' });

    assert.strictEqual(patched, newLine);

    const invertedPatch = CdiffCharService.invertPatch(charPatch);
    const reverted = CdiffCharService.applyPatch(newLine, invertedPatch, { mode: 'text' });
    assert.strictEqual(reverted, oldLine);
  });
});
