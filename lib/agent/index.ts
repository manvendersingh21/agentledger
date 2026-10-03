import "server-only";
import { serverEnv } from "@/lib/env";
import { OpenAIAgentProvider } from "./openai-provider";
import type { AgentProvider } from "./types";

export function getAgentProvider(): AgentProvider | null {
  const key = serverEnv.openaiApiKey();
  if (!key) return null;
  return new OpenAIAgentProvider(key, serverEnv.agentModel());
}
