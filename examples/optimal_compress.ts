import { CdiffService } from '../src/cdiff.js';

const oldText = "This is a simple text.";
const newText = "This is a simple test.";

console.log('--- Normal Compress (Might be larger due to overhead) ---');
const normal = CdiffService.createPatch(oldText, newText, { compress: true, optimal: false });
console.log('Length:', normal.join('\n').length);
console.log(normal);

console.log('\n--- Optimal Compress (Falls back to plain text) ---');
const optimal = CdiffService.createPatch(oldText, newText, { compress: true, optimal: true });
console.log('Length:', optimal.join('\n').length);
console.log(optimal);

console.log('\n--- Unsafe Deletion (One-way) ---');
const unsafe = CdiffService.createPatch(oldText, newText, { deletionStrategy: 'unsafe', granularity: 'lines' });
console.log(unsafe);

// --- Normal Compress (Might be larger due to overhead) ---
// Length: 23
// [ '~', '$', '2 d L 1 x', '2 a L 1 s' ]

// --- Optimal Compress (Falls back to plain text) ---
// Length: 21
// [ '1 d 19 1 x', '1 a 19 1 s' ]

// --- Unsafe Deletion with granularity: 'lines' (One-way) ---
// [ '1 X ', '1 A This is a simple test.' ]