import { withTimeout } from './ingest.service.js';

describe('withTimeout', () => {
  it('passes results through', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'slow')).resolves.toBe(7);
  });

  it('gives up on work that never finishes', async () => {
    vi.useFakeTimers();
    const hung = withTimeout(new Promise(() => undefined), 1000, 'job hung');
    vi.advanceTimersByTime(1001);
    await expect(hung).rejects.toThrow('job hung');
    vi.useRealTimers();
  });
});
