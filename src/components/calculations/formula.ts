/**
 * Tiny, safe arithmetic evaluator for user-built calculators.
 * Supports numbers, variables, + - * / % ^, parentheses, unary minus and
 * min/max/round/abs/ceil/floor. Never uses eval/Function.
 */

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; }
  | { t: ')'; }
  | { t: ','; };

const FUNCS: Record<string, (...args: number[]) => number> = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  round: (x, d = 0) => {
    const f = 10 ** d;
    return Math.round(x * f) / f;
  },
  abs: (x) => Math.abs(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
};

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const n = Number(src.slice(i, j));
      if (Number.isNaN(n)) throw new Error(`Invalid number "${src.slice(i, j)}"`);
      out.push({ t: 'num', v: n });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
    } else if ('+-*/%^'.includes(c)) {
      out.push({ t: 'op', v: c });
      i += 1;
    } else if (c === '(' || c === ')' || c === ',') {
      out.push({ t: c } as Token);
      i += 1;
    } else {
      throw new Error(`Unexpected "${c}"`);
    }
  }
  return out;
}

export function evaluateFormula(src: string, scope: Record<string, number>): number {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const tk = peek();
    return tk?.t === 'op' && tk.v === v;
  };

  const expr = (): number => {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { v: string }).v;
      const right = term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const term = (): number => {
    let left = power();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (tokens[pos++] as { v: string }).v;
      const right = power();
      if (op === '*') left *= right;
      else if (op === '/') left = right === 0 ? 0 : left / right;
      else left = (left * right) / 100; // "a % b" => b percent of a
    }
    return left;
  };

  const power = (): number => {
    const base = unary();
    if (isOp('^')) {
      pos += 1;
      return base ** power();
    }
    return base;
  };

  const unary = (): number => {
    if (isOp('-')) {
      pos += 1;
      return -unary();
    }
    if (isOp('+')) {
      pos += 1;
      return unary();
    }
    return primary();
  };

  const primary = (): number => {
    const tk = tokens[pos++];
    if (!tk) throw new Error('Formula ends unexpectedly');
    if (tk.t === 'num') return tk.v;
    if (tk.t === '(') {
      const v = expr();
      if (tokens[pos++]?.t !== ')') throw new Error('Missing ")"');
      return v;
    }
    if (tk.t === 'id') {
      if (peek()?.t === '(') {
        const fn = FUNCS[tk.v];
        if (!fn) throw new Error(`Unknown function "${tk.v}"`);
        pos += 1;
        const args: number[] = [];
        if (peek()?.t !== ')') {
          args.push(expr());
          while (peek()?.t === ',') {
            pos += 1;
            args.push(expr());
          }
        }
        if (tokens[pos++]?.t !== ')') throw new Error('Missing ")"');
        return fn(...args);
      }
      if (!(tk.v in scope)) throw new Error(`Unknown field "${tk.v}"`);
      return scope[tk.v];
    }
    throw new Error('Unexpected symbol');
  };

  if (tokens.length === 0) return 0;
  const result = expr();
  if (pos < tokens.length) throw new Error('Unexpected text after formula');
  return Number.isFinite(result) ? result : 0;
}

/** Validate without values - every variable resolves to 1. */
export function checkFormula(src: string, keys: string[]): string | null {
  try {
    evaluateFormula(src, Object.fromEntries(keys.map((k) => [k, 1])));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid formula';
  }
}

export function toKey(label: string): string {
  const k = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!k) return 'field';
  return /^[0-9]/.test(k) ? `f_${k}` : k;
}
