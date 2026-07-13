import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Key,
  RefreshCw,
  Plus,
  Trash2,
  Play,
  CheckCircle,
  AlertCircle,
  Terminal,
  Code,
  Image as ImageIcon,
  Sparkles,
  PlusCircle,
  Edit3,
  Folder,
  ExternalLink,
  FileCode,
  Eye,
  Check,
  Zap,
  ShieldAlert,
  Wrench,
  ChevronRight,
  Copy,
  Database,
  HelpCircle,
  AlertTriangle,
  Cpu,
  FileText,
  Send,
  User,
  Bot,
  Clock,
  Activity,
  Sliders,
  X
} from "lucide-react";
import { VirtualFile, RotationLog, APIKey, ChatMessage, GeneratedImage, ModelType, AgentRole } from "./types";

// Standard Agent Roles with specific system prompts and suggestions
const AGENT_ROLES: AgentRole[] = [
  {
    id: "fullstack",
    name: "Full-Stack Architect",
    description: "Builds complete layouts, multi-file apps, and handles application logic.",
    icon: "Cpu",
    systemInstruction: `You are an expert Full-Stack Architect. You design, structure, and implement entire web applications.
You must respond ONLY in a structured JSON format containing two fields:
1. "message": string (A detailed, helpful explanation of your updates, architecture, and code decisions)
2. "fileUpdates": array of objects, where each object contains:
   - "path": string (The relative path of the file to create/update, e.g. "index.html", "script.js")
   - "content": string (The complete file content with no truncations or placeholders)

Example Response:
{
  "message": "I have created a modern landing page for you with an interactive feature.",
  "fileUpdates": [
    {
      "path": "index.html",
      "content": "..."
    }
  ]
}`,
    suggestedPrompts: [
      "Create a responsive personal landing page",
      "Build an interactive countdown timer app",
      "Create a simple pomodoro clock with custom sounds"
    ]
  },
  {
    id: "wizard",
    name: "Tailwind & React Wizard",
    description: "Crafts gorgeous visual layouts, transitions, custom animations, and CSS magic.",
    icon: "Sparkles",
    systemInstruction: `You are a visual design expert and senior UI engineer. You specialize in Tailwind CSS and modern web interactions.
You design ultra-polished, visually magnificent screens with modern colors, shadows, cards, and smooth micro-animations.
You must respond ONLY in a structured JSON format containing two fields:
1. "message": string (A visual design rationale explaining the typography, color palette, and styling chosen)
2. "fileUpdates": array of objects, where each object contains:
   - "path": string (The relative path of the file to create/update)
   - "content": string (The complete file content, using Tailwind CSS classes for styling)

Ensure you output complete, high-contrast, beautiful HTML layouts.`,
    suggestedPrompts: [
      "Design an ultra-modern glassmorphic login panel",
      "Create a creative pricing table with hover effects",
      "Build a beautiful bento-grid dashboard widget"
    ]
  },
  {
    id: "debugger",
    name: "Automated Code Doctor",
    description: "Analyzes stack traces, fixes syntax and logic errors, and optimizes performance.",
    icon: "Wrench",
    systemInstruction: `You are a senior debugger and logic optimizer. Your goal is to resolve bugs, handle edge cases, and speed up code.
You must respond ONLY in a structured JSON format containing two fields:
1. "message": string (A diagnostic analysis explaining why the error occurred and how you fixed it)
2. "fileUpdates": array of objects, where each object contains:
   - "path": string (The relative path of the file to create/update)
   - "content": string (The complete, optimized file content)

Analyze the user's workspace carefully and provide robust, clean fixes.`,
    suggestedPrompts: [
      "Optimize the performance of my scripts",
      "Audit my file content for bugs and add error-boundaries",
      "Add input validation to form fields in index.html"
    ]
  },
  {
    id: "auditor",
    name: "Security Guard",
    description: "Audits code for XSS, CSRF, insecure variables, and sanitizes input data.",
    icon: "ShieldAlert",
    systemInstruction: `You are a certified cyber security analyst. You scan front-end code for security flaws (XSS injection, unescaped text, insecure state, insecure API calls).
You must respond ONLY in a structured JSON format containing two fields:
1. "message": string (A detailed security report outlining vulnerabilities found, severity ratings, and how you neutralized them)
2. "fileUpdates": array of objects, where each object contains:
   - "path": string (The relative path of the file to create/update)
   - "content": string (The complete, secured file content)

Write highly secure and sanitized front-end code.`,
    suggestedPrompts: [
      "Audit my HTML/JS for XSS vulnerabilities",
      "Sanitize form input before rendering it in index.html",
      "Secure my simulated local state variables"
    ]
  }
];

// Initial default workspace template
const DEFAULT_WORKSPACE: VirtualFile[] = [
  {
    path: "index.html",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Agent Sandbox</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="bg-slate-950 text-white min-h-screen flex flex-col items-center justify-center p-6 select-none">
  
  <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center space-y-6 relative overflow-hidden">
    <!-- Visual background accent -->
    <div class="absolute -top-10 -right-10 w-32 h-32 bg-indigo-600 rounded-full blur-3xl opacity-20"></div>
    
    <div class="inline-flex items-center justify-center p-3 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
      <svg class="w-8 h-8 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </div>

    <div class="space-y-2">
      <h1 id="title" class="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
        Hello Sandbox!
      </h1>
      <p class="text-slate-400 text-sm">
        This is a live virtual preview compiled right inside your browser. Ask the agent to modify or redesign this workspace!
      </p>
    </div>

    <div class="flex flex-col items-center justify-center bg-slate-950/50 rounded-xl p-4 border border-slate-800">
      <span class="text-xs font-mono text-slate-500 mb-1 uppercase tracking-wider">Dynamic State</span>
      <div id="counter" class="text-3xl font-extrabold text-indigo-400">0</div>
    </div>

    <button id="increment-btn" class="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 active:scale-95 transition-all rounded-xl font-medium shadow-lg shadow-indigo-500/20">
      Push Increment
    </button>
  </div>

  <script src="script.js"></script>
</body>
</html>`,
    language: "html"
  },
  {
    path: "style.css",
    content: `/* Custom stylesheets for the sandbox workspace */
body {
  font-family: 'Inter', system-ui, sans-serif;
  background-image: radial-gradient(circle at 50% 50%, rgba(30, 27, 75, 0.4) 0%, rgba(3, 7, 18, 1) 100%);
}

#increment-btn {
  box-shadow: 0 4px 20px -2px rgba(99, 102, 241, 0.4);
}`,
    language: "css"
  },
  {
    path: "script.js",
    content: `// Interactive scripting logic for sandbox workspace
console.log("🚀 Sandbox loaded successfully!");

let count = 0;
const counterEl = document.getElementById("counter");
const btnEl = document.getElementById("increment-btn");
const titleEl = document.getElementById("title");

if (btnEl && counterEl) {
  btnEl.addEventListener("click", () => {
    count++;
    counterEl.textContent = count;
    
    // Add visual feedback effect
    counterEl.classList.add("scale-110", "text-pink-400");
    setTimeout(() => {
      counterEl.classList.remove("scale-110", "text-pink-400");
    }, 150);
    
    // Log interaction to console
    console.log("Count is now: " + count);

    // Dynamic title alteration
    if (count === 10) {
      titleEl.textContent = "Supercharged Sandbox!";
      titleEl.classList.add("animate-bounce");
      console.log("🏆 Milestone reached! Counter hit 10!");
    }
  });
}`,
    language: "javascript"
  }
];

export default function App() {
  // Tabs & Layout States
  const [activeTab, setActiveTab] = useState<"agent" | "images" | "diagnostics">("agent");
  const [activeRole, setActiveRole] = useState<AgentRole>(AGENT_ROLES[0]);
  const [selectedModel, setSelectedModel] = useState<ModelType>("gemini-3.5-flash");

  // API Key Pool States
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [activeKeyIndex, setActiveKeyIndex] = useState<number>(0);
  const [newKeyInput, setNewKeyInput] = useState<string>("");
  const [newKeyLabel, setNewKeyLabel] = useState<string>("");
  const [validatingKeyId, setValidatingKeyId] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>("");

  // Workspace Files
  const [files, setFiles] = useState<VirtualFile[]>(() => {
    const saved = localStorage.getItem("aegis_workspace_files");
    return saved ? JSON.parse(saved) : DEFAULT_WORKSPACE;
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string>("index.html");
  const [editorContent, setEditorContent] = useState<string>("");
  const [isEditorDirty, setIsEditorDirty] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>("");
  const [showNewFileInput, setShowNewFileInput] = useState<boolean>(false);

  // Chat & Agent States
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("aegis_chat_history");
    return saved ? JSON.parse(saved) : [
      {
        id: "welcome",
        role: "model",
        content: "Hello! I am your resilient, multi-key backed Coding Agent. I can write and update complete application files inside this workspace.\n\nDescribe what you'd like to build, or try one of the suggested prompts!",
        timestamp: new Date().toLocaleTimeString(),
        modelUsed: "gemini-3.5-flash"
      }
    ];
  });
  const [userInput, setUserInput] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Image Lab States
  const [imagePrompt, setImagePrompt] = useState<string>("");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [imageAspect, setImageAspect] = useState<"1:1" | "16:9" | "9:16" | "4:3" | "3:4">("1:1");
  const [imageModel, setImageModel] = useState<string>("gemini-3.1-flash-image"); // standard high quality
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>(() => {
    const saved = localStorage.getItem("aegis_generated_images");
    return saved ? JSON.parse(saved) : [];
  });
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);

  // Rotation Logs & Diagnostics
  const [rotationLogs, setRotationLogs] = useState<RotationLog[]>([]);
  const [systemLogs, setSystemLogs] = useState<string[]>([]);
  const [diagnosticsStats, setDiagnosticsStats] = useState({
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rotationsCount: 0
  });

  // Sandbox Compiler & Terminal States
  const [sandboxSrc, setSandboxSrc] = useState<string>("");
  const [sandboxConsole, setSandboxConsole] = useState<string[]>(["Sandbox log initialized..."]);
  const [isSandboxRunning, setIsSandboxRunning] = useState<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Fetch initial Server Key existence & set up Key Pool
  useEffect(() => {
    const initializeAndMigrate = async () => {
      try {
        // 1. Establish session and retrieve CSRF token
        const sessionResponse = await fetch("/api/session", { method: "POST" });
        if (!sessionResponse.ok) {
          throw new Error("Failed to initialize session");
        }
        const { csrfToken: token } = await sessionResponse.json();
        setCsrfToken(token);

        // 2. Query system key status
        const systemStatusResponse = await fetch("/api/system-key-status");
        const systemStatus = await systemStatusResponse.json();

        // 3. Migrate legacy keys from localStorage if they exist
        const legacyKeysStr = localStorage.getItem("aegis_custom_keys");
        const legacyKeys: any[] = legacyKeysStr ? JSON.parse(legacyKeysStr) : [];

        const pool: APIKey[] = [];

        // Add system key if available
        if (systemStatus.hasDefaultKey) {
          pool.push({
            id: "system-default",
            key: "Injected Server Key", // Never expose default key
            label: "Server Config Key (Default)",
            status: "Ready",
            requestCount: 0,
            isSystemDefault: true,
          });
        }

        // Migrate custom keys to server registry
        if (legacyKeys.length > 0) {
          addSystemLog(`Migrating ${legacyKeys.length} legacy API keys to secure session store...`);
          for (const legacyKey of legacyKeys) {
            if (legacyKey.key && legacyKey.key.startsWith("AIzaSy")) {
              try {
                const regResponse = await fetch("/api/session/keys", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": token,
                  },
                  body: JSON.stringify({
                    key: legacyKey.key,
                    label: legacyKey.label,
                  }),
                });

                if (regResponse.ok) {
                  const regData = await regResponse.json();
                  pool.push({
                    id: regData.keyId,
                    key: regData.maskedKey,
                    label: regData.label,
                    status: "Ready",
                    requestCount: 0,
                  });
                } else {
                  addSystemLog(`Failed to migrate legacy key: ${legacyKey.label}. It may be invalid.`, "error");
                }
              } catch (err) {
                addSystemLog(`Migration error for key ${legacyKey.label}`, "error");
              }
            }
          }

          // Clear legacy raw keys from localStorage immediately
          localStorage.removeItem("aegis_custom_keys");
        }

        // 4. Fetch currently registered keys from the session to sync with the pool
        const keysResponse = await fetch("/api/session/keys");
        if (keysResponse.ok) {
          const registeredKeys: any[] = await keysResponse.json();
          registeredKeys.forEach((rk) => {
            if (!pool.some((pk) => pk.id === rk.keyId)) {
              pool.push({
                id: rk.keyId,
                key: rk.maskedKey,
                label: rk.label,
                status: rk.status || "Ready",
                requestCount: rk.requestCount || 0,
              });
            }
          });
        }

        setApiKeys(pool);
        addSystemLog("Loaded API key pool. Ready to handle requests.");
      } catch (err) {
        addSystemLog("Error during session initialization.", "error");
      }
    };
    
    initializeAndMigrate();
  }, []);

  // Sync virtual files, images, and chat history to localStorage
  useEffect(() => {
    localStorage.setItem("aegis_workspace_files", JSON.stringify(files));
  }, [files]);

  useEffect(() => {
    localStorage.setItem("aegis_chat_history", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem("aegis_generated_images", JSON.stringify(generatedImages));
  }, [generatedImages]);

  // Keep code editor in sync with file selection
  useEffect(() => {
    const targetFile = files.find((f) => f.path === selectedFilePath);
    if (targetFile) {
      setEditorContent(targetFile.content);
      setIsEditorDirty(false);
    }
  }, [selectedFilePath, files]);

  // Auto scroll helpers
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rotationLogs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sandboxConsole]);

  // Handle building the interactive client-side iframe sandbox
  const runSandbox = () => {
    setIsSandboxRunning(true);
    setSandboxConsole(["Building sandbox bundles...", "Compiling local file resources..."]);
    
    const indexFile = files.find((f) => f.path === "index.html");
    if (!indexFile) {
      setSandboxConsole((prev) => [...prev, "❌ Error: index.html was not found inside the workspace!"]);
      setIsSandboxRunning(false);
      return;
    }

    try {
      let combinedHTML = indexFile.content;

      // Inline styles
      files.forEach((file) => {
        if (file.path.endsWith(".css")) {
          const styleTag = `<style id="aegis-inlined-${file.path}">\n${file.content}\n</style>`;
          // Replace link tags targeting this file or append to head
          const linkRegex = new RegExp(`<link[^>]*href=["']${file.path}["'][^>]*>`, "gi");
          if (linkRegex.test(combinedHTML)) {
            combinedHTML = combinedHTML.replace(linkRegex, styleTag);
          } else {
            combinedHTML = combinedHTML.replace("</head>", `${styleTag}\n</head>`);
          }
        }
      });

      // Inline scripts & Inject Visual Console Interceptor
      const consoleInterceptorScript = `
        <script id="aegis-console-interceptor">
          (function() {
            const originalLog = console.log;
            const originalError = console.error;
            const originalWarn = console.warn;

            function sendToParent(type, args) {
              window.parent.postMessage({
                source: "aegis-sandbox-log",
                type: type,
                message: args.map(arg => {
                  if (typeof arg === "object") {
                    try { return JSON.stringify(arg); } catch(e) { return String(arg); }
                  }
                  return String(arg);
                }).join(" ")
              }, "*");
            }

            console.log = function(...args) {
              originalLog.apply(console, args);
              sendToParent("info", args);
            };
            console.error = function(...args) {
              originalError.apply(console, args);
              sendToParent("error", args);
            };
            console.warn = function(...args) {
              originalWarn.apply(console, args);
              sendToParent("warn", args);
            };

            window.addEventListener("error", function(e) {
              sendToParent("error", [e.message + " at " + e.filename + ":" + e.lineno]);
            });
          })();
        </script>
      `;

      combinedHTML = combinedHTML.replace("<head>", `<head>\n${consoleInterceptorScript}`);

      files.forEach((file) => {
        if (file.path.endsWith(".js") && file.path !== "index.html") {
          const scriptTag = `<script id="aegis-inlined-${file.path}">\n${file.content}\n</script>`;
          const scriptRegex = new RegExp(`<script[^>]*src=["']${file.path}["'][^>]*>\\s*</script>|<script[^>]*src=["']${file.path}["'][^>]*>`, "gi");
          if (scriptRegex.test(combinedHTML)) {
            combinedHTML = combinedHTML.replace(scriptRegex, scriptTag);
          } else {
            combinedHTML = combinedHTML.replace("</body>", `${scriptTag}\n</body>`);
          }
        }
      });

      // Create Blob URL for combined HTML
      const blob = new Blob([combinedHTML], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      setSandboxSrc(blobUrl);
      setSandboxConsole((prev) => [...prev, "🚀 Sandbox compiled and running in live sandbox iframe!"]);
    } catch (err: any) {
      setSandboxConsole((prev) => [...prev, `❌ Compilation Error: ${err.message}`]);
      setIsSandboxRunning(false);
    }
  };

  // Compile sandbox automatically on file changes when workspace runs
  useEffect(() => {
    if (isSandboxRunning) {
      runSandbox();
    }
  }, [files]);

  // Capture logging messages from sandbox iframe
  useEffect(() => {
    const handleSandboxMessage = (event: MessageEvent) => {
      if (event.data && event.data.source === "aegis-sandbox-log") {
        const timeStr = new Date().toLocaleTimeString();
        const typePrefix = event.data.type === "error" ? "❌ [ERROR]" : event.data.type === "warn" ? "⚠️ [WARN]" : "⚙️ [LOG]";
        setSandboxConsole((prev) => [...prev, `[${timeStr}] ${typePrefix} ${event.data.message}`]);
      }
    };

    window.addEventListener("message", handleSandboxMessage);
    return () => {
      window.removeEventListener("message", handleSandboxMessage);
    };
  }, []);

  // Logs helper
  const addSystemLog = (msg: string, type: "info" | "success" | "warn" | "error" = "info") => {
    const time = new Date().toLocaleTimeString();
    const id = Math.random().toString(36).substring(7);
    
    // Add to key rotation list
    setRotationLogs((prev) => [
      ...prev,
      { id, timestamp: time, message: msg, type }
    ]);

    // Keep raw lines for diagnostic panel
    setSystemLogs((prev) => [...prev, `[${time}] [${type.toUpperCase()}] ${msg}`]);
  };

  // Process Key rotation logs received from the Server API responses
  const processServerRotationLogs = (logs: string[], keyStatuses: Record<string, string>) => {
    if (!logs || logs.length === 0) return;

    logs.forEach((log) => {
      if (log.includes("[SUCCESS]")) {
        addSystemLog(log, "success");
      } else if (log.includes("[FAIL OVER]")) {
        addSystemLog(log, "warn");
        setDiagnosticsStats((prev) => ({ ...prev, rotationsCount: prev.rotationsCount + 1 }));
      } else if (log.includes("[ROTATE]")) {
        addSystemLog(log, "info");
      } else if (log.includes("[ERROR]")) {
        addSystemLog(log, "error");
      } else {
        addSystemLog(log, "info");
      }
    });

    // Update statuses inside the Key Pool
    if (keyStatuses) {
      setApiKeys((prevKeys) => {
        return prevKeys.map((k) => {
          const matchedStatus = Object.keys(keyStatuses).find(
            (srvKeyId) => srvKeyId === k.id
          );
          if (matchedStatus) {
            return { ...k, status: keyStatuses[matchedStatus] as any };
          }
          return k;
        });
      });
    }
  };

  // Add a key to the Pool
  const handleAddKey = async () => {
    if (!newKeyInput.trim()) return;

    // Check if key is valid Gemini format
    if (!newKeyInput.trim().startsWith("AIzaSy")) {
      addSystemLog("Invalid key format. Gemini API keys must start with 'AIzaSy'.", "error");
      return;
    }

    addSystemLog(`Registering new custom API key securely on server...`);

    try {
      const response = await fetch("/api/session/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          key: newKeyInput.trim(),
          label: newKeyLabel.trim() || `Custom Key #${apiKeys.length}`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to register key.");
      }

      const newKey: APIKey = {
        id: data.keyId,
        key: data.maskedKey,
        label: data.label,
        status: "Ready",
        requestCount: 0,
      };

      setApiKeys((prev) => [...prev, newKey]);
      addSystemLog(`Successfully registered and activated custom key: ${newKey.label}`, "success");

      setNewKeyInput("");
      setNewKeyLabel("");
    } catch (err: any) {
      addSystemLog(`Key registration failed: ${err.message}`, "error");
    }
  };

  // Delete a key from the Pool
  const handleDeleteKey = async (id: string) => {
    const target = apiKeys.find((k) => k.id === id);
    if (!target) return;
    if (target.isSystemDefault) {
      addSystemLog("Cannot delete System Default Key! (Injected via server config)", "error");
      return;
    }

    addSystemLog(`Revoking and deleting API key from server...`);

    try {
      const response = await fetch(`/api/session/keys/${id}`, {
        method: "DELETE",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete key.");
      }

      setApiKeys((prev) => prev.filter((k) => k.id !== id));
      addSystemLog(`Successfully revoked key: ${target.label}`, "success");
      setActiveKeyIndex(0);
    } catch (err: any) {
      addSystemLog(`Failed to delete key: ${err.message}`, "error");
    }
  };

  // Validate a single key instantly
  const handleValidateKey = async (id: string, keyVal: string) => {
    setValidatingKeyId(id);
    addSystemLog(`Starting manual validation check for key...`);
    try {
      const response = await fetch("/api/validate-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ keyId: id })
      });
      const data = await response.json();

      setApiKeys((prev) => {
        return prev.map((k) => {
          if (k.id === id) {
            return {
              ...k,
              status: data.valid ? "Ready" : "Invalid Key (403)"
            };
          }
          return k;
        });
      });

      if (data.valid) {
        addSystemLog(`Key is valid and active. Connection established!`, "success");
      } else {
        addSystemLog(`Key validation failed: ${data.error || "403 Forbidden"}`, "error");
      }
    } catch (err: any) {
      addSystemLog(`Key validation failed with network error: ${err.message}`, "error");
    } finally {
      setValidatingKeyId(null);
    }
  };

  // Submit a message/prompt to the Coding Agent
  const handleSendPrompt = async (forcedPrompt?: string) => {
    const promptToSend = forcedPrompt || userInput;
    if (!promptToSend.trim() || isGenerating) return;

    if (!forcedPrompt) {
      setUserInput("");
    }

    // Append user message
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: "user",
      content: promptToSend,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);
    addSystemLog(`Sending request to Coding Agent (${selectedModel})...`);

    // Build credentials selection payload
    const activeKey = apiKeys[activeKeyIndex];
    let credentials;
    if (!activeKey || activeKey.isSystemDefault) {
      credentials = { mode: "system" as const };
    } else {
      const customKeys = apiKeys.filter((k) => !k.isSystemDefault);
      const customActiveIndex = customKeys.findIndex((k) => k.id === activeKey.id);
      credentials = {
        mode: "byok" as const,
        keyIds: customKeys.map((k) => k.id),
        activeKeyIndex: customActiveIndex >= 0 ? customActiveIndex : 0,
      };
    }

    // Build standard message payload in Gemini history format
    const formattedHistory = messages.concat(userMsg).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }]
    }));

    // Generate System instruction merged with current role instructions
    const workspaceSnapshot = `
CURRENT WORKSPACE FILES SNAPSHOT:
${files.map((f) => `--- FILE: ${f.path} ---\n${f.content}\n`).join("\n")}
`;

    const finalSystemInstruction = `${activeRole.systemInstruction}\n\n${workspaceSnapshot}`;

    try {
      // Increment stats
      setDiagnosticsStats((prev) => ({ ...prev, totalRequests: prev.totalRequests + 1 }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          messages: formattedHistory,
          model: selectedModel,
          credentials,
          systemInstruction: finalSystemInstruction,
          responseMimeType: "application/json",
          // Instruct the schema mapping matching our JSON structured layout
          responseSchema: {
            type: "OBJECT",
            properties: {
              message: { type: "STRING", description: "The agent explanation response" },
              fileUpdates: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    path: { type: "STRING" },
                    content: { type: "STRING" }
                  },
                  required: ["path", "content"]
                }
              }
            },
            required: ["message", "fileUpdates"]
          }
        })
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to fetch response");
      }

      // Process rotation logs & failovers
      if (data.logs) {
        processServerRotationLogs(data.logs, data.keyStatuses);
      }
      if (typeof data.finalActiveKeyIndex === "number") {
        if (credentials.mode === "system") {
          const sysIdx = apiKeys.findIndex((k) => k.isSystemDefault);
          if (sysIdx >= 0) setActiveKeyIndex(sysIdx);
        } else {
          const customKeys = apiKeys.filter((k) => !k.isSystemDefault);
          const selectedCustomKey = customKeys[data.finalActiveKeyIndex];
          if (selectedCustomKey) {
            const fullIdx = apiKeys.findIndex((k) => k.id === selectedCustomKey.id);
            if (fullIdx >= 0) setActiveKeyIndex(fullIdx);
          }
        }
      }

      // Parse JSON from text
      let textResponse = data.text || "";
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(textResponse);
      } catch (e) {
        // Fallback check if model didn't obey json strictly in body
        addSystemLog("Model response is not strict JSON. Trying to extract JSON payload...", "warn");
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedJson = JSON.parse(jsonMatch[0]);
          } catch (err) {
            // Unparsable
          }
        }
      }

      let chatContent = textResponse;
      if (parsedJson && parsedJson.message) {
        chatContent = parsedJson.message;
        
        // Apply file updates directly to Virtual Workspace files!
        if (parsedJson.fileUpdates && Array.isArray(parsedJson.fileUpdates)) {
          applyWorkspaceFileUpdates(parsedJson.fileUpdates);
        }
      }

      // Increment success stats
      setDiagnosticsStats((prev) => ({ ...prev, successfulRequests: prev.successfulRequests + 1 }));

      // Add to key request counter
      setApiKeys((prevKeys) =>
        prevKeys.map((k, idx) => (idx === data.finalActiveKeyIndex ? { ...k, requestCount: k.requestCount + 1 } : k))
      );

      // Append model message
      const botMsg: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: "model",
        content: chatContent,
        timestamp: new Date().toLocaleTimeString(),
        modelUsed: selectedModel,
        rotationLogs: data.logs
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      addSystemLog(`Agent operation failed: ${err.message}`, "error");
      setDiagnosticsStats((prev) => ({ ...prev, failedRequests: prev.failedRequests + 1 }));

      const errorBotMsg: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: "model",
        content: `❌ Request failed. All keys in the pool were tried but returned errors. Please check your API keys or quota configurations.\n\nDetails:\n${err.message}`,
        timestamp: new Date().toLocaleTimeString()
      };
      setMessages((prev) => [...prev, errorBotMsg]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Helper: Apply the files output by the Agent into the Virtual Workspace
  const applyWorkspaceFileUpdates = (updates: { path: string; content: string }[]) => {
    if (updates.length === 0) return;

    setFiles((prevFiles) => {
      let nextFiles = [...prevFiles];
      updates.forEach((update) => {
        const ext = update.path.split(".").pop() || "txt";
        const matchedIdx = nextFiles.findIndex((f) => f.path === update.path);
        
        if (matchedIdx >= 0) {
          nextFiles[matchedIdx] = {
            path: update.path,
            content: update.content,
            language: ext
          };
          addSystemLog(`Updated file: ${update.path}`, "success");
        } else {
          nextFiles.push({
            path: update.path,
            content: update.content,
            language: ext
          });
          addSystemLog(`Created new file: ${update.path}`, "success");
        }
      });
      return nextFiles;
    });

    // Select the first updated file automatically
    if (updates[0]) {
      setSelectedFilePath(updates[0].path);
    }
  };

  // Quick Action triggers
  const handleQuickAction = (actionType: "explain" | "optimize" | "test" | "refactor") => {
    const currentFile = files.find((f) => f.path === selectedFilePath);
    if (!currentFile) {
      addSystemLog("Select a file first before invoking actions", "warn");
      return;
    }

    let actionPrompt = "";
    if (actionType === "explain") {
      actionPrompt = `Please review and provide a detailed architectural walkthrough of my code in the file \`${currentFile.path}\`.\n\nCode snippet:\n\`\`\`${currentFile.language}\n${currentFile.content}\n\`\`\``;
    } else if (actionType === "optimize") {
      actionPrompt = `Optimize the performance, layout, or efficiency of the code in \`${currentFile.path}\`. Correct potential flaws, redundancies, or poorly aligned containers, and write back the optimal file with comments.\n\nCode snippet:\n\`\`\`${currentFile.language}\n${currentFile.content}\n\`\`\``;
    } else if (actionType === "test") {
      actionPrompt = `Write complete test scenarios, interactive console assertions, or debugging mocks to check the features of \`${currentFile.path}\`.\n\nCode snippet:\n\`\`\`${currentFile.language}\n${currentFile.content}\n\`\`\``;
    } else if (actionType === "refactor") {
      actionPrompt = `Refactor the styles or elements of the file \`${currentFile.path}\` to make it look even more professional, beautiful, and accessible. Add Tailwind classes or transition effects where needed.`;
    }

    handleSendPrompt(actionPrompt);
  };

  // Generate high-resolution visual assets using the Image Lab (Gemini-3-pro-image or Flash-Image)
  const handleGenerateImage = async () => {
    if (!imagePrompt.trim() || isGeneratingImage) return;

    setIsGeneratingImage(true);
    addSystemLog(`Invoking Image Lab (${imageModel}) for prompt: "${imagePrompt}"...`);

    // Build credentials selection payload
    const activeKey = apiKeys[activeKeyIndex];
    let credentials;
    if (!activeKey || activeKey.isSystemDefault) {
      credentials = { mode: "system" as const };
    } else {
      const customKeys = apiKeys.filter((k) => !k.isSystemDefault);
      const customActiveIndex = customKeys.findIndex((k) => k.id === activeKey.id);
      credentials = {
        mode: "byok" as const,
        keyIds: customKeys.map((k) => k.id),
        activeKeyIndex: customActiveIndex >= 0 ? customActiveIndex : 0,
      };
    }

    try {
      setDiagnosticsStats((prev) => ({ ...prev, totalRequests: prev.totalRequests + 1 }));

      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          prompt: imagePrompt,
          credentials,
          imageSize,
          aspectRatio: imageAspect,
          model: imageModel
        })
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to generate image assets.");
      }

      // Process rotation logs
      if (data.logs) {
        processServerRotationLogs(data.logs, data.keyStatuses);
      }
      if (typeof data.finalActiveKeyIndex === "number") {
        if (credentials.mode === "system") {
          const sysIdx = apiKeys.findIndex((k) => k.isSystemDefault);
          if (sysIdx >= 0) setActiveKeyIndex(sysIdx);
        } else {
          const customKeys = apiKeys.filter((k) => !k.isSystemDefault);
          const selectedCustomKey = customKeys[data.finalActiveKeyIndex];
          if (selectedCustomKey) {
            const fullIdx = apiKeys.findIndex((k) => k.id === selectedCustomKey.id);
            if (fullIdx >= 0) setActiveKeyIndex(fullIdx);
          }
        }
      }

      const newImage: GeneratedImage = {
        id: Math.random().toString(36).substring(7),
        prompt: imagePrompt,
        imageUrl: data.imageUrl,
        size: imageSize,
        aspectRatio: imageAspect,
        timestamp: new Date().toLocaleTimeString(),
        rotationLogs: data.logs
      };

      setGeneratedImages((prev) => [newImage, ...prev]);
      setImagePrompt("");
      addSystemLog(`Successfully generated visual asset image!`, "success");
      setDiagnosticsStats((prev) => ({ ...prev, successfulRequests: prev.successfulRequests + 1 }));
    } catch (err: any) {
      addSystemLog(`Image generation failed: ${err.message}`, "error");
      setDiagnosticsStats((prev) => ({ ...prev, failedRequests: prev.failedRequests + 1 }));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Insert Generated Image into Sandbox HTML workspace
  const handleInsertImageToWorkspace = (img: GeneratedImage) => {
    setFiles((prevFiles) => {
      return prevFiles.map((f) => {
        if (f.path === "index.html") {
          // Find end of card or body and inject image before it
          let updatedContent = f.content;
          const imageTag = `\n    <!-- Auto-Injected Visual Asset -->\n    <div class="mt-4 overflow-hidden rounded-xl border border-slate-800 shadow-lg group relative">\n      <img src="${img.imageUrl}" alt="${img.prompt}" class="w-full aspect-[${img.aspectRatio.replace(":", "/")}] object-cover transition duration-300 group-hover:scale-105" />\n      <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-center text-xs text-slate-300 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity">\n        ${img.prompt}\n      </div>\n    </div>\n`;
          
          if (updatedContent.includes("</div>\n\n  <script")) {
            updatedContent = updatedContent.replace("</div>\n\n  <script", `${imageTag}</div>\n\n  <script`);
          } else if (updatedContent.includes("</body>")) {
            updatedContent = updatedContent.replace("</body>", `${imageTag}</body>`);
          } else {
            updatedContent += imageTag;
          }

          addSystemLog(`Injected generated visual image into HTML container index.html`, "success");
          return { ...f, content: updatedContent };
        }
        return f;
      });
    });
    setSelectedFilePath("index.html");
  };

  // Manual code editor save
  const handleSaveEditor = () => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.path === selectedFilePath) {
          return { ...f, content: editorContent };
        }
        return f;
      })
    );
    setIsEditorDirty(false);
    addSystemLog(`Saved custom file: ${selectedFilePath}`, "success");
  };

  // File explorer functions
  const handleCreateFile = () => {
    if (!newFileName.trim()) return;

    // Check if duplicate path
    if (files.some((f) => f.path.toLowerCase() === newFileName.trim().toLowerCase())) {
      addSystemLog(`File already exists: ${newFileName}`, "warn");
      return;
    }

    const ext = newFileName.split(".").pop() || "txt";
    const newFile: VirtualFile = {
      path: newFileName.trim(),
      content: `// New file ${newFileName}\n`,
      language: ext
    };

    setFiles((prev) => [...prev, newFile]);
    setSelectedFilePath(newFile.path);
    setNewFileName("");
    setShowNewFileInput(false);
    addSystemLog(`Created virtual file: ${newFile.path}`, "success");
  };

  const handleDeleteFile = (path: string) => {
    if (path === "index.html") {
      addSystemLog("Cannot delete index.html! This is the entry point file of your workspace sandbox.", "error");
      return;
    }

    setFiles((prev) => prev.filter((f) => f.path !== path));
    if (selectedFilePath === path) {
      setSelectedFilePath("index.html");
    }
    addSystemLog(`Deleted file: ${path}`);
  };

  // Key stats helpers
  const getKeysActiveStats = () => {
    const ready = apiKeys.filter((k) => k.status === "Ready" || k.status === "Active").length;
    return `${ready} / ${apiKeys.length}`;
  };

  // Clean chat logs
  const clearChatLogs = () => {
    setMessages([
      {
        id: "welcome",
        role: "model",
        content: "Chat logs cleared. Workspace files are preserved. Ask me anything to build!",
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
  };

  return (
    <div className="h-screen bg-[#0A0A0B] text-[#D1D1D1] flex flex-col font-sans overflow-hidden border border-[#2D2D2D]" id="aegis-root">
      {/* HEADER SECTION */}
      <header className="h-12 border-b border-[#2D2D2D] bg-[#141415] flex items-center justify-between px-4 shrink-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
          <span className="font-bold tracking-tight text-white font-mono">AEGIS</span>
          <span className="text-[10px] bg-[#2D2D2D] px-2 py-0.5 rounded text-slate-400 font-mono">
            FAILOVER_ACTIVE
          </span>
        </div>

        {/* Global stats bar */}
        <div className="flex items-center gap-6 text-[11px] font-mono">
          <div className="flex flex-col items-end">
            <span className="text-slate-500 uppercase text-[9px] font-bold">Key Pool Status</span>
            <span className="text-emerald-400 font-bold">{getKeysActiveStats()} Active</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-slate-500 uppercase text-[9px] font-bold">Rotations</span>
            <span className="text-white font-bold">{diagnosticsStats.rotationsCount}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-slate-500 uppercase text-[9px] font-bold">Success Rate</span>
            <span className="text-purple-400 font-bold">
              {diagnosticsStats.totalRequests > 0
                ? `${Math.round((diagnosticsStats.successfulRequests / diagnosticsStats.totalRequests) * 100)}%`
                : "100%"}
            </span>
          </div>
        </div>
      </header>

      {/* DASHBOARD WORKSPACE */}
      <main className="flex-1 flex overflow-hidden h-[calc(100vh-48px)] bg-[#0F0F10]">
        
        {/* LEFT COLUMN: KEY POOL & REALTIME ROTATION FEED */}
        <aside className="w-80 border-r border-[#2D2D2D] bg-[#111112] flex flex-col shrink-0 overflow-y-auto h-full p-3 gap-3">
          
          {/* Key Pool Module */}
          <div className="bg-[#141415] rounded border border-[#2D2D2D] flex flex-col p-3 gap-2.5">
            <div className="flex items-center justify-between border-b border-[#2D2D2D] pb-1.5">
              <div className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">Gemini API Key Pool</h2>
              </div>
              <span className="text-[9px] font-mono text-slate-400 bg-[#2D2D2D] px-1.5 py-0.5 rounded uppercase">
                Auto-Rotate: ON
              </span>
            </div>

            {/* Custom key list */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {apiKeys.length === 0 ? (
                <div className="text-center py-4 text-slate-500 text-xs flex flex-col items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500/60" />
                  No API keys in pool.
                  <br />Please input your Gemini API keys below.
                </div>
              ) : (
                apiKeys.map((k, index) => {
                  const isActive = index === activeKeyIndex;
                  return (
                    <div
                      key={k.id}
                      className={`p-2 rounded border transition-all duration-200 text-xs flex flex-col gap-1.5 ${
                        isActive
                          ? "bg-[#1A1A1C] border-emerald-500/30 ring-1 ring-emerald-500/20"
                          : "bg-[#1A1A1C] border-[#2D2D2D] hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0 font-mono">
                          <div
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              isActive
                                ? "bg-emerald-500 animate-pulse"
                                : k.status === "Ready"
                                ? "bg-emerald-400"
                                : k.status.startsWith("Rate Limited")
                                ? "bg-amber-400"
                                : "bg-rose-500"
                            }`}
                          />
                          <span className="text-white truncate font-semibold text-[11px]">{k.label}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleValidateKey(k.id, k.key)}
                            disabled={validatingKeyId === k.id}
                            className="p-1 hover:bg-[#2D2D2D] rounded text-slate-400 hover:text-white transition-colors"
                            title="Test connection"
                          >
                            <RefreshCw className={`w-3 h-3 ${validatingKeyId === k.id ? "animate-spin text-emerald-400" : ""}`} />
                          </button>
                          {!k.isSystemDefault && (
                            <button
                              onClick={() => handleDeleteKey(k.id)}
                              className="p-1 hover:bg-rose-950/30 rounded text-slate-500 hover:text-rose-400 transition-colors"
                              title="Delete key"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between font-mono text-[9px] text-slate-500">
                        <span className="truncate max-w-[120px] bg-[#0A0A0B] px-1.5 py-0.5 rounded text-slate-400">
                          {k.isSystemDefault ? k.key : `${k.key.substring(0, 8)}...${k.key.substring(k.key.length - 4)}`}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-bold ${
                            isActive || k.status === "Active"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : k.status === "Ready"
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : k.status.startsWith("Rate Limited")
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {isActive ? "ACTIVE" : k.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input field to add custom key */}
            <div className="space-y-2 pt-2 border-t border-[#2D2D2D]">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Key Name"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  className="w-full bg-[#0A0A0B] border border-[#2D2D2D] rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-slate-500 font-mono transition-colors"
                />
                <button
                  onClick={handleAddKey}
                  disabled={!newKeyInput.trim()}
                  className="w-full bg-white hover:bg-slate-200 disabled:bg-slate-800 disabled:text-slate-600 text-black font-bold text-[11px] py-1 px-2 rounded flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Add Key
                </button>
              </div>
              <input
                type="password"
                placeholder="Paste API Key (AIzaSy...)"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                className="w-full bg-[#0A0A0B] border border-[#2D2D2D] rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-slate-500 font-mono transition-colors"
              />
              <p className="text-[9px] text-slate-500 leading-normal font-mono">
                Stored locally inside your browser cache.
              </p>
            </div>
          </div>

          {/* Scrolling Terminal Key Rotation Log */}
          <div className="flex-1 bg-[#141415] rounded border border-[#2D2D2D] flex flex-col p-3 gap-2 overflow-hidden min-h-[160px]">
            <div className="flex items-center justify-between border-b border-[#2D2D2D] pb-1.5">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Rotation Activity</h3>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            </div>

            <div className="flex-1 bg-[#050505] rounded p-2 border border-[#2D2D2D] font-mono text-[10px] overflow-y-auto flex flex-col gap-1.5 leading-relaxed">
              {rotationLogs.length === 0 ? (
                <div className="text-slate-600 italic text-center py-6 font-mono text-[10px]">
                  No rotation occurrences recorded yet. Waiting...
                </div>
              ) : (
                rotationLogs.map((log) => {
                  let colorClass = "text-slate-400";
                  if (log.type === "success") colorClass = "text-emerald-400 font-semibold";
                  if (log.type === "warn") colorClass = "text-amber-400 font-semibold";
                  if (log.type === "error") colorClass = "text-rose-400 font-bold";

                  return (
                    <div key={log.id} className="border-b border-[#2D2D2D]/40 pb-1 flex gap-2 items-start">
                      <span className="text-slate-600 text-[9px] flex-shrink-0">{log.timestamp}</span>
                      <span className={colorClass}>{log.message}</span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </aside>

        {/* RIGHT COLUMN: MAIN CONTENT INTERFACE (DYNAMIC TABS) */}
        <section className="flex-1 flex flex-col h-full overflow-hidden bg-[#0F0F10]">
          
          {/* Top Panel Nav Bars */}
          <div className="h-10 border-b border-[#2D2D2D] bg-[#141415] px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 h-full">
              <button
                onClick={() => setActiveTab("agent")}
                className={`flex items-center gap-2 px-3 text-[11px] font-mono font-bold tracking-wide transition-all border-b-2 h-full ${
                  activeTab === "agent"
                    ? "border-emerald-500 text-white bg-[#1A1A1C]/60"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <Code className="w-3.5 h-3.5 text-emerald-400" />
                CODING_SUITE
              </button>
              <button
                onClick={() => setActiveTab("images")}
                className={`flex items-center gap-2 px-3 text-[11px] font-mono font-bold tracking-wide transition-all border-b-2 h-full ${
                  activeTab === "images"
                    ? "border-emerald-500 text-white bg-[#1A1A1C]/60"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                IMAGE_LAB
              </button>
              <button
                onClick={() => setActiveTab("diagnostics")}
                className={`flex items-center gap-2 px-3 text-[11px] font-mono font-bold tracking-wide transition-all border-b-2 h-full ${
                  activeTab === "diagnostics"
                    ? "border-emerald-500 text-white bg-[#1A1A1C]/60"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-purple-400" />
                DIAGNOSTICS
              </button>
            </div>

            {/* Model & Temperature configurations */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-[#0A0A0B] px-2 py-1 rounded border border-[#2D2D2D]">
                <Sliders className="w-3 h-3 text-emerald-400" />
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase">Engine:</span>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value as ModelType)}
                  className="bg-transparent text-[9px] font-mono text-slate-200 focus:outline-hidden font-bold cursor-pointer uppercase"
                >
                  <option value="gemini-3.1-pro-preview" className="bg-slate-950 text-slate-200">
                    Pro (3.1-Pro)
                  </option>
                  <option value="gemini-3.5-flash" className="bg-slate-950 text-slate-200">
                    General (3.5-Flash)
                  </option>
                  <option value="gemini-3.1-flash-lite" className="bg-slate-950 text-slate-200">
                    Fast (3.1-Lite)
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* TAB CONTENTS CONTAINER */}
          <div className="flex-1 overflow-hidden relative bg-[#0F0F10]">
            <AnimatePresence mode="wait">
              
              {/* TAB 1: CODING AGENT WORKSPACE (Split view) */}
              {activeTab === "agent" && (
                <motion.div
                  key="agent-tab"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="h-full grid grid-cols-1 lg:grid-cols-12 overflow-hidden bg-[#0F0F10]"
                >
                  {/* SPLIT 1: Left column - Agent Chat Screen */}
                  <div className="lg:col-span-4 border-r border-[#2D2D2D] flex flex-col h-full bg-[#111112] overflow-hidden">
                    
                    {/* Persona Selector Row */}
                    <div className="p-3 border-b border-[#2D2D2D] bg-[#141415] flex flex-col gap-2">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                        Select Agent Cognitive Node
                      </label>
                      <div className="grid grid-cols-4 gap-1">
                        {AGENT_ROLES.map((role) => {
                          const isSelected = role.id === activeRole.id;
                          return (
                            <button
                              key={role.id}
                              onClick={() => {
                                setActiveRole(role);
                                addSystemLog(`Switched Coding Agent role to: ${role.name}`);
                              }}
                              className={`py-1 px-0.5 rounded border flex flex-col items-center justify-center gap-1 transition-all ${
                                isSelected
                                  ? "bg-[#1A1A1C] border-emerald-500/40 text-emerald-400 font-bold"
                                  : "bg-[#0A0A0B] border-[#2D2D2D] text-slate-450 hover:text-white"
                              }`}
                              title={role.description}
                            >
                              {role.id === "fullstack" && <Cpu className="w-3.5 h-3.5" />}
                              {role.id === "wizard" && <Sparkles className="w-3.5 h-3.5" />}
                              {role.id === "debugger" && <Wrench className="w-3.5 h-3.5" />}
                              {role.id === "auditor" && <ShieldAlert className="w-3.5 h-3.5" />}
                              <span className="text-[9px] font-mono uppercase tracking-tight text-center leading-tight truncate max-w-full">
                                {role.name.split(" ").pop()}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Scrollable messages container */}
                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-[#0F0F10]">
                      {messages.map((m) => {
                        const isUser = m.role === "user";
                        return (
                          <div
                            key={m.id}
                            className={`flex gap-2 max-w-[90%] ${
                              isUser ? "ml-auto flex-row-reverse" : "mr-auto"
                            }`}
                          >
                            <div
                              className={`w-6 h-6 rounded flex items-center justify-center border flex-shrink-0 ${
                                isUser
                                  ? "bg-[#1A1A1C] border-[#2D2D2D] text-slate-400"
                                  : "bg-[#1A1A1C] border-emerald-500/20 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                              }`}
                            >
                              {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                            </div>

                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2 text-[9px] text-slate-500 font-mono uppercase font-bold">
                                <span className={isUser ? "text-slate-400" : "text-emerald-500"}>
                                  {isUser ? "USER" : activeRole.id.toUpperCase()}
                                </span>
                                <span>{m.timestamp}</span>
                                {!isUser && m.modelUsed && (
                                  <span className="bg-[#1A1A1C] px-1 py-0.5 rounded text-[8px] text-slate-400 font-mono">
                                    {m.modelUsed}
                                  </span>
                                )}
                              </div>

                              <div
                                className={`p-2.5 rounded border text-[11px] font-mono leading-relaxed break-words ${
                                  isUser
                                    ? "bg-[#1A1A1C] border-[#2D2D2D] text-slate-100"
                                    : "bg-[#050505] border-[#2D2D2D] text-slate-300"
                                }`}
                              >
                                {m.content.split("\n").map((line, lIdx) => (
                                  <p key={lIdx} className={line.trim() === "" ? "h-2" : "mb-1"}>
                                    {line}
                                  </p>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Suggested triggers prompt bar */}
                    <div className="px-3 py-1.5 border-t border-[#2D2D2D]/50 bg-[#141415] shrink-0">
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                        <span className="text-[9px] font-mono font-bold text-slate-500 uppercase flex-shrink-0">
                          QUICK_INPUTS:
                        </span>
                        {activeRole.suggestedPrompts.map((p, idx) => (
                          <button
                            key={idx}
                            onClick={() => setUserInput(p)}
                            className="bg-[#0A0A0B] hover:bg-[#1A1A1C] text-slate-455 hover:text-white border border-[#2D2D2D] transition-all text-[9px] px-2 py-0.5 rounded cursor-pointer font-mono uppercase"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Chat Prompt input */}
                    <div className="p-3 border-t border-[#2D2D2D] bg-[#141415] shrink-0">
                      <div className="flex gap-2 relative items-center">
                        <input
                          type="text"
                          placeholder={`Instruct ${activeRole.name.toUpperCase()}...`}
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSendPrompt()}
                          disabled={isGenerating}
                          className="w-full bg-[#0A0A0B] border border-[#2D2D2D] focus:border-emerald-500 text-slate-100 placeholder-slate-600 rounded px-3 py-2 text-[11px] pr-10 focus:outline-hidden font-mono transition-all"
                        />
                        <button
                          onClick={() => handleSendPrompt()}
                          disabled={!userInput.trim() || isGenerating}
                          className="absolute right-1.5 p-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-[#1A1A1C] disabled:text-slate-600 text-white rounded transition-colors cursor-pointer"
                        >
                          {isGenerating ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-1.5 text-[9px] text-slate-500 font-mono uppercase font-bold">
                        <span>LTM Context and Key Vault sync ready.</span>
                        <button onClick={clearChatLogs} className="hover:text-slate-350 flex items-center gap-1 cursor-pointer">
                          <Trash2 className="w-2.5 h-2.5" /> CLEAR_LOGS
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SPLIT 2: Middle column - Virtual workspace explorer & editor */}
                  <div className="lg:col-span-5 border-r border-[#2D2D2D] flex flex-col h-full bg-[#0F0F10] overflow-hidden">
                    
                    {/* Files tab */}
                    <div className="p-2 border-b border-[#2D2D2D] bg-[#141415] flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Folder className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[10px] font-bold font-mono text-slate-400 uppercase tracking-widest">WORKSPACE_FILES</span>
                      </div>
                      <button
                        onClick={() => setShowNewFileInput(!showNewFileInput)}
                        className="p-1 hover:bg-[#2D2D2D] rounded text-slate-400 hover:text-white transition-all cursor-pointer"
                        title="New File"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* File creation input dialog */}
                    {showNewFileInput && (
                      <div className="p-2 border-b border-[#2D2D2D] bg-[#1A1A1C] flex gap-2 shrink-0">
                        <input
                          type="text"
                          placeholder="filename.ext"
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleCreateFile()}
                          className="flex-1 bg-[#0A0A0B] border border-[#2D2D2D] rounded px-2 py-0.5 text-[11px] font-mono text-slate-200 focus:outline-hidden focus:border-emerald-500"
                        />
                        <button
                          onClick={handleCreateFile}
                          className="bg-emerald-600 hover:bg-emerald-500 px-2 py-0.5 text-white text-[10px] font-bold font-mono rounded"
                        >
                          CREATE
                        </button>
                        <button
                          onClick={() => setShowNewFileInput(false)}
                          className="p-1 text-slate-400 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* File tab headers */}
                    <div className="flex items-center gap-1 overflow-x-auto bg-[#141415] px-2 border-b border-[#2D2D2D] shrink-0">
                      {files.map((file) => {
                        const isSelected = file.path === selectedFilePath;
                        return (
                          <div
                            key={file.path}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono font-bold transition-all border-b-2 cursor-pointer ${
                              isSelected
                                ? "border-emerald-500 text-white bg-[#0A0A0B]"
                                : "border-transparent text-slate-500 hover:text-slate-300"
                            }`}
                            onClick={() => {
                              if (isEditorDirty) {
                                if (confirm("You have unsaved changes in your editor. Discard changes?")) {
                                  setSelectedFilePath(file.path);
                                }
                              } else {
                                setSelectedFilePath(file.path);
                              }
                            }}
                          >
                            <FileCode className="w-3 h-3 flex-shrink-0 text-slate-455" />
                            <span>{file.path}</span>
                            {file.path !== "index.html" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteFile(file.path);
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Live Editor */}
                    <div className="flex-1 flex flex-col bg-[#050505] relative overflow-hidden">
                      <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
                        {isEditorDirty && (
                          <button
                            onClick={handleSaveEditor}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold font-mono px-2 py-1.5 rounded flex items-center gap-1 shadow-md cursor-pointer uppercase border border-emerald-400/20"
                          >
                            <Check className="w-3.5 h-3.5" /> SAVE FILES
                          </button>
                        )}
                      </div>

                      <div className="flex-1 flex font-mono text-xs overflow-hidden h-full">
                        {/* Line number rail simulator */}
                        <div className="w-8 bg-[#0A0A0B] border-r border-[#2D2D2D] select-none text-right pr-2 py-3 text-[10px] text-slate-650 flex flex-col gap-0.5 leading-tight">
                          {Array.from({ length: editorContent.split("\n").length }).map((_, i) => (
                            <span key={i}>{i + 1}</span>
                          ))}
                        </div>

                        {/* Interactive Editor content */}
                        <textarea
                          value={editorContent}
                          onChange={(e) => {
                            setEditorContent(e.target.value);
                            setIsEditorDirty(true);
                          }}
                          placeholder="// Edit local system files here..."
                          className="flex-1 bg-[#050505] text-slate-300 p-3 focus:outline-hidden leading-tight font-mono text-[11px] resize-none h-full overflow-y-auto whitespace-pre selection:bg-emerald-500/20"
                        />
                      </div>
                    </div>

                    {/* Quick action command dock */}
                    <div className="p-2.5 border-t border-[#2D2D2D] bg-[#141415] flex flex-col gap-1.5 shrink-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-slate-500 font-mono tracking-widest uppercase">AGENT SHORTCUT COGNITIVE ACTIONS</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        <button
                          onClick={() => handleQuickAction("explain")}
                          className="py-1 bg-[#0A0A0B] hover:bg-emerald-500/10 hover:text-emerald-400 border border-[#2D2D2D] hover:border-emerald-500/30 text-slate-400 font-mono font-bold text-[9px] rounded transition-colors cursor-pointer uppercase"
                        >
                          EXPLAIN
                        </button>
                        <button
                          onClick={() => handleQuickAction("optimize")}
                          className="py-1 bg-[#0A0A0B] hover:bg-emerald-500/10 hover:text-emerald-400 border border-[#2D2D2D] hover:border-emerald-500/30 text-slate-400 font-mono font-bold text-[9px] rounded transition-colors cursor-pointer uppercase"
                        >
                          OPTIMIZE
                        </button>
                        <button
                          onClick={() => handleQuickAction("test")}
                          className="py-1 bg-[#0A0A0B] hover:bg-emerald-500/10 hover:text-emerald-400 border border-[#2D2D2D] hover:border-emerald-500/30 text-slate-400 font-mono font-bold text-[9px] rounded transition-colors cursor-pointer uppercase"
                        >
                          TEST
                        </button>
                        <button
                          onClick={() => handleQuickAction("refactor")}
                          className="py-1 bg-[#0A0A0B] hover:bg-emerald-500/10 hover:text-emerald-400 border border-[#2D2D2D] hover:border-emerald-500/30 text-slate-400 font-mono font-bold text-[9px] rounded transition-colors cursor-pointer uppercase"
                        >
                          POLISH
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SPLIT 3: Right column - Sandbox terminal & compiler */}
                  <div className="lg:col-span-3 flex flex-col h-full bg-[#111112] overflow-hidden">
                    
                    {/* Run compiler header */}
                    <div className="p-2 border-b border-[#2D2D2D] bg-[#141415] flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Play className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[10px] font-bold font-mono text-slate-400 uppercase tracking-widest">SANDBOX_COMPILER</span>
                      </div>
                      <button
                        onClick={runSandbox}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-[9px] font-bold font-mono rounded flex items-center gap-1 tracking-wide cursor-pointer border border-emerald-400/20"
                      >
                        <Play className="w-2.5 h-2.5 fill-white" /> BUILD
                      </button>
                    </div>

                    {/* Compile view - Render container */}
                    <div className="flex-1 bg-[#050505] flex flex-col border-b border-[#2D2D2D] relative overflow-hidden min-h-[140px]">
                      {sandboxSrc ? (
                        <iframe
                          src={sandboxSrc}
                          className="w-full h-full bg-[#050505] border-0"
                          sandbox="allow-scripts"
                          title="Sandbox compiled view"
                        />
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-slate-500 gap-2">
                          <Eye className="w-6 h-6 text-slate-700 animate-pulse" />
                          <div className="space-y-1">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Sandbox Dormant</h4>
                            <p className="text-[9px] text-slate-500 leading-normal max-w-xs font-mono">
                              Click <span className="text-emerald-400 font-bold">BUILD</span> above to render code.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Integrated sandbox logs console */}
                    <div className="h-[180px] bg-[#0F0F10] flex flex-col overflow-hidden border-t border-[#2D2D2D] shrink-0">
                      <div className="bg-[#141415] px-2.5 py-1 border-b border-[#2D2D2D] flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-1.5">
                          <Terminal className="w-3 h-3 text-emerald-400" />
                          <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                            Sandbox Console Log
                          </span>
                        </div>
                        <button
                          onClick={() => setSandboxConsole(["Console buffer cleared."])}
                          className="text-[9px] text-slate-500 hover:text-slate-300 font-mono uppercase font-bold"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="flex-1 p-2 font-mono text-[9px] leading-snug text-slate-300 overflow-y-auto flex flex-col gap-0.5 select-text bg-[#050505] border border-[#2D2D2D] rounded-b m-1.5">
                        {sandboxConsole.map((log, idx) => {
                          let lineClass = "text-slate-400";
                          if (log.includes("[ERROR]")) lineClass = "text-rose-455 font-semibold";
                          if (log.includes("[WARN]")) lineClass = "text-amber-400";
                          if (log.includes("success")) lineClass = "text-emerald-400";

                          return (
                            <div key={idx} className={`${lineClass} leading-tight`}>
                              {log}
                            </div>
                          );
                        })}
                        <div ref={terminalEndRef} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 2: HIGH RES IMAGE LAB */}
              {activeTab === "images" && (
                <motion.div
                  key="images-tab"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="h-full grid grid-cols-1 lg:grid-cols-12 overflow-hidden bg-[#0F0F10]"
                >
                  {/* Image Generation inputs */}
                  <div className="lg:col-span-4 border-r border-[#2D2D2D] p-4 flex flex-col gap-4 overflow-y-auto bg-[#111112]">
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" /> IMAGE_LAB_GENERATOR
                      </h3>
                      <p className="text-[11px] text-slate-400 leading-normal">
                        Construct assets using Gemini's high-fidelity image suite. Automatically inject raw base64 graphics straight into your active code.
                      </p>
                    </div>

                    {/* Prompt input */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                        Describe Asset Prompt
                      </label>
                      <textarea
                        rows={4}
                        placeholder="e.g. A futuristic glass neon key icon, black background, 3D render..."
                        value={imagePrompt}
                        onChange={(e) => setImagePrompt(e.target.value)}
                        className="w-full bg-[#0A0A0B] border border-[#2D2D2D] focus:border-emerald-500 rounded p-2.5 text-[11px] font-mono text-slate-100 placeholder-slate-600 focus:outline-hidden transition-all resize-none leading-normal"
                      />
                    </div>

                    {/* Advanced parameters */}
                    <div className="space-y-3 pt-2.5 border-t border-[#2D2D2D]">
                      
                      {/* Model Selector */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          Image Engine
                        </label>
                        <select
                          value={imageModel}
                          onChange={(e) => setImageModel(e.target.value)}
                          className="w-full bg-[#0A0A0B] border border-[#2D2D2D] text-[11px] font-mono rounded p-2 focus:outline-hidden text-slate-200 uppercase font-bold"
                        >
                          <option value="gemini-3.1-flash-image">gemini-3.1-flash-image</option>
                          <option value="gemini-3-pro-image">gemini-3-pro-image (PRO)</option>
                        </select>
                      </div>

                      {/* Size selections */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono flex justify-between">
                          <span>Output Resolution Size</span>
                          <span className="text-[8px] text-emerald-400 font-mono">PAID KEY REQUIRED FOR 2K/4K</span>
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(["1K", "2K", "4K"] as const).map((sz) => (
                            <button
                              key={sz}
                              type="button"
                              onClick={() => setImageSize(sz)}
                              className={`py-1.5 px-2 rounded border text-[10px] font-mono font-bold transition-all cursor-pointer ${
                                imageSize === sz
                                  ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                  : "bg-[#0A0A0B] border-[#2D2D2D] text-slate-400 hover:border-slate-800"
                              }`}
                            >
                              {sz}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Aspect ratios selector */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          Aspect Ratio Matrix
                        </label>
                        <div className="grid grid-cols-5 gap-1.5">
                          {(["1:1", "16:9", "9:16", "4:3", "3:4"] as const).map((asp) => (
                            <button
                              key={asp}
                              type="button"
                              onClick={() => setImageAspect(asp)}
                              className={`py-1 text-[10px] font-mono font-bold rounded border transition-all cursor-pointer ${
                                imageAspect === asp
                                  ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                  : "bg-[#0A0A0B] border-[#2D2D2D] text-slate-400 hover:border-slate-800"
                              }`}
                            >
                              {asp}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleGenerateImage}
                      disabled={!imagePrompt.trim() || isGeneratingImage}
                      className="w-full mt-2 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:pointer-events-none text-white font-bold text-xs rounded flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer border border-emerald-400/20 font-mono uppercase"
                    >
                      {isGeneratingImage ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>FUSING ASSET CHUNKS...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>GENERATE GRAPHIC</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Generated Gallery Showcase */}
                  <div className="lg:col-span-8 p-4 overflow-y-auto flex flex-col gap-4 bg-[#0F0F10]">
                    <div className="flex items-center justify-between border-b border-[#2D2D2D] pb-2">
                      <div>
                        <h4 className="font-bold text-xs text-white font-mono uppercase tracking-wide">Visual Assets Gallery</h4>
                        <p className="text-[10px] text-slate-500 font-mono">Your generated images in this workspace</p>
                      </div>
                      <span className="text-[10px] text-slate-550 font-mono font-bold">
                        {generatedImages.length} ITEMS
                      </span>
                    </div>

                    {generatedImages.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-slate-500 gap-2">
                        <ImageIcon className="w-8 h-8 text-slate-800 animate-pulse" />
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wide">Gallery is Empty</h4>
                          <p className="text-[10px] text-slate-500 leading-normal max-w-xs font-mono">
                            No visual assets created yet. Submit a prompt inside the builder rail to compile a graphic card.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {generatedImages.map((img) => (
                          <div
                            key={img.id}
                            className="bg-[#1A1A1C] rounded border border-[#2D2D2D] overflow-hidden flex flex-col group transition-all hover:border-emerald-500/30"
                          >
                            <div className="relative overflow-hidden aspect-video bg-[#050505]">
                              <img
                                src={img.imageUrl}
                                alt={img.prompt}
                                className="w-full h-full object-cover transition duration-300 group-hover:scale-102"
                              />
                              <div className="absolute top-2 right-2 flex gap-1.5">
                                <span className="bg-[#050505]/90 px-1.5 py-0.5 rounded text-[8px] font-mono text-emerald-400 border border-emerald-500/20">
                                  {img.size}
                                </span>
                                <span className="bg-[#050505]/90 px-1.5 py-0.5 rounded text-[8px] font-mono text-blue-400 border border-blue-500/20">
                                  {img.aspectRatio}
                                </span>
                              </div>
                            </div>

                            <div className="p-3 flex-1 flex flex-col gap-2">
                              <p className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed flex-1 font-mono">
                                "{img.prompt}"
                              </p>
                              
                              <div className="flex items-center gap-2 pt-2 border-t border-[#2D2D2D]/60">
                                <button
                                  onClick={() => handleInsertImageToWorkspace(img)}
                                  className="flex-1 py-1.5 px-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-white border border-emerald-500/20 hover:border-emerald-500/40 font-bold text-[10px] rounded flex items-center justify-center gap-1 transition-all cursor-pointer font-mono uppercase"
                                >
                                  <PlusCircle className="w-3.5 h-3.5" /> Inject Into HTML Code
                                </button>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(img.imageUrl);
                                    addSystemLog("Copied image base64 link to clipboard!", "success");
                                  }}
                                  className="p-1.5 bg-[#0A0A0B] hover:bg-slate-800 border border-[#2D2D2D] rounded text-slate-400 hover:text-white transition-all cursor-pointer"
                                  title="Copy raw base64 data url"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* TAB 3: DIAGNOSTICS & ANALYTICS */}
              {activeTab === "diagnostics" && (
                <motion.div
                  key="diagnostics-tab"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="h-full p-4 overflow-y-auto bg-[#0F0F10]"
                >
                  <div className="max-w-4xl mx-auto space-y-4">
                    <div>
                      <h3 className="text-xs font-bold text-white flex items-center gap-2 font-mono uppercase tracking-widest">
                        <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> SYSTEM_METRICS_FAILOVER_DIAGNOSTICS
                      </h3>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Inspect failover statistics, request distribution metrics, and live error recovery health indexes.
                      </p>
                    </div>

                    {/* Stats summary boxes */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <div className="bg-[#141415] p-3 rounded border border-[#2D2D2D] flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-slate-550 uppercase tracking-wider font-mono">
                          Cumulative Requests
                        </span>
                        <span className="text-lg font-bold text-white font-mono">{diagnosticsStats.totalRequests}</span>
                      </div>
                      <div className="bg-[#141415] p-3 rounded border border-[#2D2D2D] flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-slate-550 uppercase tracking-wider font-mono">
                          Success Operations
                        </span>
                        <span className="text-lg font-bold text-emerald-400 font-mono">
                          {diagnosticsStats.successfulRequests}
                        </span>
                      </div>
                      <div className="bg-[#141415] p-3 rounded border border-[#2D2D2D] flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-slate-550 uppercase tracking-wider font-mono">
                          Failed Operations
                        </span>
                        <span className="text-lg font-bold text-rose-400 font-mono">{diagnosticsStats.failedRequests}</span>
                      </div>
                      <div className="bg-[#141415] p-3 rounded border border-[#2D2D2D] flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-slate-550 uppercase tracking-wider font-mono">
                          Rotation Triggers
                        </span>
                        <span className="text-lg font-bold text-amber-400 font-mono">
                          {diagnosticsStats.rotationsCount}
                        </span>
                      </div>
                    </div>

                    {/* Keys Load balances */}
                    <div className="bg-[#141415] rounded border border-[#2D2D2D] p-3.5 space-y-3">
                      <h4 className="text-[10px] font-bold text-white font-mono uppercase tracking-wider">Key Pool Load Balancer Status</h4>
                      <div className="space-y-2.5">
                        {apiKeys.map((k, idx) => {
                          const isActive = idx === activeKeyIndex;
                          return (
                            <div key={k.id} className="flex flex-col gap-1">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-700"}`} />
                                  <span className="font-bold text-slate-200">{k.label}</span>
                                  {isActive && <span className="text-[9px] text-emerald-450 font-bold uppercase">(Active)</span>}
                                </div>
                                <div className="flex items-center gap-3 text-slate-450 text-[10px] font-bold">
                                  <span>REQ: {k.requestCount}</span>
                                  <span className="px-1 py-0.2 bg-[#050505] rounded text-slate-300 font-mono">{k.status.toUpperCase()}</span>
                                </div>
                              </div>
                              <div className="w-full h-1.5 bg-[#050505] rounded overflow-hidden">
                                <div
                                  className={`h-full rounded transition-all duration-300 ${isActive ? "bg-emerald-500" : "bg-[#2D2D2D]"}`}
                                  style={{
                                    width: `${
                                      diagnosticsStats.totalRequests > 0
                                        ? (k.requestCount / diagnosticsStats.totalRequests) * 100
                                        : 0
                                    }%`
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Raw System Log file */}
                    <div className="bg-[#141415] rounded border border-[#2D2D2D] p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between border-b border-[#2D2D2D]/60 pb-1.5">
                        <h4 className="text-[10px] font-bold text-white font-mono uppercase tracking-wider">Complete Diagnostics SysLog</h4>
                        <button
                          onClick={() => setSystemLogs([])}
                          className="text-[9px] font-bold font-mono text-slate-550 hover:text-slate-300 uppercase cursor-pointer"
                        >
                          Flush Logs
                        </button>
                      </div>

                      <div className="bg-[#050505] p-3 rounded border border-[#2D2D2D] font-mono text-[9px] text-slate-400 h-60 overflow-y-auto leading-normal select-text space-y-0.5">
                        {systemLogs.length === 0 ? (
                          <div className="text-slate-600 italic text-center py-16">System logs cleared.</div>
                        ) : (
                          systemLogs.map((log, idx) => (
                            <div key={idx} className="border-b border-[#2D2D2D]/20 pb-0.5">
                              {log}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </main>
    </div>
  );
}
