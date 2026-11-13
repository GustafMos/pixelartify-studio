/**
 * Motion settings and a small, safe formula evaluator for the Animate node.
 *
 * Formulas are deliberately not JavaScript: a tokenizer and recursive-descent
 * parser support arithmetic, comparisons, a ternary conditional and a fixed
 * set of math functions. Presets can therefore be imported without executing
 * arbitrary code.
 *
 * Variables available to formulas:
 *   t, frame      continuous time in seconds and frames
 *   lt, loopFrame time wrapped to the animation duration
 *   duration, fps
 *   pi, tau, e
 */

export type WrapMode = 'none' | 'horizontal' | 'both';

export interface MotionSettings {
  /** Timeline length used for looping and future animation export. */
  duration: number;
  fps: number;
  loop: boolean;
  wrap: WrapMode;
  /** Half-frame units: 2.0 wraps at the left and right frame edges. */
  wrapWidth: number;
  x: string;
  y: string;
  z: string;
  rotationX: string;
  rotationY: string;
  rotationZ: string;
  scale: string;
}

export const DEFAULT_MOTION: MotionSettings = {
  duration: 4,
  fps: 24,
  loop: true,
  wrap: 'horizontal',
  wrapWidth: 2,
  x: '0',
  y: 'sin(lt * tau / duration) * 0.18',
  z: '0',
  rotationX: 'sin(lt * tau / duration) * 12',
  rotationY: 'lt * 360 / duration',
  rotationZ: '0',
  scale: '1',
};

export interface MotionFrame {
  time: number;
  frame: number;
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
}

/* -------------------------------------------------------------------------- */
/* Expression parser                                                          */
/* -------------------------------------------------------------------------- */

type ExprNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; op: string; value: ExprNode }
  | { kind: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { kind: 'conditional'; test: ExprNode; yes: ExprNode; no: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] };

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'eof' };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  abs: Math.abs,
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  log: Math.log,
  sign: Math.sign,
  mod: (a, b) => a % b,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  step: (edge, x) => (x >= edge ? 1 : 0),
  smoothstep: (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-9, b - a)));
    return t * t * (3 - 2 * t);
  },
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
};

const EXPR_CACHE = new Map<string, ExprNode | null>();

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j++;
      if (source[j] === 'e' || source[j] === 'E') {
        j++;
        if (source[j] === '+' || source[j] === '-') j++;
        while (j < source.length && /[0-9]/.test(source[j])) j++;
      }
      const value = Number(source.slice(i, j));
      if (!Number.isFinite(value)) {
        tokens.push({ kind: 'number', value: 0 });
      } else {
        tokens.push({ kind: 'number', value });
      }
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      tokens.push({ kind: 'name', value: source.slice(i, j) });
      i = j;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||', '**'].includes(two)) {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/%^(),?:<>!'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    // Unknown character: treat as end so a malformed preset cannot hang.
    tokens.push({ kind: 'op', value: ch });
    i++;
  }
  tokens.push({ kind: 'eof' });
  return tokens;
}

function parse(source: string): ExprNode | null {
  const tokens = tokenize(source);
  let index = 0;
  let failed = false;
  const peek = (): Token => tokens[index];
  const take = (): Token => tokens[index++];
  const match = (value: string): boolean => {
    const token = peek();
    if (token.kind === 'op' && token.value === value) {
      index++;
      return true;
    }
    return false;
  };
  const fail = (): null => {
    failed = true;
    return null;
  };

  const parsePrimary = (): ExprNode | null => {
    const token = take();
    if (token.kind === 'number') return { kind: 'number', value: token.value };
    if (token.kind === 'name') {
      if (match('(')) {
        const args: ExprNode[] = [];
        if (!match(')')) {
          do {
            const arg = parseConditional();
            if (!arg) return null;
            args.push(arg);
          } while (match(','));
          if (!match(')')) return fail();
        }
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'variable', name: token.value };
    }
    if (token.kind === 'op' && token.value === '(') {
      const value = parseConditional();
      if (!value) return null;
      if (!match(')')) return fail();
      return value;
    }
    return fail();
  };

  const parseUnary = (): ExprNode | null => {
    const token = peek();
    if (token.kind === 'op' && (token.value === '-' || token.value === '+' || token.value === '!')) {
      take();
      const value = parseUnary();
      return value ? { kind: 'unary', op: token.value, value } : null;
    }
    return parsePower();
  };

  const parsePower = (): ExprNode | null => {
    const left = parsePrimary();
    if (!left) return null;
    if (match('^') || match('**')) {
      const right = parseUnary();
      return right ? { kind: 'binary', op: '^', left, right } : null;
    }
    return left;
  };

  const parseMul = (): ExprNode | null => {
    let left = parseUnary();
    if (!left) return null;
    while (peek().kind === 'op' && ['*', '/', '%'].includes((peek() as { value: string }).value)) {
      const op = (take() as { value: string }).value;
      const right = parseUnary();
      if (!right) return null;
      left = { kind: 'binary', op, left, right };
    }
    return left;
  };

  const parseAdd = (): ExprNode | null => {
    let left = parseMul();
    if (!left) return null;
    while (peek().kind === 'op' && ['+', '-'].includes((peek() as { value: string }).value)) {
      const op = (take() as { value: string }).value;
      const right = parseMul();
      if (!right) return null;
      left = { kind: 'binary', op, left, right };
    }
    return left;
  };

  const parseComparison = (): ExprNode | null => {
    let left = parseAdd();
    if (!left) return null;
    while (
      peek().kind === 'op' &&
      ['<', '>', '<=', '>='].includes((peek() as { value: string }).value)
    ) {
      const op = (take() as { value: string }).value;
      const right = parseAdd();
      if (!right) return null;
      left = { kind: 'binary', op, left, right };
    }
    return left;
  };

  const parseEquality = (): ExprNode | null => {
    let left = parseComparison();
    if (!left) return null;
    while (peek().kind === 'op' && ['==', '!='].includes((peek() as { value: string }).value)) {
      const op = (take() as { value: string }).value;
      const right = parseComparison();
      if (!right) return null;
      left = { kind: 'binary', op, left, right };
    }
    return left;
  };

  const parseAnd = (): ExprNode | null => {
    let left = parseEquality();
    if (!left) return null;
    while (match('&&')) {
      const right = parseEquality();
      if (!right) return null;
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  };

  const parseOr = (): ExprNode | null => {
    let left = parseAnd();
    if (!left) return null;
    while (match('||')) {
      const right = parseAnd();
      if (!right) return null;
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  };

  function parseConditional(): ExprNode | null {
    const test = parseOr();
    if (!test) return null;
    if (!match('?')) return test;
    const yes = parseConditional();
    if (!yes || !match(':')) return fail();
    const no = parseConditional();
    if (!no) return null;
    return { kind: 'conditional', test, yes, no };
  }

  const root = parseConditional();
  if (!root || failed || peek().kind !== 'eof') return null;
  return root;
}

function evalNode(node: ExprNode, vars: Record<string, number>): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'variable':
      return vars[node.name] ?? CONSTANTS[node.name] ?? 0;
    case 'unary': {
      const value = evalNode(node.value, vars);
      if (node.op === '-') return -value;
      if (node.op === '!') return value === 0 ? 1 : 0;
      return value;
    }
    case 'binary': {
      const left = evalNode(node.left, vars);
      const right = evalNode(node.right, vars);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? 0 : left / right;
        case '%':
          return right === 0 ? 0 : left % right;
        case '^':
        case '**':
          return Math.pow(left, right);
        case '<':
          return left < right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
        case '==':
          return left === right ? 1 : 0;
        case '!=':
          return left !== right ? 1 : 0;
        case '&&':
          return left !== 0 && right !== 0 ? 1 : 0;
        case '||':
          return left !== 0 || right !== 0 ? 1 : 0;
        default:
          return 0;
      }
    }
    case 'conditional':
      return evalNode(node.test, vars) !== 0 ? evalNode(node.yes, vars) : evalNode(node.no, vars);
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) return 0;
      return fn(...node.args.map((arg) => evalNode(arg, vars)));
    }
    default:
      return 0;
  }
}

/** Evaluate a formula. Invalid expressions resolve to `fallback` (default 0). */
export function evaluateExpression(
  source: string,
  vars: Record<string, number>,
  fallback = 0,
): number {
  const text = (source ?? '').trim();
  if (!text) return fallback;
  let ast = EXPR_CACHE.get(text);
  if (ast === undefined) {
    ast = parse(text);
    EXPR_CACHE.set(text, ast);
  }
  if (!ast) return fallback;
  try {
    const value = evalNode(ast, vars);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/* Motion evaluation                                                          */
/* -------------------------------------------------------------------------- */

function wrapValue(value: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return value;
  const wrapped = ((((value + width / 2) % width) + width) % width) - width / 2;
  return wrapped === 0 ? 0 : wrapped;
}

/** Evaluate all motion formulas at a point in time. */
export function evaluateMotion(settings: Partial<MotionSettings>, time: number): MotionFrame {
  const p: MotionSettings = { ...DEFAULT_MOTION, ...settings };
  const duration = Math.max(0.01, Number(p.duration) || DEFAULT_MOTION.duration);
  const fps = Math.max(1, Number(p.fps) || DEFAULT_MOTION.fps);
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  const lt = p.loop ? ((t % duration) + duration) % duration : t;
  const vars: Record<string, number> = {
    t,
    frame: t * fps,
    lt,
    loopFrame: lt * fps,
    duration,
    fps,
  };
  const wrapWidth = Math.max(0.01, Number(p.wrapWidth) || DEFAULT_MOTION.wrapWidth);
  let x = evaluateExpression(p.x, vars);
  let y = evaluateExpression(p.y, vars);
  if (p.wrap === 'horizontal' || p.wrap === 'both') x = wrapValue(x, wrapWidth);
  if (p.wrap === 'both') y = wrapValue(y, wrapWidth);
  const scale = Math.max(0.01, Math.min(10, evaluateExpression(p.scale, vars, 1) || 1));
  return {
    time: lt,
    frame: lt * fps,
    x,
    y,
    z: evaluateExpression(p.z, vars),
    rotationX: evaluateExpression(p.rotationX, vars),
    rotationY: evaluateExpression(p.rotationY, vars),
    rotationZ: evaluateExpression(p.rotationZ, vars),
    scale,
  };
}
