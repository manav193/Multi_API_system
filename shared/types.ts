import { z } from "zod";

// Shared Schemas for validation
export const RegisterKeySchema = z.object({
  key: z.string().min(1, "API key is required").max(200, "API key is too long"),
  label: z.string().max(50, "Label cannot exceed 50 characters").optional(),
}).strict();

export const ValidateKeySchema = z.object({
  keyId: z.string().min(1, "keyId is required"),
}).strict();

export const CredentialSelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("system"),
  }).strict(),
  z.object({
    mode: z.literal("byok"),
    keyIds: z.array(z.string().uuid("Invalid key ID format")).min(1, "At least one key is required"),
    activeKeyIndex: z.number().int().nonnegative("Active key index cannot be negative"),
  })
  .strict()
  .refine(
    (data) => data.activeKeyIndex < data.keyIds.length,
    {
      message: "Active key index must be within range",
      path: ["activeKeyIndex"],
    }
  ),
]);

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  content: z.string().max(20000, "Message content is too long"),
}).strict();

export const ChatSchema = z.object({
  messages: z.array(ChatMessageSchema).max(100, "History cannot exceed 100 messages"),
  model: z.enum(["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"]).optional(),
  credentials: CredentialSelectionSchema,
  systemInstruction: z.string().max(5000, "System instruction is too long").optional(),
  temperature: z.number().min(0.0).max(2.0, "Temperature must be between 0.0 and 2.0").optional(),
  responseMimeType: z.string().optional(),
  responseSchema: z.any().optional(),
}).strict();

export const GenerateImageSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(2000, "Prompt is too long"),
  model: z.enum(["imagen-3.0-generate-002", "gemini-3.1-flash-image", "imagen-3"]).optional(),
  credentials: CredentialSelectionSchema,
  imageSize: z.enum(["1024x1024", "512x512", "large", "medium", "small"]).optional(),
  aspectRatio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]).optional(),
}).strict();

// Infer types from schemas
export type RegisterKeyInput = z.infer<typeof RegisterKeySchema>;
export type ValidateKeyInput = z.infer<typeof ValidateKeySchema>;
export type CredentialSelection = z.infer<typeof CredentialSelectionSchema>;
export type ChatInput = z.infer<typeof ChatSchema>;
export type GenerateImageInput = z.infer<typeof GenerateImageSchema>;

export interface KeyRegistryEntry {
  keyId: string;
  rawKey: string;
  label: string;
  status: "Active" | "Ready" | "Rate Limited (429)" | "Invalid Key (403)" | "Failed";
  requestCount: number;
  cooldownUntil?: number;
  consecutiveFailures: number;
}
