import "server-only";
import {
  getActionStatus,
  getReceipt,
  listDelegations,
  proposePurchase,
  searchProducts,
  type DomainContext,
} from "@/lib/domain/pipeline";
import type { AgentTools } from "./types";

/** The only capabilities the model gets: AgentLedger domain operations bound to the authenticated principal. */
export function bindAgentTools(ctx: DomainContext): AgentTools {
  return {
    list_delegations: () => listDelegations(ctx),
    search_products: ({ query }) => searchProducts(ctx, query),
    propose_purchase: (args) => proposePurchase(ctx, args),
    get_action_status: ({ intent_id }) => getActionStatus(ctx, intent_id),
    get_receipt: (args) => getReceipt(ctx, args),
  };
}
