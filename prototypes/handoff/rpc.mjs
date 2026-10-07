import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// Small test transport. No automatic command retries or configuration mutations.
export class RpcProcess {
  constructor(command, args, { cwd, env, logPrefix, timeout = 15_000 }) {
    this.timeout = timeout;
    this.pending = new Map();
    this.sequence = 0;
    this.failure = undefined;
    this.logPrefix = logPrefix;
    this.child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.closed = false;
    this.exited = new Promise((resolve) => {
      this.child.once('close', (code, signal) => {
        this.closed = true;
        this.fail(new Error(`RPC exited (${code ?? signal})`));
        resolve({ code, signal });
      });
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => appendFileSync(`${logPrefix}.stderr.log`, chunk));
    let buffer = '';
    this.child.stdout.on('data', (chunk) => {
      appendFileSync(`${logPrefix}.stdout.jsonl`, chunk);
      buffer += chunk;
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        if (line.length > 2 * 1024 * 1024) {
          this.fail(new Error('RPC record exceeded test size limit'));
          continue;
        }
        try {
          const record = JSON.parse(line);
          if (record.type === 'response') {
            const pending = this.pending.get(record.id);
            if (!pending) {
              continue;
            }
            this.pending.delete(record.id);
            clearTimeout(pending.timer);
            if (record.success) {
              pending.resolve(record.data);
            } else {
              pending.reject(new Error(record.error));
            }
          }
        } catch (error) {
          this.fail(new Error(`Invalid RPC record: ${error}`));
        }
      }
      if (buffer.length > 2 * 1024 * 1024) {
        buffer = '';
        this.fail(new Error('RPC record exceeded test size limit'));
      }
    });
  }

  fail(error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(type, data = {}) {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    const id = `pim-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC request timed out: ${type}; outcome unknown`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      const line = `${JSON.stringify({ ...data, type, id })}\n`;
      appendFileSync(`${this.logPrefix}.stdin.jsonl`, line);
      this.child.stdin.write(line, (error) => {
        if (error) {
          this.fail(error);
        }
      });
    });
  }

  async waitForExit(milliseconds) {
    let timer;
    try {
      return await Promise.race([
        this.exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('RPC shutdown timed out')), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async stop() {
    if (!this.closed) {
      this.child.stdin.end();
    }
    // Failure leaves ownership unresolved. Never treat a timeout as release.
    return this.waitForExit(5_000);
  }

  async cleanup() {
    if (this.closed) {
      return;
    }
    this.child.kill('SIGTERM');
    try {
      await this.waitForExit(2_000);
    } catch {
      this.child.kill('SIGKILL');
      await this.waitForExit(2_000);
    }
  }
}
