/** @type {import('ts-jest').JestConfigWithTs} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.int-spec.ts'],
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/integration/global-setup.js',
};
