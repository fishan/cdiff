// benchmarks/index.ts
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url'; // Import necessary functions
import { CdiffService } from '../src/cdiff.js';
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
}

// --- cdiff ---
function runCdiff(oldStr: string, newStr: string): BenchmarkResult {
  const startCreate = performance.now();
  const patch = CdiffService.createPatch(oldStr, newStr);
  const createTime = performance.now() - startCreate;
  const startApply = performance.now();
  CdiffService.applyPatch(oldStr, patch);
  const applyTime = performance.now() - startApply;
  return {
    name: 'cdiff',
    patchSize: JSON.stringify(patch).length,
    createTime,
    applyTime,
  };
}

// --- jsdiff (unified format) ---
function runJsDiff(oldStr: string, newStr: string): BenchmarkResult {
  const startCreate = performance.now();
  const patchText = jsdiff.createTwoFilesPatch('old', 'new', oldStr, newStr);
  const createTime = performance.now() - startCreate;
  const startApply = performance.now();
  jsdiff.applyPatch(oldStr, patchText);
  const applyTime = performance.now() - startApply;
  return {
    name: 'jsdiff (unified)',
    patchSize: patchText.length,
    createTime,
    applyTime,
  };
}

// --- diff-match-patch ---
function runDMP(oldStr: string, newStr: string): BenchmarkResult {
  const dmp = new diff_match_patch();
  const startCreate = performance.now();
  const diffs = dmp.diff_main(oldStr, newStr);
  dmp.diff_cleanupSemantic(diffs);
  const patch = dmp.patch_make(oldStr, diffs);
  const patchText = dmp.patch_toText(patch);
  const createTime = performance.now() - startCreate;
  const startApply = performance.now();
  dmp.patch_apply(patch, oldStr);
  const applyTime = performance.now() - startApply;
  return {
    name: 'diff-match-patch',
    patchSize: patchText.length,
    createTime,
    applyTime,
  };
}

// --- Data Loading ---
function loadFile(filename: string): string {
  // Now path.join works correctly because __dirname is defined
  return fs.readFileSync(path.join(__dirname, 'data', filename), 'utf8');
}

// --- Modified Version Generators ---
function createBaseModifiedVersion(original: string, filename: string): string {
  if (filename === 'small.json') {
    // Change the version in package.json
    return original.replace(/"version": "[^"]+"/, '"version": "999.999.999"');
  } else if (filename === 'medium.js') {
    // Rename the main class
    return original.replace(/class Axios/g, 'class AxiosClient');
  } else if (filename === 'large.js') {
    // Add a comment to the beginning
    return '// MODIFIED FOR BENCHMARK\n' + original;
  }
  return original;
}

function createRefactorModifiedVersion(original: string): string {
    // Simulate multiple small refactorings in jQuery
    return original
        .replace(/jQuery.fn.init/g, 'jQuery.fn.initialize')
        .replace(/isFunction/g, 'isFunc')
        .replace(/slice.call/g, 'arraySlice.call');
}

function createBlockMoveModifiedVersion(original: string): string {
    // Move a chunk of code from the middle to the end
    const lines = original.split('\n');
    if (lines.length < 100) return original; // Not applicable for small files
    const block = lines.splice(500, 50); // Move 50 lines from line 500
    return [...lines, ...block].join('\n');
}

function createWhitespaceModifiedVersion(original: string): string {
    // Change indentation from 2 to 4 spaces
    return original.replace(/  /g, '    ');
}


// --- Benchmark Runner ---
function runBenchmark(scenarioName: string, oldContent: string, newContent: string) {
  console.log(`\n=== ${scenarioName} ===`);
  const results = [
    runCdiff(oldContent, newContent),
    runJsDiff(oldContent, newContent),
    runDMP(oldContent, newContent),
  ];

  const bestSize = Math.min(...results.map(r => r.patchSize));
  const bestTotalTime = Math.min(...results.map(r => r.createTime + r.applyTime));

  console.table(results.map(r => {
      const totalTime = r.createTime + r.applyTime;
      return {
          'Library': r.name + (r.patchSize === bestSize ? ' 🥇' : ''),
          'Patch Size (B)': r.patchSize,
          'Create (ms)': r.createTime.toFixed(2),
          'Apply (ms)': r.applyTime.toFixed(2),
          'Total (ms)': totalTime.toFixed(2) + (totalTime === bestTotalTime ? ' 🥇' : ''),
      };
  }));
}

// --- Main Execution ---
async function main() {
  const files = ['small.json', 'medium.js', 'large.js'];

  // Scenario 1: Basic realistic changes
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
  
  // Scenario 2: Advanced Scenarios
  try {
      const largeFile = loadFile('large.js');
      const mediumFile = loadFile('medium.js');

      runBenchmark(
          'Code Refactoring (many small changes in large.js)',
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
}

main().catch(console.error);