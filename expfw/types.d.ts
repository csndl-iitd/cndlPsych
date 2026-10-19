/**
 * Contracts for custom code (custom/tasks/*.js, custom/stimuli/*.js).
 * Files import nothing at runtime; they default-export an object and get everything
 * through the context. Use these types via JSDoc:
 *
 *   /** @type {import('../../framework/types').Task} *\/
 *   export default { ... }
 *
 * The declarative fields (params, input, events, requires, css) are validated by
 * schema/task-manifest.schema.json; the functions are called by the runtime.
 */

// ---------------------------------------------------------------- shared ---

/** ms number, '1.5s' string, {frames}, or [min, max] jitter of those. */
export type Duration = number | string | { frames: number } | [Duration, Duration]

/** Bare number = fraction of the stage's shorter side; strings carry px|mm|deg|%. */
export type Length = number | string

/** Point in stage coordinates (0-1, origin top-left). */
export interface StagePoint { x: number; y: number }

export type ParamType =
  | 'integer' | 'number' | 'string' | 'boolean' | 'duration' | 'length'
  | 'enum' | 'list' | 'stimulus' | 'intent' | 'object'

export interface ParamDecl {
  type: ParamType
  default?: unknown
  required?: boolean
  min?: number
  max?: number
  values?: Array<string | number | boolean>   // enum
  items?: ParamDecl                           // list
  unit?: string
  doc?: string
}
export type Params = Record<string, ParamDecl>

/** Declarative input scope; same shape as the `input:` yaml section. */
export type InputScope = Record<string, unknown>

// ------------------------------------------------------------------- rng ---

/** Seeded, per-session stream. Never use Math.random in tasks. */
export interface Rng {
  next(): number                              // [0, 1)
  int(min: number, max: number): number      // inclusive
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]        // returns a new array
  /** Independent child stream; stable under changes elsewhere in the task. */
  fork(label: string): Rng
}

// ---------------------------------------------------------------- layout ---

export interface ScatterOptions {
  minDistance: Length
  margin: Length
  /** Give up after this many rejected draws and throw a descriptive error. Default 10_000. */
  maxAttempts?: number
}

export interface Layout {
  /** n well-separated points inside the stage; throws if they cannot fit. */
  scatter(n: number, opts: ScatterOptions): StagePoint[]
  /** Inline CSS placing an element's center at a stage point. */
  at(p: StagePoint): string
  /** Stage size in CSS px, for the rare case a task needs pixels. */
  readonly size: { w: number; h: number }
}

// ---------------------------------------------------------------- phases ---

/** Opaque timeline node produced by the phase builders. */
export interface PhaseSpec { readonly __phase: true }
export type TimelineNode = PhaseSpec | TimelineNode[]

export interface PhaseOptions {
  /** Name used in phase.onset/offset events and trigger rules. */
  name?: string
  /** null = until a response ends it. */
  duration?: Duration | null
  /** 'any', 'none', or intent name(s). */
  response?: string | string[]
  timeout?: Duration
  /** Gap after the phase. */
  post?: Duration
  onResponse?: 'end' | 'continue'
  /** Expected intent(s), optionally only in a context (see response_task docs). */
  correct?: string | string[] | { intent: string | string[]; where?: Record<string, unknown> }
  /** Extra fields written to this phase's trial data. */
  data?: Record<string, unknown>
}

export interface PhaseBuilder {
  /** A stimulus from stimuli.yaml (or a generator instance), by name. */
  stimulus(name: string, opts?: PhaseOptions & { vars?: Record<string, unknown> }): PhaseSpec
  html(html: string, opts?: PhaseOptions): PhaseSpec
  blank(opts?: { duration: Duration; name?: string }): PhaseSpec
  /** Escape hatch: any jsPsych plugin registered in custom/plugins or bundled. */
  plugin(name: string, params: Record<string, unknown>, opts?: PhaseOptions): PhaseSpec
}

// ------------------------------------------------------------------ plan ---

export interface TrialSpec {
  /** 1-based within the block. */
  index: number
  name?: string
  conditions: Record<string, string | number | boolean>
}

export interface Plan {
  /** The seeded, compiled trial list for this block (design factors already expanded). */
  trials(n?: number): TrialSpec[]
}

// ------------------------------------------------------------------ bus ----

export interface BusEvent {
  seq: number
  t: number
  type: string
  data: Record<string, unknown>
}

export interface Bus {
  /** Emit a custom event; type must be declared in the task's `events`. */
  emit(type: `task.${string}` | `semantic.${string}`, data?: Record<string, unknown>): void
  /** Subscribe for the duration of the current trial (auto-unsubscribed). Never attach DOM listeners. */
  on(type: string, handler: (e: BusEvent) => void): void
}

export interface Log {
  debug(msg: string, ...rest: unknown[]): void
  info(msg: string, ...rest: unknown[]): void
  warn(msg: string, ...rest: unknown[]): void
}

// ---------------------------------------------------------------- context --

export interface StimulusStore {
  get(name: string): Readonly<Record<string, unknown>>
  has(name: string): boolean
}

export interface TaskContext<P = Record<string, any>> {
  /** Validated params with defaults applied. */
  readonly params: P
  readonly stimuli: StimulusStore
  readonly plan: Plan
  readonly phase: PhaseBuilder
  readonly rng: Rng
  readonly layout: Layout
  readonly bus: Bus
  readonly log: Log
  readonly block: { id: string; index: number }
  /** Active device profile id (desktop, phone, ...). */
  readonly profile: string
}

// ------------------------------------------------------------------ Task ---

export interface Task<P = Record<string, any>> {
  doc?: string
  params?: Params
  /** Level-2 cascade default for input mapping. */
  input?: InputScope
  /** Custom events emitted via bus.emit; enables validation of trigger `on:`. */
  events?: string[]
  requires?: { intents?: string[]; profiles?: string[] }
  /** Return the block's timeline. Pure with respect to ctx; no globals, no DOM. */
  build(ctx: TaskContext<P>): TimelineNode[] | Promise<TimelineNode[]>
}

// ------------------------------------------------------ StimulusGenerator ---

export interface GeneratorContext<P = Record<string, any>> {
  readonly params: P
  readonly rng: Rng
  readonly layout: Layout
  readonly log: Log
  readonly profile: string
  /** 1-based trial number within the block, or 0 outside a trial. */
  readonly trial: number
}

export interface GeneratedStimulus {
  /**
   * Markup for the stage. Elements with data-role / data-id attributes are
   * registered as hit targets automatically (role: 'target' | 'distractor' | ...).
   */
  html: string
  /** Merged into this trial's data (positions, identities, ...). */
  data?: Record<string, unknown>
}

export interface StimulusGenerator<P = Record<string, any>> {
  doc?: string
  params?: Params
  css?: string
  events?: string[]
  generate(ctx: GeneratorContext<P>): GeneratedStimulus
}
