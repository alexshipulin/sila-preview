/**
 * Just enough of Firestore for the unit tests: documents by path, and
 * transactions that read, then apply their writes together — or none of them
 * if the callback throws.
 */
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));

  function snapshot(path) {
    const has = docs.has(path);
    return { exists: has, data: () => (has ? structuredClone(docs.get(path)) : undefined) };
  }

  function doc(path) {
    return {
      path,
      async get() { return snapshot(path); },
      async update(patch) {
        if (!docs.has(path)) throw new Error(`no document ${path}`);
        docs.set(path, { ...docs.get(path), ...patch });
      },
    };
  }

  async function runTransaction(fn) {
    const writes = [];
    const tx = {
      async get(ref) { return snapshot(ref.path); },
      set(ref, data) { writes.push(() => docs.set(ref.path, structuredClone(data))); },
      create(ref, data) {
        writes.push(() => {
          if (docs.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
          docs.set(ref.path, structuredClone(data));
        });
      },
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  }

  return { doc, runTransaction, docs };
}

module.exports = { fakeDb };
