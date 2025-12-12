import { CdiffService } from '../src/cdiff.js';

const oldCode = 'if (a) {\n  b();\n}\nc();';
const newCode = 'c();\nif (a) {\n  b();\n}'; // Block move

// Use 'patienceDiff' which is good at detecting block moves
const patch = CdiffService.createPatch(oldCode, newCode, {
  diffStrategyName: 'patienceDiff'
});

console.log(patch);

// Outout: [ '~', '$', '2-3 d* L 5 World', '2-3 a* L 4 User' ]
