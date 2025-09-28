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

### **Scenario: Realistic Changes**

#### Realistic change in `small.json` (package.json)
*Changing a version number.*

| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `cdiff` | 63 | 3.31 | 1.42 | 4.73 |
| `jsdiff (unified)` | 259 | 2.52 | 1.45 | 3.97 |
| `diff-match-patch` 🥇 | **62** | 2.28 | 0.62 | **2.90** 🥇 |

#### Realistic change in `medium.js` (source code)
*Renaming a class name.*

| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `cdiff` 🥇 | **20** | 5.65 | 0.21 | 5.86 |
| `jsdiff (unified)` | 401 | 4.03 | 0.56 | 4.59 |
| `diff-match-patch` | 54 | 0.33 | 0.03 | **0.36** 🥇 |

#### Realistic change in `large.js` (source code)
*Adding a comment to the top of the file.*

| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `cdiff` 🥇 | **33** | 206.91 | 4.55 | 211.46 |
| `jsdiff (unified)` | 197 | 347.77 | 2.39 | 350.16 |
| `diff-match-patch` | 59 | 0.44 | 0.43 | **0.86** 🥇 |

---

### **Scenario: Stress Tests**

#### Code Refactoring (many small changes in `large.js`)
*Multiple variable renames throughout a large file.*

| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `cdiff` 🥇 | **1258** | 205.37 | 6.70 | 212.06 |
| `jsdiff (unified)` | 16942 | 176.04 | 6.87 | 182.91 |
| `diff-match-patch` | 3473 | 63.72 | 10.43 | **74.15** 🥇 |

#### Block Move (structural shift in `large.js`)
*Moving a 50-line block of code.*

| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `cdiff` 🥇 | **2848** | 190.37 | 5.13 | 195.50 |
| `jsdiff (unified)` | 2938 | 172.49 | 5.08 | 177.57 |
| `diff-match-patch` | 3229 | 2.61 | 4.92 | **7.54** 🥇 |

#### Whitespace Change (indentation in `medium.js`)
*Changing indentation from 2 to 4 spaces across a file.*

| Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `cdiff` | 9813 | 14.57 | 1.54 | **16.11** 🥇 |
| `jsdiff (unified)` | 10834 | 13.64 | 3.12 | 16.76 |
| `diff-match-patch` 🥇 | **7500** | 68.97 | 1.72 | 70.69 |