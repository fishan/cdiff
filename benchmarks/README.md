# cdiff Benchmark Suite

This suite compares the performance and patch size of `cdiff` against other popular JavaScript diffing libraries:
- **`diff` (jsdiff)**: A robust library that generates unified diffs.
- **`diff-match-patch`**: A powerful and highly optimized library from Google.

The benchmarks test various real-world scenarios, from small configuration changes to large-scale code refactoring.

## How to Run the Benchmark

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Build the project:**
    ```bash
    npm run build
    ```

3.  **Run the benchmark script:**
    ```bash
    npm run benchmark
    ```

## Benchmark Results

Results generated on a standard development machine.  
* **Patch Size**: The size of the generated patch in bytes. Smaller is better. 🥇
* **Total Time**: The combined time for patch creation and application. Faster is better. 🥇

---

### **Standard Benchmarks**

**=== Realistic change in small (package (source code)on) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 50 | '10.48' | '5.32' | '15.81' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 259 | '2.65' | '2.52' | '5.17' | '✅ OK' |
| 2 | 'diff-match-patch' | 62 | '3.70' | '0.88' | '4.58 🥇' | '✅ OK' |

**=== Realistic change in medium (source code) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 26 | '1.31' | '0.30' | '1.61' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 401 | '1.15' | '1.58' | '2.72' | '✅ OK' |
| 2 | 'diff-match-patch' | 54 | '1.05' | '0.08' | '1.13 🥇' | '✅ OK' |

**=== Realistic change in large (source code) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 41 | '28.86' | '3.86' | '32.73' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 197 | '19.33' | '5.39' | '24.71' | '✅ OK' |
| 2 | 'diff-match-patch' | 59 | '1.09' | '0.54' | '1.63 🥇' | '✅ OK' |

### **Advanced Scenarios**

**=== Multiple Small Changes (large file) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 855 | '98.58' | '5.21' | '103.78' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 16942 | '18.59' | '3.54' | '22.13 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 3473 | '93.10' | '16.75' | '109.84' | '✅ OK' |

**=== Block Move (structural shift in large.js) ===**
*Moving a 50-line block of code.*
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 1830 | '38.25' | '5.08' | '43.33' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 2938 | '16.78' | '3.18' | '19.95' | '✅ OK' |
| 2 | 'diff-match-patch' | 3229 | '3.02' | '1.24' | '4.26 🥇' | '✅ OK' |

**=== Whitespace Change (indentation in medium.js) ===**
*Changing indentation from 2 to 4 spaces across a file.*
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 989 | '36.07' | '4.40' | '40.47' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 10834 | '21.00' | '0.52' | '21.52 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 7500 | '88.11' | '0.40' | '88.51' | '✅ OK' |

### **Inversion Benchmarks (Refactoring Scenario)**

**=== Invert Patch from Refactoring ===**
| (index) | Library | Invert+Apply (ms) | Correctness |
| :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | '6.97' | '✅ OK' |
| 1 | 'jsdiff (unified)' | '17.11' | '✅ OK' |
| 2 | 'diff-match-patch' | '82.50' | '✅ OK' |

### **Core Strength Benchmarks**

**=== Huge File (50k lines) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 281 | '199.66' | '27.13' | '226.79' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 2222 | '85.99' | '17.42' | '103.41' | '✅ OK' |
| 2 | 'diff-match-patch' | 470 | '39.52' | '14.76' | '54.28 🥇' | '✅ OK' |

**=== Binary Data (1KB) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 57 | '0.74' | '0.73' | '1.47' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 1672 | '0.16' | '0.31' | '0.47' | '✅ OK' |
| 2 | 'diff-match-patch' | 296 | '0.12' | '0.05' | '0.18 🥇' | '✅ OK' |

**=== "Dirty" Data (Large common prefix/suffix) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 47 | '0.89' | '0.29' | '1.18' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 100206 | '0.56' | '0.28' | '0.84' | '✅ OK' |
| 2 | 'diff-match-patch' | 58 | '0.26' | '0.04' | '0.30 🥇' | '✅ OK' |

### **Edge Case & Stress Test Scenarios**

**=== Low Entropy (Repeating Data) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 105 | '20.73' | '4.55' | '25.28' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 1972 | '13.08' | '4.02' | '17.10 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 330 | '108.60' | '2.95' | '111.55' | '✅ OK' |

**=== Single Line Changes (Minified JS) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 474 | '325.23' | '11.38' | '336.61' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 336055 | '1.15' | '0.50' | '1.65 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 3331 | '61.17' | '7.86' | '69.03' | '✅ OK' |

**=== Complete Replacement (Low Similarity) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 299375 | '1401.53' | '26.18' | '1427.72' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 301830 | '199.55' | '10.76' | '210.31 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 379704 | '1009.81' | '0.36' | '1010.18' | '✅ OK' |

**=== Complete Replacement Invert (Low Similarity) ===**
| (index) | Library | Invert+Apply (ms) | Correctness |
| :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | '28.63' | '✅ OK' |
| 1 | 'jsdiff (unified)' | '969.17' | '✅ OK' |
| 2 | 'diff-match-patch' | '1001.04' | '✅ OK' |

**=== Swapped Blocks ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 4487 | '24.17' | '5.90' | '30.07' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 6346 | '17.99' | '3.08' | '21.07 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 7552 | '260.23' | '3.34' | '263.57' | '✅ OK' |