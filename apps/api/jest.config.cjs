/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@gaap/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    // Shared uses ESM ".js" import specifiers; strip them so ts-jest resolves the ".ts" source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
