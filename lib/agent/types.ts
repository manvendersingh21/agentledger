// Agent abstraction. The model is untrusted: it only gets AgentLedger tools, never DB/Stripe credentials.

export type AgentActivity =
  | { type: "status"; message: string }
  | { type: "tool_call"; id: string; tool: AgentToolName; input: unknown }
  | { type: "tool_result"; id: string; tool: AgentToolName; output: unknown }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; text: string; steps: number };

export type AgentToolName = "list_delegations" | "search_products" | "propose_purchase" | "get_action_status" | "get_receipt";

export interface AgentTools {
  list_delegations(): Promise<unknown>;
  search_products(input: { query: string }): Promise<unknown>;
  propose_purchase(input: { product_id: string; quantity?: number; reason?: string }): Promise<unknown>;
  get_action_status(input: { intent_id: string }): Promise<unknown>;
  get_receipt(input: { receipt_id?: string; intent_id?: string }): Promise<unknown>;
}

export interface RunAgentInput {
  prompt: string;
  tools: AgentTools;
  /** Red-team simulation: the model is told to trust merchant content (simulates a compromised agent). */
  compromised: boolean;
  onActivity: (activity: AgentActivity) => void;
  abortSignal?: AbortSignal;
}

export interface AgentResult {
  text: string;
  steps: number;
}

export interface AgentProvider {
  readonly name: string;
  readonly model: string;
  runAgent(input: RunAgentInput): Promise<AgentResult>;
}
