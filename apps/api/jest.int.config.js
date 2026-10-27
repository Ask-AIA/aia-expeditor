/** @type {import('ts-jest').JestConfigWithTs} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.int-spec.ts'],
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/global-setup.js',
};
