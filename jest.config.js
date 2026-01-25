module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  clearMocks: true,

  moduleNameMapper: {
    '^@emotion/(.*)$': '<rootDir>/src/emotion-core/$1',
  },
};
