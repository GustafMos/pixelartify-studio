/**
 * Scalar value utilities for the Constant / Math nodes and the value socket.
 *
 * A `value` socket carries a single number through the graph. The Math node
 * folds its connected value inputs with a fixed operation (and an optional
 * scalar operand for binary operations or a lone input).
 */

export type MathOperation =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'min'
  | 'max'
  | 'clamp'
  | 'lerp'
  | 'negate'
  | 'abs'
  | 'mod'
  | 'pow'
  | 'sin'
  | 'cos'
  | 'round'
  | 'floor'
  | 'ceil';

export const MATH_OPERATIONS: Array<{ value: MathOperation; label: string; hint?: string }> = [
  { value: 'add', label: 'Add (+)', hint: 'Sum of all inputs.' },
  { value: 'subtract', label: 'Subtract (−)', hint: 'Input A minus operand (or second input).' },
  { value: 'multiply', label: 'Multiply (×)', hint: 'Product of all inputs.' },
  { value: 'divide', label: 'Divide (÷)', hint: 'Input A divided by operand (or second input).' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'clamp', label: 'Clamp', hint: 'Clamp first input between Min and Max.' },
  { value: 'lerp', label: 'Lerp / Mix', hint: 'Blend inputs; the last input is the mix amount.' },
  { value: 'negate', label: 'Negate' },
  { value: 'abs', label: 'Absolute' },
  { value: 'mod', label: 'Modulo', hint: 'Input A modulo operand.' },
  { value: 'pow', label: 'Power', hint: 'Input A raised to the operand.' },
  { value: 'sin', label: 'Sine', hint: 'sin(input) in radians.' },
  { value: 'cos', label: 'Cosine', hint: 'cos(input) in radians.' },
  { value: 'round', label: 'Round' },
  { value: 'floor', label: 'Floor' },
  { value: 'ceil', label: 'Ceiling' },
];

export interface MathParams {
  operation: MathOperation;
  operand: number;
  min: number;
  max: number;
}

export const DEFAULT_MATH: MathParams = {
  operation: 'add',
  operand: 1,
  min: 0,
  max: 1,
};

/**
 * Read a value at a dotted path (e.g. `dither.strength`) from a params object.
 * Returns `undefined` when any segment is missing.
 */
export function getPath(source: unknown, path: string): unknown {
  const segments = path.split('.');
  let value = source;
  for (const segment of segments) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/**
 * Immutably write a value at a dotted path, creating intermediate objects as
 * needed. Always returns a new root object.
 */
export function setPath(source: unknown, path: string, value: unknown): unknown {
  const segments = path.split('.');
  const root: Record<string, unknown> =
    source && typeof source === 'object' && !Array.isArray(source)
      ? { ...(source as Record<string, unknown>) }
      : {};
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const existing = cursor[segment];
    const child: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[segment] = child;
    cursor = child;
  }
  cursor[segments[segments.length - 1]] = value;
  return root;
}

export function applyMathOp(
  operation: MathOperation,
  values: number[],
  params: Partial<MathParams> = {},
): number {
  const operand = Number.isFinite(Number(params.operand)) ? Number(params.operand) : DEFAULT_MATH.operand;
  const min = Number.isFinite(Number(params.min)) ? Number(params.min) : DEFAULT_MATH.min;
  const max = Number.isFinite(Number(params.max)) ? Number(params.max) : DEFAULT_MATH.max;
  const a = values[0] ?? 0;
  const b = values[1] ?? operand;
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

  switch (operation) {
    case 'add':
      return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : operand;
    case 'subtract':
      return a - b;
    case 'multiply':
      return values.length > 0 ? values.reduce((prod, v) => prod * v, 1) : operand;
    case 'divide':
      return b === 0 ? 0 : a / b;
    case 'min':
      return values.length > 0 ? Math.min(...values) : operand;
    case 'max':
      return values.length > 0 ? Math.max(...values) : operand;
    case 'clamp':
      return Math.max(min, Math.min(max, a));
    case 'lerp': {
      // Last input acts as the mix factor when there are 3+ inputs.
      if (values.length >= 3) {
        const t = clamp01(values[values.length - 1]);
        const from = values[0];
        const to = values[1];
        return from + (to - from) * t;
      }
      const t = clamp01(b);
      return a * (1 - t) + t;
    }
    case 'negate':
      return -a;
    case 'abs':
      return Math.abs(a);
    case 'mod':
      return b === 0 ? 0 : a % b;
    case 'pow':
      return Math.pow(a, b);
    case 'sin':
      return Math.sin(a);
    case 'cos':
      return Math.cos(a);
    case 'round':
      return Math.round(a);
    case 'floor':
      return Math.floor(a);
    case 'ceil':
      return Math.ceil(a);
    default:
      return a;
  }
}
