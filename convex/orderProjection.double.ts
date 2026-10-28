import type { AdmissionContext } from "./admissionContext";

export type Row = Record<string, unknown> & { _id: string };

/**
 * The write half of the double: `insert`, `patch` and `delete` over a table
 * map. `files.test.ts` and `upload-provenance.test.ts` carried their own copies.
 */
export function writeSurface(tables: Record<string, Row[]>) {
  const find = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id);
  return {
    insert: async (table: string, doc: Record<string, unknown>) => {
      const _id = `${table}-${tables[table].length + 1}`;
      tables[table].push({ ...doc, _id });
      return _id;
    },
    patch: async (id: string, fields: Record<string, unknown>) => {
      const row = find(id);
      if (!row) throw new Error(`unknown document ${id}`);
      Object.assign(row, fields);
    },
    delete: async (id: string) => {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex((row) => row._id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
  };
}

/**
 * An in-memory stand-in for the Convex query surface the order projection uses:
 * `withIndex(...).unique()` over equality ranges, plus `insert` and `patch`.
 * Shared by the projection suites so the double is maintained once.
 */
export function databaseDouble(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    chainOrders: [],
    orders: [],
    ...seed,
  };
  const ctx = {
    db: {
      query: (table: string) => {
        const rows = () => tables[table] ?? [];
        const filter = (predicate: (row: Row) => boolean) => ({
          unique: async () => {
            const matched = rows().filter(predicate);
            return matched.length === 1 ? matched[0] : null;
          },
          collect: async () => rows().filter(predicate),
        });
        return {
          withIndex: (
            _index: string,
            range: (q: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => {
            const captured: Array<[string, unknown]> = [];
            const chain = {
              eq: (field: string, value: unknown) => {
                captured.push([field, value]);
                return chain;
              },
            };
            range(chain);
            return filter((row) =>
              captured.every(([field, value]) => row[field] === value),
            );
          },
        };
      },
      ...writeSurface(tables),
    },
  };
  return { ctx: ctx as unknown as AdmissionContext, tables };
}

/**
 * The read half of the double: `get`, and `query(...).withIndex(...)` over
 * equality ranges plus an optional `lt` bound, with the four terminal forms
 * (`unique`, `take`, `first`, `collect`), a `filter` over equality, and
 * `fullTableScan`. The files, upload-provenance, settlement and diagnostics
 * suites share this.
 *
 * `strictUnique` makes `unique` throw when a range matches more than one row
 * instead of returning null. That is how the F-21 "never `.unique()` on
 * by_intent" assertion is enforced rather than merely described.
 */

/**
 * `q.eq(q.field("role"), "merchant")`, the only filter form the source uses.
 * The double used to have no `filter` at all, so `merchantMembershipOf` threw a
 * TypeError and `auth.me` looked refused for every actor — a false pass that
 * ROUND17 (c) turned into a failure.
 */
const filterQ = () => ({
  field: (name: string) => (row: Row) => row[name],
  eq: (field: (row: Row) => unknown, value: unknown) => (row: Row) =>
    field(row) === value,
});

export function readSurface(
  tables: Record<string, Row[]>,
  options: { strictUnique?: string } = {},
) {
  const find = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id);
  return {
    get: async (id: string) => find(id) ?? null,
    query: (table: string) => {
      const rows = () => tables[table] ?? [];
      const terminal = (predicate: (row: Row) => boolean) => {
        const matched = () => rows().filter(predicate);
        /** R28: `.order("desc")` reverses the range, as Convex does. */
        const ordered = (direction: "asc" | "desc") =>
          direction === "desc" ? [...matched()].reverse() : matched();
        const surface = (direction: "asc" | "desc") => ({
          unique: async () => {
            const hits = ordered(direction);
            if (options.strictUnique && hits.length > 1)
              throw new Error(options.strictUnique);
            return hits.length === 1 ? hits[0] : null;
          },
          take: async (n: number) => ordered(direction).slice(0, n),
          first: async () => ordered(direction)[0] ?? null,
          collect: async () => ordered(direction),
          order: (next: "asc" | "desc") => surface(next),
          filter: (
            pred: (q: ReturnType<typeof filterQ>) => (row: Row) => boolean,
          ) => terminal((row) => predicate(row) && pred(filterQ())(row)),
        });
        return surface("asc");
      };
      return {
        withIndex: (
          _index: string,
          range: (q: {
            eq: (field: string, value: unknown) => unknown;
            lt: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const equal: Array<[string, unknown]> = [];
          const below: Array<[string, unknown]> = [];
          const chain = {
            eq: (field: string, value: unknown) => {
              equal.push([field, value]);
              return chain;
            },
            lt: (field: string, value: unknown) => {
              below.push([field, value]);
              return chain;
            },
          };
          range(chain);
          return terminal(
            (row) =>
              equal.every(([field, value]) => row[field] === value) &&
              below.every(
                ([field, value]) =>
                  typeof row[field] === "number" &&
                  (row[field] as number) < (value as number),
              ),
          );
        },
        fullTableScan: () => terminal(() => true),
      };
    },
  };
}

/**
 * The same equality-range surface, plus `take` and a scheduler recorder, for
 * the settlement and diagnostics suites. `unique` deliberately throws when a
 * range matches more than one row: that is how the F-21 "never `.unique()` on
 * by_intent" assertion is enforced rather than merely described.
 */
export function settlementDouble(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    paymentInbox: [],
    paymentIntents: [],
    settlementOps: [],
    ...seed,
  };
  const scheduled: unknown[] = [];
  const ctx = {
    scheduler: {
      runAfter: async (_d: number, ref: unknown) => {
        scheduled.push(ref);
      },
    },
    db: {
      ...readSurface(tables, {
        strictUnique:
          "by_intent must not use .unique() when capture+void share one intent",
      }),
      ...writeSurface(tables),
    },
  };
  return { ctx, tables, scheduled };
}
