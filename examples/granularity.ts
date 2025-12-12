import { CdiffService } from '../src/cdiff.js';

const oldCode = `const config = {
  port: 8080,
  timeout: 5000,
  debug: false
};`;

const newCode = `const config = {
  port: 3000, // changed
  timeout: 5000,
  debug: true // changed
};`;

console.log('--- Granularity: Mixed (Default) ---');
// Generates optimized char-level diffs ('d', 'a') inside lines
const mixedPatch = CdiffService.createPatch(oldCode, newCode, { granularity: 'mixed' });
console.log(mixedPatch);

console.log('\n--- Granularity: Lines ---');
// Generates full line replacements ('D', 'A')
const linesPatch = CdiffService.createPatch(oldCode, newCode, { granularity: 'lines' });
console.log(linesPatch);