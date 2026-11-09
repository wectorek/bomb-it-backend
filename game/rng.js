// Mulberry32. Stan to liczba trzymana w `state.rng`, więc ten sam stan daje ten sam ciąg.
export function nextRng(seed) {
  let state = seed | 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return {
    state,
    value: ((t ^ (t >>> 14)) >>> 0) / 4294967296,
  };
}

export function createRandom(box) {
  return () => {
    const next = nextRng(box.state);
    box.state = next.state;
    return next.value;
  };
}

export function hashSeed(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
