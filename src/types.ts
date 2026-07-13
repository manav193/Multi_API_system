export interface VirtualFile {
  path: string;
  content: string;
  language: string;
}

export interface RotationLog {
  id: string;
  timestamp: string;
  message: string;
  type: "info" | "success" | "warn" | "error";
}

export interface APIKey {
  id: string;
  key: string;
  label: string;
  status: "Active" | "Ready" | "Rate Limited (429)" | "Invalid Key (403)" | "Failed";
  requestCount: number;
  isSystemDefault?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: string;
  modelUsed?: string;
  rotationLogs?: string[];
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  imageUrl: string;
  size: string;
  aspectRatio: string;
  timestamp: string;
  rotationLogs?: string[];
}

export type ModelType = "gemini-3.1-pro-preview" | "gemini-3.5-flash" | "gemini-3.1-flash-lite";

export interface AgentRole {
  id: string;
  name: string;
  description: string;
  icon: string;
  systemInstruction: string;
  suggestedPrompts: string[];
}
