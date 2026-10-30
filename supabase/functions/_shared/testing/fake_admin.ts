/**
 * A tiny in-memory stand-in for the parts of supabase-js the functions use, for Deno tests.
 *
 * Supports `from(t).select/insert/upsert/update/delete` with `.eq/.in/.is/.not/.order/.limit`,
 * `.select()` after a write, `.maybeSingle()/.single()`, `rpc(name, args)` backed by handlers you
 * register, and `auth.admin.deleteUser`. It is not PostgREST: it only does what the tests need, and
 * enforces the unique keys you declare (so idempotency tests mean something).
 */
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

export interface FakeTableOpts {
  /** Unique key column sets, e.g. [['user_id','legacy_id']]. Rows with a null in a key are exempt, as in Postgres. */
  unique?: string[][];
}

export class FakeAdmin {
  tables: Record<string, Row[]> = {};
  private opts: Record<string, FakeTableOpts> = {};
  /** Every write, in order, for assertions. */
  log: Array<{ table: string; op: string; rows?: Row[]; filter?: string }> = [];
  rpcs: Record<string, (args: Row) => unknown> = {};
  rpcLog: Array<{ name: string; args: Row }> = [];
  deletedUsers: string[] = [];
  deleteUserError: string | null = null;
  /** Table name -> message: every operation on it fails with this error. */
  failTables: Record<string, string> = {};

  constructor(seed: Record<string, Row[]> = {}, opts: Record<string, FakeTableOpts> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
    this.opts = opts;
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new Builder(this, table);
  }

  rpc(name: string, args: Row = {}) {
    this.rpcLog.push({ name, args });
    const h = this.rpcs[name];
    const p: Promise<Result> = Promise.resolve(
      h ? { data: h(args), error: null } : { data: null, error: { message: `no rpc handler for ${name}` } },
    );
    return p;
  }

  auth = {
    admin: {
      deleteUser: (id: string): Promise<Result> => {
        if (this.deleteUserError) return Promise.resolve({ data: null, error: { message: this.deleteUserError } });
        this.deletedUsers.push(id);
        return Promise.resolve({ data: { user: null }, error: null });
      },
    },
  };

  unique(table: string): string[][] {
    return this.opts[table]?.unique ?? [];
  }
}

const keyOf = (r: Row, cols: string[]): string | null => {
  const vals = cols.map((c) => r[c]);
  return vals.some((v) => v == null) ? null : JSON.stringify(vals);
};

class Builder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private cols = '*';
  private payload: Row | Row[] = [];
  private onConflict: string[] = [];
  private ignoreDuplicates = false;
  private filters: Array<(r: Row) => boolean> = [];
  private filterDesc: string[] = [];
  private returning = false;
  private single: 'one' | 'maybe' | null = null;
  private max = Infinity;

  constructor(private db: FakeAdmin, private table: string) {}

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols;
    else { this.returning = true; this.cols = cols; }
    return this;
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(rows: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert'; this.payload = rows;
    this.onConflict = (o.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    this.ignoreDuplicates = !!o.ignoreDuplicates;
    return this;
  }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); this.filterDesc.push(`${col}=${v}`); return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); this.filterDesc.push(`${col} in (${vs.length})`); return this; }
  is(col: string, v: unknown) { this.filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return this; }
  not(col: string, op: string, v: unknown) {
    if (op === 'is' && v === null) this.filters.push((r) => r[col] != null);
    else this.filters.push((r) => r[col] !== v);
    return this;
  }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.single = 'maybe'; return this; }
  // deno-lint-ignore no-explicit-any
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }

  private project(r: Row): Row {
    if (this.cols === '*') return { ...r };
    const out: Row = {};
    for (const c of this.cols.split(',').map((s) => s.trim())) out[c] = r[c];
    return out;
  }

  private run(): Result {
    const fail = this.db.failTables[this.table];
    if (fail) return { data: null, error: { message: fail } };
    const rows = this.db.rows(this.table);
    const matches = () => rows.filter((r) => this.filters.every((f) => f(r)));
    const finish = (list: Row[]): Result => {
      const out = list.slice(0, this.max).map((r) => this.project(r));
      if (this.single) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };
    if (this.op === 'select') return finish(matches());
    if (this.op === 'delete') {
      const gone = matches();
      this.db.log.push({ table: this.table, op: 'delete', filter: this.filterDesc.join(' & ') });
      this.db.tables[this.table] = rows.filter((r) => !gone.includes(r));
      return this.returning ? finish(gone) : { data: null, error: null };
    }
    if (this.op === 'update') {
      const hit = matches();
      this.db.log.push({ table: this.table, op: 'update', rows: [this.payload as Row], filter: this.filterDesc.join(' & ') });
      hit.forEach((r) => Object.assign(r, this.payload));
      return this.returning ? finish(hit) : { data: null, error: null };
    }
    const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ ...r }));
    this.db.log.push({ table: this.table, op: this.op, rows: incoming });
    const touched: Row[] = [];
    for (const r of incoming) {
      const uniques = this.op === 'upsert' && this.onConflict.length ? [this.onConflict] : this.db.unique(this.table);
      const clash = rows.find((e) => uniques.some((cols) => {
        const a = keyOf(e, cols), b = keyOf(r, cols);
        return a !== null && a === b;
      }));
      if (clash) {
        if (this.op === 'insert') return { data: null, error: { message: `duplicate key on ${this.table}`, code: '23505' } };
        if (!this.ignoreDuplicates) { Object.assign(clash, r); touched.push(clash); }
        continue;
      }
      if (r.id === undefined) r.id = crypto.randomUUID();
      rows.push(r);
      touched.push(r);
    }
    return this.returning ? finish(touched) : { data: null, error: null };
  }
}
