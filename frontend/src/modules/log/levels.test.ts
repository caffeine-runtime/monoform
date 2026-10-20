import { describe, expect, it } from 'vitest';
import { levelOf, levelSpan, TIMESTAMP } from './levels';

describe('log levels', () => {
  it('reads common formats', () => {
    const cases: [string, string | null][] = [
      ['2026-10-19T12:00:01Z INFO [worker-1] request 4 handled', 'info'],
      ['2026-10-19 12:00:01,123 [ERROR] db: connection refused', 'error'],
      ['time="2026-10-19T12:00:01Z" level=warning msg="slow query"', 'warn'],
      ['{"ts":1,"level":"debug","msg":"x"}', 'debug'],
      ['Oct 20 12:00:01 host sshd[42]: <crit> disk failed', 'fatal'],
      ['10-20 12:00:01.123  1234  1234 E/ActivityManager: ANR in com.x', 'error'],
      ['W1020 12:00:01.123456   42 reflector.go:1] watch closed', 'warn'],
      ['FATAL: out of memory', 'fatal'],
      ['   at com.example.Main.run(Main.java:42)', null],
      ['no error was found, everything is fine', null],
      ['TRACE entering handler', 'trace'],
    ];
    for (const [line, want] of cases) expect([line, levelOf(line)]).toEqual([line, want]);
  });
  it('locates the level token and the timestamp', () => {
    const l = '2026-10-19 12:00:01 [WARN] careful';
    expect(l.slice(...levelSpan(l)!)).toBe('WARN');
    expect(TIMESTAMP.exec(l)?.[1]).toBe('2026-10-19 12:00:01');
    expect(levelSpan('level=error x')).toEqual([6, 11]);
    expect(TIMESTAMP.exec('Oct  2 09:00:00 host')?.[1]).toBe('Oct  2 09:00:00');
  });
});
