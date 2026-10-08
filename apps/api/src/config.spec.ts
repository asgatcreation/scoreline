import { corsOrigins } from './config.js';

describe('corsOrigins', () => {
  it('defaults to the local web dev server', () => {
    expect(corsOrigins({})).toEqual(['http://localhost:3001']);
  });

  it('splits, trims and strips trailing slashes', () => {
    expect(corsOrigins({ WEB_ORIGIN: ' https://a.app/ , https://b.app ,' })).toEqual([
      'https://a.app',
      'https://b.app',
    ]);
  });
});
