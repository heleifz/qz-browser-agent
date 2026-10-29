import { defineMessages } from "./i18n/definition.js";
import { createTranslator } from "./i18n/index.js";

export type JavaScriptDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export interface JavaScriptDialogForm {
  type: JavaScriptDialogType;
  message: string;
  defaultPrompt?: string;
}

export interface JavaScriptDialogResult {
  type: JavaScriptDialogType;
  message: string;
  accepted: boolean;
  promptText?: string;
}

export const javascriptDialogMessages = defineMessages("javascript-dialog", {
  title: { "zh-CN": "页面对话框", en: "Page dialog" },
  hint: {
    "zh-CN": "在侧栏选择如何处理该对话框，任务会继续执行。",
    en: "Choose how to handle this dialog in the sidebar to continue the task.",
  },
  ok: { "zh-CN": "确定", en: "OK" },
  cancel: { "zh-CN": "取消", en: "Cancel" },
  leave: { "zh-CN": "离开", en: "Leave" },
  stay: { "zh-CN": "留在此页", en: "Stay" },
  promptLabel: { "zh-CN": "输入", en: "Input" },
});

export const javascriptDialogT = createTranslator(javascriptDialogMessages);

export function normalizeJavaScriptDialogType(value: unknown): JavaScriptDialogType {
  const type = String(value || "").trim().toLowerCase();
  if (type === "confirm" || type === "prompt" || type === "beforeunload") return type;
  return "alert";
}

export function readJavaScriptDialogForm(form: Record<string, unknown> | null | undefined): JavaScriptDialogForm | null {
  const dialog = form?.javascriptDialog;
  if (!dialog || typeof dialog !== "object" || Array.isArray(dialog)) return null;
  const record = dialog as Record<string, unknown>;
  const message = String(record.message ?? "");
  const type = normalizeJavaScriptDialogType(record.type);
  const defaultPrompt = String(record.defaultPrompt ?? "");
  return { type, message, ...(defaultPrompt ? { defaultPrompt } : {}) };
}
