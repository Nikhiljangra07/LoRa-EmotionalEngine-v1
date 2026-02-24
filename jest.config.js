module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  setupFiles: ['./jest.setup.js'],

  moduleNameMapper: {
    '^@emotion/(.*)$': '<rootDir>/src/emotion-core/$1',
  },
};
