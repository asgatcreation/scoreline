import { directDatabaseUrl, normaliseSslMode } from './database-url.js';

const pooled =
  'postgresql://user:pw@ep-cool-name-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

describe('directDatabaseUrl', () => {
  it('strips -pooler from a Neon host and adds a connect timeout', () => {
    expect(directDatabaseUrl({ DATABASE_URL: pooled })).toBe(
      'postgresql://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30',
    );
  });

  it('drops channel_binding, which the migration engine cannot use', () => {
    expect(directDatabaseUrl({ DATABASE_URL: pooled + '&channel_binding=require' })).not.toContain(
      'channel_binding',
    );
  });

  it('prefers an explicit DIRECT_DATABASE_URL', () => {
    expect(
      directDatabaseUrl({
        DATABASE_URL: pooled,
        DIRECT_DATABASE_URL: 'postgresql://u@db-pooler.x/y',
      }),
    ).toBe('postgresql://u@db-pooler.x/y?connect_timeout=30');
  });

  it('keeps an existing connect_timeout and handles a missing URL', () => {
    expect(
      directDatabaseUrl({ DATABASE_URL: 'postgresql://u@localhost:5432/db?connect_timeout=5' }),
    ).toBe('postgresql://u@localhost:5432/db?connect_timeout=5');
    expect(directDatabaseUrl({})).toBeUndefined();
  });
});

describe('normaliseSslMode', () => {
  it('upgrades sslmode=require to verify-full', () => {
    expect(normaliseSslMode(pooled)).toContain('sslmode=verify-full');
  });

  it('keeps URLs without sslmode unchanged', () => {
    expect(normaliseSslMode('postgresql://u@localhost:5432/db')).toBe(
      'postgresql://u@localhost:5432/db',
    );
  });
});
