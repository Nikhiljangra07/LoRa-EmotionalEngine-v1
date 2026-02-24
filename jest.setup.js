// Silence noisy console output during test runs.
// Opt in to verbose output with: LORA_TEST_VERBOSE=1 npm test
//
// Tests that jest.spyOn(console, 'log') will capture calls in mock.calls
// regardless of this suppression — their assertions are unaffected.
if (process.env.LORA_TEST_VERBOSE !== '1') {
  const noop = () => {};
  console.log = noop;
  console.debug = noop;
  console.group = noop;
  console.groupCollapsed = noop;
  console.groupEnd = noop;
  // console.warn and console.error are intentionally preserved.
}
