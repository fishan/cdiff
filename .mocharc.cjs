// Используем синтаксис CommonJS, так как это конфигурационный файл
module.exports = {
  loader: 'ts-node/esm',
  extension: ['ts'],
  spec: 'test/**/*.test.ts',
  'watch-files': ['src/**/*.ts', 'test/**/*.ts'],
};