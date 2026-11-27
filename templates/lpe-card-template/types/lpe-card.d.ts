export type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue | undefined }
export type CardVars = JsonObject;
export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface HealthSnapshot extends JsonObject {
  readonly overallHp: number;
  readonly pain: number;
  readonly painLabel: string;
  readonly bloodLoss: number;
  readonly bleedingLevel: string;
  readonly bleedingCount: number;
  readonly totalWounds: number;
  readonly capacities: JsonObject;
}
export interface CardState {
  readonly world: JsonObject;
  readonly onscreen: readonly JsonValue[];
  readonly offscreen_agendas: readonly JsonValue[];
  readonly entity_state: readonly JsonValue[];
  readonly inv: JsonObject;
  readonly health: HealthSnapshot;
  readonly tracks: JsonObject;
  readonly arc: JsonObject;
  readonly chekhov: JsonObject;
  readonly pair: readonly JsonValue[];
  readonly dam: readonly JsonValue[];
  /** Tracker snapshots. */
  readonly custom_trackers: readonly JsonObject[];
  /** Journal entries. */
  readonly notebook: readonly string[];
  readonly story_notes: JsonObject;
  /** Atlas snapshot. */
  readonly locations: JsonObject;
}

/** The EJS lpe/state bindings have additional fields beyond the iframe snapshot. */
export interface EjsState extends CardState {
  readonly entityMem: readonly JsonValue[];
  readonly thoughts: readonly JsonValue[];
  readonly vent: string;
  readonly health: HealthSnapshot & {
    readonly untreatedCount: number;
    readonly missingCount: number;
    readonly prostheticCount: number;
  };
}

export type BridgeChannel = 'lpe-card-bridge' | 'vexa-card-bridge';
export interface DiceResult {
  total: number;
  rolls: number[];
  kept: number[];
  modifier: number;
  expr: string;
  valueOf(): number;
  toString(): string;
}
type Success = { ok: true };
type VarsResult = Success & { vars: CardVars };
type SubmitResult = Success & { autoSend: boolean };
interface RpcMethods {
  resize: [{ height: number }, never];
  getState: [null, CardState];
  getPath: [{ path: string }, JsonValue];
  getVars: [null, CardVars];
  getVar: [{ path: string }, JsonValue];
  setVar: [{ path: string; value: JsonValue }, VarsResult];
  patchVars: [{ patch: JsonObject }, VarsResult];
  toast: [{ message: string; level: ToastLevel }, Success];
  fillInput: [{ text: string }, Success];
  submitInput: [{ text: string }, SubmitResult];
}
export type CardRpc = {
  [Method in keyof RpcMethods]: {
    type: 'LPE_CARD_RPC';
    channel: BridgeChannel;
    token: string;
    id: Method extends 'resize' ? 'resize' : string;
    method: Method;
    payload: RpcMethods[Method][0];
  }
}[keyof RpcMethods];
export type CardReply = {
  type: 'LPE_CARD_REPLY';
  channel: BridgeChannel;
  token: string;
  replyTo: string;
} & (
  | { ok: true; result: RpcMethods[keyof RpcMethods][1]; error: null }
  | { ok: false; result: null; error: string }
);
export type CardEvent = {
  type: 'LPE_CARD_EVENT';
  channel: 'lpe-card-bridge';
  token: string;
} & ({ event: 'state'; payload: CardState } | { event: 'vars'; payload: CardVars });

export interface LPECardBridge {
  readonly version: 1;
  readonly meta: Readonly<{ mesId: number; title: string }>;
  getState(): CardState;
  refreshState(): Promise<CardState>;
  getPath<F = undefined>(path: string, fallback?: F): JsonValue | F;
  getVars(): CardVars;
  /** Reads both flat paths and paths under stat_data. */
  getVar<F = undefined>(path: string, fallback?: F): JsonValue | F;
  /** Writes the specified path literally. */
  setVar(path: string, value: JsonValue): Promise<VarsResult>;
  patchVars(patch: JsonObject): Promise<VarsResult>;
  roll(expr?: string): DiceResult;
  toast(message: string, level?: ToastLevel): Promise<Success>;
  fillInput(text: string): Promise<Success>;
  /** Queues the confirmation bar unless rendererAllowAutoSend is enabled. */
  submitInput(text: string): Promise<SubmitResult>;
  resize(height: number): void;
  onStateChange(fn: (state: CardState) => void): () => void;
  onVarsChange(fn: (vars: CardVars) => void): () => void;
}

declare global {
  interface Window {
    readonly LPECard?: LPECardBridge;
    readonly VexaCard?: LPECardBridge;
  }
}
