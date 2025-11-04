// benchmarks/index.ts
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// v2 (current source)
import { CdiffService } from '../src/cdiff.js';
// v1 (aliased)
import { CdiffService as CdiffService_v1 } from 'cdiff_v1';
import * as jsdiff from 'diff';
import { diff_match_patch } from 'diff-match-patch';

// ESM-compatible equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface BenchmarkResult {
    name: string;
    patchSize: number;
    createTime: number;
    applyTime: number;
    correctness: '✅ OK' | '❌ FAILED' | '⚠️ N/A';
}

interface InvertBenchmarkResult {
    name: string;
    invertApplyTime: number;
    correctness: '✅ OK' | '❌ FAILED';
}

// v2 Options Type (matches the one in src/cdiff.ts)
export type CdiffOptions = {
    mode?: 'text' | 'binary';
    debug?: boolean;
    compress?: boolean;
    diffStrategyName?: string;
    includeEqualMode?: 'none' | 'inline' | 'separate' | 'context';
    includeCharEquals?: boolean;
    deletionStrategy?: 'safe' | 'unsafe' | ((content: string, lineNum: number) => 'safe' | 'unsafe');
    validationLevel?: 'none' | 'raw' | 'raw-invert' | 'final' | 'final-invert' | 'compressed' | 'compressed-invert' | 'all' | 'all-invert';
};

export type ApplyOptions = {
    strictMode?: boolean;
    onWarning?: (message: string) => void;
    debug?: boolean;
    inverting?: boolean;
    mode?: 'text' | 'binary';
    includeCharEquals?: boolean;
};

// --- cdiff v1 (Legacy) ---
function runCdiff_v1(oldStr: string, newStr: string): BenchmarkResult {
    const startCreate = performance.now();
    // v1 API was simpler, no options
    const patch = CdiffService_v1.createPatch(oldStr, newStr); 
    const createTime = performance.now() - startCreate;

    const startApply = performance.now();
    const patchedStr = CdiffService_v1.applyPatch(oldStr, patch);
    const applyTime = performance.now() - startApply;

    return {
        name: 'cdiff v1 (Legacy)',
        patchSize: JSON.stringify(patch).length,
        createTime,
        applyTime,
        correctness: patchedStr === newStr ? '✅ OK' : '❌ FAILED',
    };
}
function runCdiffInvert_v1(oldStr: string, newStr: string): InvertBenchmarkResult {
    const patch = CdiffService_v1.createPatch(oldStr, newStr);
    const startInvert = performance.now();
    const invertedPatch = CdiffService_v1.invertPatch(patch);
    const restoredStr = CdiffService_v1.applyInvertedPatch(newStr, invertedPatch);
    const invertApplyTime = performance.now() - startInvert;

    return {
        name: 'cdiff v1 (Legacy)',
        invertApplyTime,
        correctness: restoredStr === oldStr ? '✅ OK' : '❌ FAILED',
    };
}


// --- cdiff v2 (Safe + Compress) ---
function runCdiff_v2_Safe(oldStr: string, newStr: string, cdiffOptions?: CdiffOptions): BenchmarkResult {
    const options: CdiffOptions = {
        ...cdiffOptions,
        debug: false,
        compress: true,
        diffStrategyName: 'preserveStructure',
        deletionStrategy: 'safe', // Default, but explicit
        validationLevel: 'none'
    };
    
    let patch: string[] = [];
    let createTime = 0;
    let applyTime = 0;
    let patchedStr = '';
    let isCorrect = false;
    let applyError: Error | null = null;

    try {
        const startCreate = performance.now();
        patch = CdiffService.createPatch(oldStr, newStr, options);
        createTime = performance.now() - startCreate;

        try {
            const startApply = performance.now();
            patchedStr = CdiffService.applyPatch(oldStr, patch, { mode: options.mode, debug: false, strictMode: true });
            applyTime = performance.now() - startApply;
            isCorrect = patchedStr === newStr;
        } catch(e) {
            applyError = e as Error;
            isCorrect = false;
        }
    } catch (createError) {
        console.error('\n[cdiff v2 Safe] BENCHMARK FAILED DURING PATCH CREATION:', createError);
        isCorrect = false;
    }

    if (applyError) {
        console.error(`\n[cdiff v2 Safe] ERROR DURING CdiffService.applyPatch: ${applyError.message}\n`);
    } else if (!isCorrect && createTime > 0) {
         console.warn(`\n[cdiff v2 Safe] DIAGNOSTIC: Patched content did not match expected content.\n`);
    }

    return {
        name: 'cdiff v2 (Safe+Compress) 🥇',
        patchSize: JSON.stringify(patch).length,
        createTime,
        applyTime,
        correctness: isCorrect ? '✅ OK' : '❌ FAILED',
    };
}
function runCdiffInvert_v2_Safe(oldStr: string, newStr: string, cdiffOptions?: ApplyOptions): InvertBenchmarkResult {
    const patch = CdiffService.createPatch(oldStr, newStr, { 
        mode: cdiffOptions?.mode, 
        compress: true, 
        deletionStrategy: 'safe' 
    });
    
    const startInvert = performance.now();
    const invertedPatch = CdiffService.invertPatch(patch);
    const restoredStr = CdiffService.applyInvertedPatch(newStr, invertedPatch, { ...cdiffOptions, strictMode: true });
    const invertApplyTime = performance.now() - startInvert;

    return {
        name: 'cdiff v2 (Safe+Compress) 🥇',
        invertApplyTime,
        correctness: restoredStr === oldStr ? '✅ OK' : '❌ FAILED',
    };
}


// --- cdiff v2 (Unsafe + Compress) ---
function runCdiff_v2_Unsafe(oldStr: string, newStr: string, cdiffOptions?: CdiffOptions): BenchmarkResult {
    const options: CdiffOptions = {
        ...cdiffOptions,
        debug: false,
        compress: true,
        diffStrategyName: 'preserveStructure',
        deletionStrategy: 'unsafe', // ONE-WAY
        validationLevel: 'none'
    };
    
    let patch: string[] = [];
    let createTime = 0;
    let applyTime = 0;
    let patchedStr = '';
    let isCorrect = false;
    let applyError: Error | null = null;

    try {
        const startCreate = performance.now();
        patch = CdiffService.createPatch(oldStr, newStr, options);
        createTime = performance.now() - startCreate;

        try {
            const startApply = performance.now();
            patchedStr = CdiffService.applyPatch(oldStr, patch, { mode: options.mode, debug: false, strictMode: true });
            applyTime = performance.now() - startApply;
            isCorrect = patchedStr === newStr;
        } catch(e) {
            applyError = e as Error;
            isCorrect = false;
        }
    } catch (createError) {
        console.error('\n[cdiff v2 Unsafe] BENCHMARK FAILED DURING PATCH CREATION:', createError);
        isCorrect = false;
    }

    if (applyError) {
        console.error(`\n[cdiff v2 Unsafe] ERROR DURING CdiffService.applyPatch: ${applyError.message}\n`);
    } else if (!isCorrect && createTime > 0) {
         console.warn(`\n[cdiff v2 Unsafe] DIAGNOSTIC: Patched content did not match expected content.\n`);
    }

    return {
        name: 'cdiff v2 (Unsafe+Compress)',
        patchSize: JSON.stringify(patch).length,
        createTime,
        applyTime,
        correctness: isCorrect ? '✅ OK' : '❌ FAILED',
    };
}
// N/A: Unsafe patches cannot be inverted.


// --- jsdiff (unified format) ---
function runJsDiff(oldStr: string, newStr: string): BenchmarkResult {
    try {
        const startCreate = performance.now();
        const patchText = jsdiff.createTwoFilesPatch('old', 'new', oldStr, newStr);
        const createTime = performance.now() - startCreate;

        const startApply = performance.now();
        const patchedStr = jsdiff.applyPatch(oldStr, patchText);
        const applyTime = performance.now() - startApply;

        const isCorrect = patchedStr !== false && patchedStr === newStr;
        return {
            name: 'jsdiff (unified)',
            patchSize: patchText.length,
            createTime,
            applyTime,
            correctness: isCorrect ? '✅ OK' : '❌ FAILED',
        };
    } catch (e) {
        return { name: 'jsdiff (unified)', patchSize: 0, createTime: 0, applyTime: 0, correctness: '❌ FAILED' };
    }
}

function runJsDiffInvert(oldStr: string, newStr: string): InvertBenchmarkResult {
    const startInvert = performance.now();
    // No direct invert, so we simulate by creating a reverse patch
    const invertedPatchText = jsdiff.createTwoFilesPatch('new', 'old', newStr, oldStr);
    const restoredStr = jsdiff.applyPatch(newStr, invertedPatchText);
    const invertApplyTime = performance.now() - startInvert;

    const isCorrect = restoredStr !== false && restoredStr === oldStr;
    return {
        name: 'jsdiff (unified)',
        invertApplyTime,
        correctness: isCorrect ? '✅ OK' : '❌ FAILED',
    };
}


// --- diff-match-patch ---
function runDMP(oldStr: string, newStr: string): BenchmarkResult {
    try {
        const dmp = new diff_match_patch();
        const startCreate = performance.now();
        const diffs = dmp.diff_main(oldStr, newStr);
        dmp.diff_cleanupSemantic(diffs);
        const patch = dmp.patch_make(oldStr, diffs);
        const patchText = dmp.patch_toText(patch);
        const createTime = performance.now() - startCreate;

        const startApply = performance.now();
        const [patchedStr, results] = dmp.patch_apply(patch, oldStr);
        const applyTime = performance.now() - startApply;

        const isCorrect = results.every(r => r) && patchedStr === newStr;
        return {
            name: 'diff-match-patch',
            patchSize: patchText.length,
            createTime,
            applyTime,
            correctness: isCorrect ? '✅ OK' : '❌ FAILED',
        };
    } catch (e) {
        return { name: 'diff-match-patch', patchSize: 0, createTime: 0, applyTime: 0, correctness: '❌ FAILED' };
    }
}

function runDMPInvert(oldStr: string, newStr: string): InvertBenchmarkResult {
    const dmp = new diff_match_patch();

    const startInvert = performance.now();
    // No direct invert, simulate by creating a reverse patch
    const diffs = dmp.diff_main(newStr, oldStr);
    const patch = dmp.patch_make(newStr, diffs);
    const [restoredStr, results] = dmp.patch_apply(patch, newStr);
    const invertApplyTime = performance.now() - startInvert;

    const isCorrect = results.every(r => r) && restoredStr === oldStr;
    return {
        name: 'diff-match-patch',
        invertApplyTime,
        correctness: isCorrect ? '✅ OK' : '❌ FAILED',
    };
}


// --- Data Loading ---
function loadFile(filename: string): string {
    return fs.readFileSync(path.join(__dirname, 'data', filename), 'utf8');
}


// --- Modified Version Generators ---
function createBaseModifiedVersion(original: string, filename: string): string {
    if (filename === 'small.json') {
        return original.replace(/"version": "[^"]+"/, '"version": "999.999.999"');
    } else if (filename === 'medium.js') {
        return original.replace(/class Axios/g, 'class AxiosClient');
    } else if (filename === 'large.js') {
        return '// MODIFIED FOR BENCHMARK\n' + original;
    }
    return original;
}

function createRefactorModifiedVersion(original: string): string {
    return original
        .replace(/jQuery.fn.init/g, 'jQuery.fn.initialize')
        .replace(/isFunction/g, 'isFunc')
        .replace(/slice.call/g, 'arraySlice.call');
}

function createBlockMoveModifiedVersion(original: string): string {
    const lines = original.split('\n');
    if (lines.length < 100) return original;
    const block = lines.splice(500, 50);
    return [...lines, ...block].join('\n');
}

function createWhitespaceModifiedVersion(original: string): string {
    return original.replace(/  /g, '    ');
}

function generateHugeFileContent(lines: number): { original: string; modified: string } {
    const originalLines: string[] = [];
    for (let i = 0; i < lines; i++) {
        originalLines.push(`const item_${i} = { id: ${i}, value: "value_${i}", status: "active" };`);
    }
    const modifiedLines = [...originalLines];
    modifiedLines[Math.floor(lines * 0.1)] = '// First modification';
    modifiedLines[Math.floor(lines * 0.5)] = '// Second modification';
    modifiedLines[Math.floor(lines * 0.9)] = '// Third modification';
    return { original: originalLines.join('\n'), modified: modifiedLines.join('\n') };
}

function generateBinaryData(): { original: string; modified: string } {
    const size = 1024;
    const originalBuffer = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
        originalBuffer[i] = i % 256;
    }
    const modifiedBuffer = Buffer.from(originalBuffer);
    modifiedBuffer[100] = 0xFF; // Change some bytes
    modifiedBuffer[500] = 0xAA;
    return {
        original: originalBuffer.toString('latin1'),
        modified: modifiedBuffer.toString('latin1'),
    };
}

function createDirtyVersion(): { original: string, modified: string } {
    const prefix = ' '.repeat(50000) + 'HEADER\n';
    const suffix = '\nFOOTER' + ' '.repeat(50000);
    const original = prefix + 'This is the original content.' + suffix;
    const modified = prefix + 'This is the MODIFIED content.' + suffix;
    return { original, modified };
}

function generateLowEntropyContent(): { original: string, modified: string } {
    const baseLine = 'log_entry: success|user_id:123|timestamp:1665590400\n';
    const original = baseLine.repeat(10000);
    const lines = original.split('\n');
    lines[1000] = lines[1000].replace('success', 'failure');
    lines[5000] = lines[5000].replace('success', 'failure');
    lines[9000] = lines[9000].replace('success', 'failure');
    const modified = lines.join('\n');
    return { original, modified };
}

function createSingleLineModifiedVersion(original: string): { original: string, modified: string } {
    const minifiedOriginal = original
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // remove comments
        .replace(/\s+/g, ' '); // collapse whitespace
    const minifiedModified = createRefactorModifiedVersion(minifiedOriginal);
    return { original: minifiedOriginal, modified: minifiedModified };
}

function createSwappedBlocksVersion(original: string): { original: string, modified: string } {
    const lines = original.split('\n');
    if (lines.length < 1000) return { original, modified: original }; // Skip if too short

    const blockA = lines.splice(200, 50); // Cut block A
    const blockB = lines.splice(700 - 50, 50); // Cut block B (indices shift)

    // Insert B where A was, then A where B was
    lines.splice(200, 0, ...blockB);
    lines.splice(700, 0, ...blockA);

    return { original: original, modified: lines.join('\n') };
}

// --- Benchmark Runners ---
function runBenchmark(scenarioName: string, oldContent: string, newContent: string, cdiffOptions?: CdiffOptions) {
    console.log(`\n=== ${scenarioName} ===`);
    const results = [
        runCdiff_v1(oldContent, newContent),
        runCdiff_v2_Safe(oldContent, newContent, cdiffOptions),
        runCdiff_v2_Unsafe(oldContent, newContent, cdiffOptions),
        runJsDiff(oldContent, newContent),
        runDMP(oldContent, newContent),
    ];

    const bestSize = Math.min(...results.map(r => r.patchSize).filter(s => s > 0));
    const bestTotalTime = Math.min(...results.map(r => r.createTime + r.applyTime));

    console.table(results.map(r => {
        const totalTime = r.createTime + r.applyTime;
        const sizeTag = (r.patchSize === bestSize && r.patchSize > 0) ? ' 🥇' : '';
        const timeTag = (totalTime === bestTotalTime) ? ' 🥇' : '';
        return {
            'Library': r.name + sizeTag,
            'Patch Size (B)': r.patchSize,
            'Create (ms)': r.createTime.toFixed(2),
            'Apply (ms)': r.applyTime.toFixed(2),
            'Total (ms)': totalTime.toFixed(2) + timeTag,
            'Correctness': r.correctness,
        };
    }));
}

function runBenchmarkInvert(scenarioName: string, oldContent: string, newContent: string, cdiffOptions?: ApplyOptions) {
    console.log(`\n=== ${scenarioName} ===`);
    const results = [
        runCdiffInvert_v1(oldContent, newContent),
        runCdiffInvert_v2_Safe(oldContent, newContent, cdiffOptions),
        // v2 Unsafe cannot be inverted
        runJsDiffInvert(oldContent, newContent),
        runDMPInvert(oldContent, newContent),
    ];

    const bestTime = Math.min(...results.map(r => r.invertApplyTime));

    console.table(results.map(r => {
        return {
            'Library': r.name + (r.invertApplyTime === bestTime ? ' 🥇' : ''),
            'Invert+Apply (ms)': r.invertApplyTime.toFixed(2),
            'Correctness': r.correctness,
        };
    }));
}

// --- Main Execution ---
async function main() {
    const files = ['small.json', 'medium.js', 'large.js'];

    // const files = ['small.json'];

    console.log('--- Standard Benchmarks ---');
    for (const filename of files) {
        try {
            const original = loadFile(filename);
            const modified = createBaseModifiedVersion(original, filename);
            const displayName = filename.replace('.json', ' (package.json)').replace('.js', ' (source code)');
            runBenchmark(`Realistic change in ${displayName}`, original, modified);
        } catch (e) {
            console.warn(`Skipping ${filename}:`, (e as Error).message);
        }
    }

    console.log('\n--- Advanced Scenarios ---');
    try {
        const largeFile = loadFile('large.js');
        const mediumFile = loadFile('medium.js');

          runBenchmark(
              'Multiple Small Changes (large file)',
              largeFile,
              createRefactorModifiedVersion(largeFile)
          );
          runBenchmark(
              'Block Move (structural shift in large.js)',
              largeFile,
              createBlockMoveModifiedVersion(largeFile)
          );
          runBenchmark(
              'Whitespace Change (indentation in medium.js)',
              mediumFile,
              createWhitespaceModifiedVersion(mediumFile)
          );

    } catch (e) {
        console.warn(`Skipping advanced scenarios:`, (e as Error).message);
    }

    console.log('\n--- Inversion Benchmarks (Refactoring Scenario) ---');
    try {
        const largeFile = loadFile('large.js');
        runBenchmarkInvert(
            'Invert Patch from Refactoring',
            largeFile,
            createRefactorModifiedVersion(largeFile)
        );
    } catch (e) {
        console.warn('Skipping inversion benchmark:', (e as Error).message);
    }

    console.log('\n--- Core Strength Benchmarks ---');
    // 1. Huge File
    const { original: hugeOriginal, modified: hugeModified } = generateHugeFileContent(50000);
    runBenchmark('Huge File (50k lines)', hugeOriginal, hugeModified);

    // 2. Binary Data
    const { original: binOriginal, modified: binModified } = generateBinaryData();
    runBenchmark('Binary Data (1KB)', binOriginal, binModified, { mode: 'binary' });

    // 3. "Dirty" Data
    const { original: dirtyOriginal, modified: dirtyModified } = createDirtyVersion();
    runBenchmark('"Dirty" Data (Large common prefix/suffix)', dirtyOriginal, dirtyModified);

    console.log('\n--- Edge Case & Stress Test Scenarios ---');
    try {
        const largeFile = loadFile('large.js');
        const mediumFile = loadFile('medium.js');

        // 1. Low Entropy
        const { original: lowEntropyOriginal, modified: lowEntropyModified } = generateLowEntropyContent();
        runBenchmark('Low Entropy (Repeating Data)', lowEntropyOriginal, lowEntropyModified);

        // 2. Single Line Changes
        const { original: singleLineOriginal, modified: singleLineModified } = createSingleLineModifiedVersion(largeFile);
        runBenchmark('Single Line Changes (Minified JS)', singleLineOriginal, singleLineModified);

        // 3. Complete Replacement
        runBenchmark('Complete Replacement (Low Similarity)', largeFile, mediumFile);

        // 3.1 Complete Replacement Invert
        runBenchmarkInvert('Complete Replacement Invert (Low Similarity)', largeFile, mediumFile);

        // 4. Swapped Blocks
        const { original: swappedOriginal, modified: swappedModified } = createSwappedBlocksVersion(largeFile);
        runBenchmark('Swapped Blocks', swappedOriginal, swappedModified);

    } catch (e) {
        console.warn(`Skipping edge case scenarios:`, (e as Error).message);
    }
}

main().catch(console.error);