/** Only explicitly addressed observations share a batch. Everything else is a barrier. */
export async function scheduleToolCalls<T, R>(items: readonly T[], options: {
  tab(item: T): number | null;
  execute(item: T, signal: AbortSignal, parallel: boolean): Promise<R>;
  commit(result: R): Promise<void>;
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
      const results = await Promise.all(group.map(async item => {
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal.reason);
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) abort();
        try { return await options.execute(item, controller.signal, group.length > 1); }
        finally { options.signal.removeEventListener("abort", abort); }
      }));
      for (const result of results) {
        if (options.signal.aborted) break;
        await options.commit(result);
      }
    };
    await run(batch);
    // A repeated tab is itself a barrier, including for calls following it.
    if (repeatedTab && !options.signal.aborted) await run([items[index++]!]);
  }
}
