/**
 * In-memory Supabase mock for testing the SMS bot without a real database.
 *
 * Implements the chained query builder pattern:
 *   admin.from('users').select('*').eq('phone', '+1234').maybeSingle()
 *
 * Supports: from, select, insert, update, upsert, delete,
 *           eq, neq, in, is, gte, lte, order, limit, single, maybeSingle
 *
 * All data stored in Map<tableName, row[]>.
 */

// deno-lint-ignore-file no-explicit-any

type Row = Record<string, any>;

export class InMemorySupabase {
  tables: Map<string, Row[]> = new Map();

  /** Get or create a table */
  private getTable(name: string): Row[] {
    if (!this.tables.has(name)) {
      this.tables.set(name, []);
    }
    return this.tables.get(name)!;
  }

  /** Clear all data */
  reset(): void {
    this.tables.clear();
  }

  /** Dump table for debugging */
  dump(tableName: string): Row[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  /** The main entry point — matches supabase.from(tableName) */
  from(tableName: string): QueryBuilder {
    return new QueryBuilder(this, tableName);
  }
}

type OpType = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
type Filter = { column: string; op: string; value: any };

class QueryBuilder {
  private db: InMemorySupabase;
  private table: string;
  private op: OpType = 'select';
  private filters: Filter[] = [];
  private selectColumns: string | null = null;
  private orderCol: string | null = null;
  private orderAsc: boolean = true;
  private limitN: number | null = null;
  private terminal: 'single' | 'maybeSingle' | null = null;
  private insertData: Row | Row[] | null = null;
  private updateData: Row | null = null;
  private upsertConflict: string | null = null;
  private doSelect = false;

  constructor(db: InMemorySupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  // ─── Operation setters ─────────────────────────────────────────────────

  select(columns?: string): QueryBuilder {
    if (this.op === 'insert' || this.op === 'update' || this.op === 'upsert') {
      // Chained after mutation: .insert({...}).select().single()
      this.doSelect = true;
    } else {
      this.op = 'select';
    }
    this.selectColumns = columns ?? '*';
    return this;
  }

  insert(data: Row | Row[]): QueryBuilder {
    this.op = 'insert';
    this.insertData = data;
    return this;
  }

  update(data: Row): QueryBuilder {
    this.op = 'update';
    this.updateData = data;
    return this;
  }

  upsert(data: Row | Row[], opts?: { onConflict?: string }): QueryBuilder {
    this.op = 'upsert';
    this.insertData = data;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }

  delete(): QueryBuilder {
    this.op = 'delete';
    return this;
  }

  // ─── Filters ───────────────────────────────────────────────────────────

  eq(column: string, value: any): QueryBuilder {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  neq(column: string, value: any): QueryBuilder {
    this.filters.push({ column, op: 'neq', value });
    return this;
  }

  in(column: string, values: any[]): QueryBuilder {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }

  is(column: string, value: any): QueryBuilder {
    this.filters.push({ column, op: 'is', value });
    return this;
  }

  gte(column: string, value: any): QueryBuilder {
    this.filters.push({ column, op: 'gte', value });
    return this;
  }

  lte(column: string, value: any): QueryBuilder {
    this.filters.push({ column, op: 'lte', value });
    return this;
  }

  or(expr: string): QueryBuilder {
    // Simple or() support: parse "col1.eq.val1,col2.eq.val2"
    this.filters.push({ column: '__or', op: 'or', value: expr });
    return this;
  }

  // ─── Modifiers ─────────────────────────────────────────────────────────

  order(column: string, opts?: { ascending?: boolean }): QueryBuilder {
    this.orderCol = column;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(n: number): QueryBuilder {
    this.limitN = n;
    return this;
  }

  // ─── Terminals ─────────────────────────────────────────────────────────

  single(): QueryBuilder {
    this.terminal = 'single';
    return this;
  }

  maybeSingle(): QueryBuilder {
    this.terminal = 'maybeSingle';
    return this;
  }

  // ─── Execution (thenable) ──────────────────────────────────────────────

  then(
    resolve: (value: { data: any; error: any }) => any,
    reject?: (reason: any) => any,
  ): Promise<any> {
    try {
      const result = this.execute();
      return Promise.resolve(result).then(resolve, reject);
    } catch (err) {
      if (reject) return Promise.resolve(reject(err));
      return Promise.reject(err);
    }
  }

  private execute(): { data: any; error: any } {
    switch (this.op) {
      case 'select':
        return this.executeSelect();
      case 'insert':
        return this.executeInsert();
      case 'update':
        return this.executeUpdate();
      case 'upsert':
        return this.executeUpsert();
      case 'delete':
        return this.executeDelete();
      default:
        return { data: null, error: { message: `Unknown op: ${this.op}` } };
    }
  }

  // ─── Filter matching ──────────────────────────────────────────────────

  private matchesFilters(row: Row): boolean {
    for (const f of this.filters) {
      if (f.op === 'or') continue; // TODO: handle or() properly
      const val = row[f.column];
      switch (f.op) {
        case 'eq':
          if (val !== f.value) return false;
          break;
        case 'neq':
          if (val === f.value) return false;
          break;
        case 'in':
          if (!Array.isArray(f.value) || !f.value.includes(val)) return false;
          break;
        case 'is':
          if (f.value === null) { if (val !== null && val !== undefined) return false; }
          else if (val !== f.value) return false;
          break;
        case 'gte':
          if (val < f.value) return false;
          break;
        case 'lte':
          if (val > f.value) return false;
          break;
      }
    }
    return true;
  }

  // ─── SELECT ───────────────────────────────────────────────────────────

  private executeSelect(): { data: any; error: any } {
    const table = this.db.tables.get(this.table) ?? [];
    let rows = table.filter((r) => this.matchesFilters(r));

    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows.sort((a, b) => {
        const av = a[col] ?? '';
        const bv = b[col] ?? '';
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
    }

    if (this.limitN !== null) {
      rows = rows.slice(0, this.limitN);
    }

    // Project columns
    rows = rows.map((r) => this.projectColumns(r));

    if (this.terminal === 'single') {
      if (rows.length === 0) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      return { data: rows[0], error: null };
    }
    if (this.terminal === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null };
    }

    return { data: rows, error: null };
  }

  // ─── INSERT ───────────────────────────────────────────────────────────

  private executeInsert(): { data: any; error: any } {
    const table = this.getOrCreateTable();
    const rows = Array.isArray(this.insertData) ? this.insertData : [this.insertData!];
    const inserted: Row[] = [];

    for (const row of rows) {
      const newRow: Row = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      };
      table.push(newRow);
      inserted.push({ ...newRow });
    }

    if (this.doSelect) {
      const projected = inserted.map((r) => this.projectColumns(r));
      if (this.terminal === 'single') {
        return { data: projected[0] ?? null, error: null };
      }
      if (this.terminal === 'maybeSingle') {
        return { data: projected[0] ?? null, error: null };
      }
      return { data: projected, error: null };
    }

    return { data: inserted, error: null };
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────

  private executeUpdate(): { data: any; error: any } {
    const table = this.db.tables.get(this.table) ?? [];
    const updated: Row[] = [];

    for (const row of table) {
      if (this.matchesFilters(row)) {
        Object.assign(row, this.updateData, { updated_at: new Date().toISOString() });
        updated.push({ ...row });
      }
    }

    if (this.doSelect) {
      const projected = updated.map((r) => this.projectColumns(r));
      if (this.terminal === 'single') {
        return { data: projected[0] ?? null, error: null };
      }
      return { data: projected, error: null };
    }

    return { data: updated, error: null };
  }

  // ─── UPSERT ───────────────────────────────────────────────────────────

  private executeUpsert(): { data: any; error: any } {
    const table = this.getOrCreateTable();
    const rows = Array.isArray(this.insertData) ? this.insertData : [this.insertData!];
    const conflictCols = this.upsertConflict?.split(',').map((c) => c.trim()) ?? ['id'];
    const results: Row[] = [];

    for (const row of rows) {
      // Find existing row matching conflict columns
      const existing = table.find((r) =>
        conflictCols.every((col) => r[col] === row[col])
      );

      if (existing) {
        Object.assign(existing, row, { updated_at: new Date().toISOString() });
        results.push({ ...existing });
      } else {
        const newRow: Row = {
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...row,
        };
        table.push(newRow);
        results.push({ ...newRow });
      }
    }

    if (this.doSelect) {
      const projected = results.map((r) => this.projectColumns(r));
      if (this.terminal === 'single') {
        return { data: projected[0] ?? null, error: null };
      }
      return { data: projected, error: null };
    }

    return { data: results, error: null };
  }

  // ─── DELETE ───────────────────────────────────────────────────────────

  private executeDelete(): { data: any; error: any } {
    const table = this.db.tables.get(this.table);
    if (!table) return { data: [], error: null };

    const remaining = table.filter((r) => !this.matchesFilters(r));
    this.db.tables.set(this.table, remaining);

    return { data: null, error: null };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private getOrCreateTable(): Row[] {
    if (!this.db.tables.has(this.table)) {
      this.db.tables.set(this.table, []);
    }
    return this.db.tables.get(this.table)!;
  }

  private projectColumns(row: Row): Row {
    if (!this.selectColumns || this.selectColumns === '*') return { ...row };

    // Handle "col1, col2, col3" format (ignore joins like "poll_options!fk(*)")
    const cols = this.selectColumns
      .split(',')
      .map((c) => c.trim())
      .filter((c) => !c.includes('!') && !c.includes('('));

    if (cols.length === 0) return { ...row };

    const projected: Row = {};
    for (const col of cols) {
      if (col in row) projected[col] = row[col];
    }
    return projected;
  }
}
