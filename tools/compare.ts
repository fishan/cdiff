// tools/compare.ts - Compare original and compressed patch sizes
const original: string[] = [];

const compressed: string[] = [];

function getSizeBytes(lines: string[]): number {
    return lines.reduce((acc, line) => acc + Buffer.byteLength(line, 'utf8'), 0);
}

const originalSize = getSizeBytes(original);
const compressedSize = getSizeBytes(compressed);

const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

console.log(`Original size:   ${originalSize.toLocaleString()} bytes`);
console.log(`Compressed size: ${compressedSize.toLocaleString()} bytes`);
console.log(`Compression ratio: ${ratio}% smaller`);

