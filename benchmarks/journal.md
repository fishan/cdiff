# MyersDiff Optimization Journal

This journal tracks the optimization attempts for the custom `MyersDiff` implementation. All benchmarks are run using `myers_benchmark.ts`.

---

### **V1: Baseline Implementation**

* **Date:** 2025-09-30
* **Change:** Established the initial, functionally correct version of the algorithm. The logic is based on the `jsdiff` forward-path approach, which is robust but not yet optimized for performance. The choice was made to prioritize grouped output (deletions before insertions) for better patch readability.
* **Hypothesis:** This version will be the slowest and serve as the baseline for all future improvements. Key areas for optimization are likely memory allocations (e.g., the `bestPath` object) and the number of iterations.
* **Results:**
    * *(Run `npm run benchmark:myers` to fill this section with initial performance data)*

---

### **V2: Tokenization (String to Uint32Array)**

* **Date:** 2025-10-01
* **Change:** Refactored the core `diff` method. Instead of operating on `string[]`, the inputs (`oldTokens`, `newTokens`) are now tokenized into `Uint32Array`. A `Map<string, number>` tracks unique tokens. The internal diff logic (`_findMiddleSnake`, `_findPath`) now compares 32-bit integers, not strings.
* **Hypothesis:** This will provide a massive performance boost. String comparisons (`"tokenA" === "tokenB"`) are slow (byte-by-byte), while integer comparisons (`12345 === 12346`) are a single, fast CPU operation. This should significantly speed up the main O(ND) loop, especially on large arrays.
* **Results:**
    * *(Awaiting benchmark data)*

---

### **V3: L1 Anchor Optimization (Global Scan)**

* **Date:** 2025-10-05
* **Change:** Implemented `_findAnchors`. Instead of diffing the *entire* file (e.g., 50k vs 50k lines) in one massive `O(ND)` operation, the engine first scans for large, high-confidence identical blocks (L1 Anchors) using a rolling hash. The expensive `_recursiveDiff` (Myers O(ND)) is now only run on the small "gaps" *between* these anchors.
* **Hypothesis:** This will change the performance characteristic from O(ND) (which approaches O(N^2) on dissimilar files) to something closer to O(N) on large files with high similarity (like source code). It should *dramatically* improve performance on "Huge File" benchmarks and prevent timeouts on "Low Similarity" benchmarks.
* **Results:**
    * *(Awaiting benchmark data)*