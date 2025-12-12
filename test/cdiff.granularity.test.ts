import { suite, test } from 'mocha';
import * as assert from 'assert';
import { CdiffService } from '../src/cdiff.js';
import { 
    MyersCoreDiff,
    registerPatienceDiffStrategy,
    registerPreserveStructureStrategy
} from '@fishan/myers-core-diff';

// Register strategies
registerPatienceDiffStrategy(MyersCoreDiff);
registerPreserveStructureStrategy(MyersCoreDiff);

suite('CdiffService: Granularity and Optimal Options', () => {

    // --- 1. Granularity Tests ---

    test("granularity: 'lines' should force line-level commands (ignore char optimizations)", () => {
        const oldText = "const x = 1;";
        const newText = "const x = 2;";

        // In 'mixed' mode (default), this would create 'd'/'a' commands
        const patchMixed = CdiffService.createPatch(oldText, newText, { granularity: 'mixed' });
        const hasCharCommandsMixed = patchMixed.some(cmd => cmd.includes(' d ') || cmd.includes(' a '));
        assert.ok(hasCharCommandsMixed, "Mixed mode should produce char commands for small changes");

        // In 'lines' mode, this must create D/A
        const patchLines = CdiffService.createPatch(oldText, newText, { granularity: 'lines' });
        
        const hasCharCommandsLines = patchLines.some(cmd => cmd.includes(' d ') || cmd.includes(' a '));
        const hasLineCommandsLines = patchLines.some(cmd => cmd.includes(' D ') || cmd.includes(' A '));
        
        assert.strictEqual(hasCharCommandsLines, false, "Lines mode must NOT produce char commands");
        assert.strictEqual(hasLineCommandsLines, true, "Lines mode MUST produce line commands");

        // Verify application
        const result = CdiffService.applyPatch(oldText, patchLines);
        assert.strictEqual(result, newText);
    });

    test("granularity: 'mixed' (default) should choose optimal representation", () => {
        const oldText = "line1\nline2 is very long and has minor change\nline3";
        const newText = "line1\nline2 is very long and has minor Change\nline3";

        const patch = CdiffService.createPatch(oldText, newText); // default mixed
        
        // Char patch is much smaller than D+A for this long line
        const hasCharCommands = patch.some(cmd => cmd.includes(' d ') || cmd.includes(' a '));
        assert.ok(hasCharCommands, "Mixed mode should prefer char commands for minor edits in long lines");
        
        const result = CdiffService.applyPatch(oldText, patch);
        assert.strictEqual(result, newText);
    });

    test("granularity: 'chars' should throw not implemented error", () => {
        assert.throws(() => {
            CdiffService.createPatch("a", "b", { granularity: 'chars' });
        }, /granularity: "chars" is not yet implemented/);
    });

    test("granularity: invalid option should throw error", () => {
        assert.throws(() => {
            CdiffService.createPatch("a", "b", { granularity: 'invalid' as any });
        }, /Invalid granularity/);
    });

    test("granularity: 'lines' works correctly with includeEqualMode='inline'", () => {
        const oldText = "A\nB";
        const newText = "A\nC";
        
        const patch = CdiffService.createPatch(oldText, newText, { 
            granularity: 'lines',
            includeEqualMode: 'inline'
        });

        // Should have E+ (for A) and D/A (for B->C). No 'e' or 'd'.
        const hasEPlus = patch.some(cmd => cmd.includes(' E+ '));
        const hasSmallE = patch.some(cmd => cmd.includes(' e '));

        assert.ok(hasEPlus, "Should have E+ block");
        assert.strictEqual(hasSmallE, false, "Should NOT have char-level 'e' command");
    });

    // --- 2. Optimal Compression Tests ---

    test("optimal: true should prevent compressed patch from being larger (Anti-bloat)", () => {
        // Very short string. Compression headers (~, $) will add overhead larger than savings.
        const oldText = "A";
        const newText = "B";

        // 1. Forced compression
        const patchCompressed = CdiffService.createPatch(oldText, newText, { 
            compress: true, 
            optimal: false 
        });
        
        // 2. Optimal compression
        const patchOptimal = CdiffService.createPatch(oldText, newText, { 
            compress: true, 
            optimal: true 
        });

        // 3. Uncompressed
        const patchUncompressed = CdiffService.createPatch(oldText, newText, { 
            compress: false 
        });

        const sizeCompressed = patchCompressed.join('\n').length;
        const sizeUncompressed = patchUncompressed.join('\n').length;
        const sizeOptimal = patchOptimal.join('\n').length;

        // Compressed should be larger due to overhead
        assert.ok(sizeCompressed > sizeUncompressed, "Overhead should make compressed larger for tiny input");
        // Optimal should fall back to uncompressed
        assert.strictEqual(sizeOptimal, sizeUncompressed, "Optimal mode should return uncompressed version");
        
        assert.strictEqual(CdiffService.applyPatch(oldText, patchOptimal), newText);
    });

    test("optimal: true should keep compressed version if it is indeed smaller", () => {
        // We use varying line lengths here to produce different insertion indices.
        // This prevents 'mixed' mode from grouping all changes into a single 'a*' command
        // (which would be so efficient that compression adds no value).
        // Instead, we get 20 individual 'a' commands, each containing "COMMON_SUFFIX".
        // The compressor will deduplicate "COMMON_SUFFIX", leading to significant savings.
        
        let oldText = "";
        let newText = "";
        for (let i = 0; i < 20; i++) {
            const padding = ".".repeat(i); 
            oldText += `line ${i} ${padding}\n`;
            newText += `line ${i} ${padding}COMMON_SUFFIX\n`;
        }

        const patchUncompressed = CdiffService.createPatch(oldText, newText, { compress: false });
        const patchOptimal = CdiffService.createPatch(oldText, newText, { compress: true, optimal: true });

        const sizeUn = patchUncompressed.join('\n').length;
        const sizeOpt = patchOptimal.join('\n').length;

        assert.ok(sizeOpt < sizeUn, `Optimal size (${sizeOpt}) should be < Uncompressed size (${sizeUn})`);
        assert.strictEqual(patchOptimal[0], '~', "Should verify it is actually compressed");
        
        assert.strictEqual(CdiffService.applyPatch(oldText, patchOptimal), newText);
    });

    // --- 3. Complex Scenarios ---

    test("Scenario: 'lines' granularity with 'unsafe' deletionStrategy", () => {
        const oldText = "line1\nline2\nline3";
        const newText = "line1\nline3";

        const patch = CdiffService.createPatch(oldText, newText, {
            granularity: 'lines',
            deletionStrategy: 'unsafe'
        });

        // Expect X, not D (unsafe), and not d/x (lines)
        const hasUnsafeLine = patch.some(cmd => cmd.match(/\d+ X /));
        const hasSafeLine = patch.some(cmd => cmd.match(/\d+ D /));
        const hasChar = patch.some(cmd => cmd.match(/ [adx] /));

        assert.ok(hasUnsafeLine, "Should use X command");
        assert.strictEqual(hasSafeLine, false, "Should not use D command");
        assert.strictEqual(hasChar, false, "Should not use char commands");
        
        const result = CdiffService.applyPatch(oldText, patch);
        assert.strictEqual(result, newText);
    });

    test("Scenario: Validation works with granularity='lines'", () => {
        const oldText = "A";
        const newText = "B";
        
        // Should pass internal validation without error
        const patch = CdiffService.createPatch(oldText, newText, {
            granularity: 'lines',
            validationLevel: 'all-invert'
        });

        assert.strictEqual(patch.length, 2); // 1 D A, 1 A B
    });
});