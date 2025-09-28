// benchmarks/fetch-data.js
import fs from 'fs';
import https from 'https';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const FILES = [
  {
    name: 'small.json',
    url: 'https://raw.githubusercontent.com/lodash/lodash/4.17.21/package.json'
  },
  {
    name: 'medium.js',
    url: 'https://raw.githubusercontent.com/axios/axios/v1.6.0/lib/core/Axios.js'
  },
  {
    name: 'large.js',
    url: 'https://code.jquery.com/jquery-3.7.1.js'
  }
];

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {}); // Delete partial file
      reject(err);
    });
  });
}

async function main() {
  await mkdir('benchmarks/data', { recursive: true });
  for (const file of FILES) {
    console.log(`Downloading ${file.name}...`);
    await downloadFile(file.url, `benchmarks/data/${file.name}`);
  }
  console.log('All files downloaded!');
}

main().catch(console.error);