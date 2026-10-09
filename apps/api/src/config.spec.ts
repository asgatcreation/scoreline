import { apiPort, corsOrigins, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses free-plan defaults and keeps demo on', () => {
    const config = loadConfig({});
    expect(config.apiFootballDailyLimit).toBe(100);
    expect(config.footballDataMinuteLimit).toBe(10);
    expect(config.demoEnabled).toBe(true);
    expect(config.ingestEnabled).toBe(true);
  });

  it('turns ingest off in tests unless asked', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).ingestEnabled).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', INGEST_ENABLED: 'true' }).ingestEnabled).toBe(true);
  });

  it('treats blank keys as missing', () => {
    expect(loadConfig({ API_FOOTBALL_KEY: '  ' }).apiFootballKey).toBeUndefined();
  });

  it('explains invalid values', () => {
    expect(() => loadConfig({ API_FOOTBALL_DAILY_LIMIT: 'lots' })).toThrow(
      /API_FOOTBALL_DAILY_LIMIT/,
    );
  });
});

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

describe('apiPort', () => {
  it('defaults to 4000', () => {
    expect(apiPort({})).toBe(4000);
  });

  it('uses PORT when API_PORT is not set (Render)', () => {
    expect(apiPort({ PORT: '10000' })).toBe(10000);
  });

  it('prefers API_PORT over PORT', () => {
    expect(apiPort({ API_PORT: '4000', PORT: '3001' })).toBe(4000);
  });

  it('falls back to 4000 for junk values', () => {
    expect(apiPort({ PORT: 'abc' })).toBe(4000);
  });
});
