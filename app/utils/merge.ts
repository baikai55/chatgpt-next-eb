export function merge(target: any, source: any) {
  Object.keys(source).forEach(function (key) {
    // never merge dangerous keys to avoid prototype pollution
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return;
    }

    const value = source[key];

    // arrays are replaced wholesale, not deep-merged, otherwise recursing
    // into them turns ["a", "b"] into { 0: "a", 1: "b" } and breaks callers
    // that expect an array (e.g. customProviders[].models)
    if (Array.isArray(value)) {
      target[key] = value;
      return;
    }

    if (value && typeof value === "object") {
      // if target holds a non-object (or array) here, start fresh so we
      // don't merge into an incompatible shape
      const base =
        target[key] &&
        typeof target[key] === "object" &&
        !Array.isArray(target[key])
          ? target[key]
          : {};
      merge((target[key] = base), value);
      return;
    }

    target[key] = value;
  });
}
