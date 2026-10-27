/** Only explicitly addressed observations share a batch. Everything else is a barrier. */
export async function scheduleToolCalls<T, R>(items: readonly T[], options: {
  tab(item: T): number | null;
  execute(item: T, signal: AbortSignal, parallel: boolean): Promise<R>;
  commit(result: R): Promise<void>;
  reject?(item: T, error: unknown): R;
  signal: AbortSignal;
}) {
  let index = 0;
  while (index < items.length && !options.signal.aborted) {
    const batch = [items[index++]!];
    const firstTab = options.tab(batch[0]!);
    const tabs = new Set([firstTab]);
    let repeatedTab = false;
    if (firstTab !== null) {
      while (index < items.length && batch.length < 3) {
        const tab = options.tab(items[index]!);
        if (tab === null) break;
        if (tabs.has(tab)) { repeatedTab = true; break; }
        tabs.add(tab);
        batch.push(items[index++]!);
      }
    }
    const run = async (group: T[]) => {
      const results = await Promise.allSettled(group.map(async item => {
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal.reason);
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) abort();
        try { return await options.execute(item, controller.signal, group.length > 1); }
        finally { options.signal.removeEventListener("abort", abort); }
      }));
      const failures: unknown[] = [];
      for (const [index, result] of results.entries()) {
        try {
          if (result.status === "fulfilled") await options.commit(result.value);
          else if (options.reject) await options.commit(options.reject(group[index]!, result.reason));
          else failures.push(result.reason);
        } catch (error) { failures.push(error); }
      }
      // Settle this entire ledger boundary before stopping or surfacing a host failure.
      if (failures.length) throw failures[0];
    };
    await run(batch);
    // A repeated tab is itself a barrier, including for calls following it.
    if (repeatedTab && !options.signal.aborted) await run([items[index++]!]);
  }
}
