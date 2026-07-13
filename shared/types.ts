import { z } from "zod";

// Shared Schemas for validation
export const RegisterKeySchema = z.object({
  key: z.string().min(1, "API key is required"),
  label: z.string().optional(),
});

export const ValidateKeySchema = z.object({
  keyId: z.string().min(1, "keyId is required"),
});

export const CredentialSelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("system"),
  }),
  z.object({
    mode: z.literal("byok"),
    keyIds: z.array(z.string().uuid("Invalid key ID format")),
    activeKeyIndex: z.number().int().nonnegative("Active key index cannot be negative"),
  }),
]);

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  content: z.string(),
});

export const ChatSchema = z.object({
  messages: z.array(ChatMessageSchema),
  model: z.string().optional(),
  credentials: CredentialSelectionSchema,
  systemInstruction: z.string().optional(),
  temperature: z.number().optional(),
  responseMimeType: z.string().optional(),
  responseSchema: z.any().optional(),
});

export const GenerateImageSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  model: z.string().optional(),
  credentials: CredentialSelectionSchema,
  imageSize: z.string().optional(),
  aspectRatio: z.string().optional(),
});

// Infer types from schemas
export type RegisterKeyInput = z.infer<typeof RegisterKeySchema>;
export type ValidateKeyInput = z.infer<typeof ValidateKeySchema>;
export type CredentialSelection = z.infer<typeof CredentialSelectionSchema>;
export type ChatInput = z.infer<typeof ChatSchema>;
export type GenerateImageInput = z.infer<typeof GenerateImageSchema>;

export interface KeyRegistryEntry {
  keyId: string;
  rawKey: string;
  maskedKey: string;
  label: string;
  status: "Active" | "Ready" | "Rate Limited (429)" | "Invalid Key (403)" | "Failed";
  requestCount: number;
  cooldownUntil?: number;
  consecutiveFailures: number;
}
