export type Entry = {
  key: string;
  userId: string;
  sessionId: string;
  revision: number;
  latest: any;
  pending?: { operationId: string; expectedRevision: number; value: any };
  error?: string;
};
export class RecoveryDB {
  private opened: Promise<IDBDatabase>;
  constructor(name = "liftline-recovery-v1") {
    this.opened = new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("drafts", { keyPath: "key" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async operation<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = run(tx.objectStore("drafts"));
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  get(key: string) {
    return this.operation<Entry | undefined>("readonly", (s) => s.get(key));
  }
  put(e: Entry) {
    return this.operation("readwrite", (s) => s.put(e));
  }
  delete(key: string) {
    return this.operation("readwrite", (s) => s.delete(key));
  }
  async update(key: string, change: (old: Entry | undefined) => Entry) {
    const db = await this.opened;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"),
        store = tx.objectStore("drafts"),
        r = store.get(key);
      r.onsuccess = () => store.put(change(r.result));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async forUser(userId: string) {
    return (
      await this.operation<Entry[]>("readonly", (s) => s.getAll())
    ).filter((e) => e.userId === userId && e.latest !== null);
  }
}
export class Outbox {
  private chain = Promise.resolve();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private flushing = new Map<string, Promise<void>>();
  constructor(
    readonly db: RecoveryDB,
    readonly user: () => string | undefined,
    readonly send: (
      sessionId: string,
      body: unknown,
    ) => Promise<{ revision: number }>,
    readonly status: (state: string) => void = () => {},
  ) {}
  enqueue(userId: string, value: any, revision = 0) {
    const key = `${userId}/${value.id}`;
    this.status("Pending — saving on this device");
    const write = this.chain.then(() =>
      this.db.update(key, (old) => ({
        ...old,
        key,
        userId,
        sessionId: value.id,
        revision: old?.revision ?? revision,
        latest: structuredClone(value),
      })),
    );
    this.chain = write.catch(() => {});
    write.then(
      () => {
        this.status("Pending — saved on this device");
        clearTimeout(this.timers.get(key));
        this.timers.set(
          key,
          setTimeout(() => {
            void this.flush(key).catch(() => {});
          }, 700),
        );
      },
      () => this.status("Error — device storage failed; keep this page open"),
    );
    return write;
  }
  async flush(key: string) {
    await this.chain;
    clearTimeout(this.timers.get(key));
    const run = async () => {
      let attempt = 0;
      while (true) {
        let entry = await this.db.get(key);
        if (!entry || entry.latest === null) return;
        if (this.user() !== entry.userId)
          throw new Error("Sign in as the owner to recover this draft");
        if (!entry.pending) {
          await this.db.update(key, (current) => ({
            ...current!,
            pending: current!.pending ?? {
              operationId: crypto.randomUUID(),
              expectedRevision: current!.revision,
              value: structuredClone(current!.latest),
            },
          }));
          entry = (await this.db.get(key))!;
        }
        const sent = entry.pending!;
        try {
          if (this.user() !== entry.userId)
            throw Object.assign(new Error("Owner changed"), { status: 401 });
          const result = await this.send(entry.sessionId, sent);
          await this.db.update(key, (current) => {
            if (!current || current.pending?.operationId !== sent.operationId)
              return current ?? entry!;
            return {
              ...current,
              revision: result.revision,
              pending: undefined,
              latest:
                JSON.stringify(current.latest) === JSON.stringify(sent.value)
                  ? null
                  : current.latest,
            };
          });
          this.status("Saved");
          attempt = 0;
        } catch (e: any) {
          this.status(
            e.status === 409
              ? "Conflict — local edits retained; choose recovery"
              : e.status === 401
                ? "Sign in again — local edits retained"
                : "Error — local edits retained; retrying",
          );
          if (e.status && e.status < 500) throw e;
          if (++attempt >= 5) throw e;
          await new Promise((r) =>
            setTimeout(r, Math.min(16000, 500 * 2 ** attempt)),
          );
        }
      }
    };
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request(`liftline/${key}`, run);
    // Test environments without Web Locks still serialize each queue instance.
    if (this.flushing.has(key)) return this.flushing.get(key);
    const pending = run().finally(() => this.flushing.delete(key));
    this.flushing.set(key, pending);
    return pending;
  }
}
