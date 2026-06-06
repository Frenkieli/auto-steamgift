(function (root) {
  // Serialize read-modify-write increments through one promise chain so that
  // concurrent callers (e.g. multiple tabs funnelling through a single service
  // worker) never lose updates. `adapter` is { get(key)->Promise<number>,
  // set(key, value)->Promise<void> }.
  function createSerialCounter(adapter) {
    let chain = Promise.resolve();
    function increment(key, delta = 1) {
      const result = chain.then(async () => {
        const current = (await adapter.get(key)) || 0;
        await adapter.set(key, current + delta);
      });
      chain = result.catch(() => {}); // keep the chain alive even if one step fails
      return result;
    }
    return { increment };
  }

  // Serialize read-modify-write list updates through one promise chain, same as
  // createSerialCounter but for arrays. `transform(currentList, item) -> newList`.
  function createSerialList(adapter, transform) {
    let chain = Promise.resolve();
    function push(key, item) {
      const result = chain.then(async () => {
        const current = (await adapter.get(key)) || [];
        await adapter.set(key, transform(current, item));
      });
      chain = result.catch(() => {});
      return result;
    }
    return { push };
  }

  root.SerialCounter = { createSerialCounter, createSerialList };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSerialCounter, createSerialList };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
