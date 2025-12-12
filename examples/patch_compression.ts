import { CdiffService } from '../src/cdiff.js';

const oldContent = 'const val = "Hello World";\nconsole.log("Hello World");';
const newContent = 'const val = "Hello User";\nconsole.log("Hello User");';

// Enable compression
const patch = CdiffService.createPatch(oldContent, newContent, {
  compress: true, granularity: 'lines', optimal: true
});

console.log(patch);

// compress: true, granularity: 'mixed', optimal: true = [ '1-2 d* 19 5 World', '1-2 a* 19 4 User' ]
// compress: true, granularity: 'mixed', optimal: false = [ '~', '$', '2-3 d* L 5 World', '2-3 a* L 4 User' ]
// compress: true, granularity: 'lines', optimal: false = 
// [
//   '~',
//   '$',
//   '2 D+ 2',
//   'D const val = "Hello World";',
//   'D console.log("Hello World");',
//   '2 A+ 2',
//   'A const val = "Hello User";',
//   'A console.log("Hello User");'
// ]
// compress: true, granularity: 'lines', optimal: true = 
// [
//   '1 D const val = "Hello World";',
//   '2 D console.log("Hello World");',
//   '1 A const val = "Hello User";',
//   '2 A console.log("Hello User");'
// ]