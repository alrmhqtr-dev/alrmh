import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export type Queryable = { query: pg.Pool['query'] };

export class Db {
  readonly pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });

  async many<T = any>(sql: string, params: unknown[] = [], client: Queryable = this.pool): Promise<T[]> {
    const res = await client.query(sql, params as any[]);
    return res.rows as T[];
  }

  async one<T = any>(sql: string, params: unknown[] = [], client: Queryable = this.pool): Promise<T | undefined> {
    const rows = await this.many<T>(sql, params, client);
    return rows[0];
  }

  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const db = new Db();
