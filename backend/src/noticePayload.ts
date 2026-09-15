import type { NoticeCategory, NoticeDeliveryChannel, NoticeStatus } from "./store.js";

export const NOTICE_CATEGORIES = new Set<NoticeCategory>(["IMPORTANT", "MAINTENANCE", "FEATURE", "INFO"]);
export const NOTICE_STATUSES = new Set<NoticeStatus>(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const NOTICE_AUDIENCES = new Set(["ALL", "USER", "ADMIN"]);
export const NOTICE_CHANNELS = new Set<NoticeDeliveryChannel>(["KAKAO", "EMAIL", "SMS", "WEBPUSH", "INAPP"]);

export type NoticeMutationParse = { value: Record<string, unknown> } | { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseNoticeChannels(value: unknown): NoticeDeliveryChannel[] | null {
  if (!Array.isArray(value) || value.some((channel) => typeof channel !== "string" || !NOTICE_CHANNELS.has(channel as NoticeDeliveryChannel))) return null;
  return [...new Set(value as NoticeDeliveryChannel[])];
}

/** Validate and normalize the shared POST/PATCH administrator notice payload. */
export function parseNoticeMutationBody(rawBody: unknown, partial: boolean): NoticeMutationParse {
  if (!isRecord(rawBody)) return { error: "body must be an object" };
  const body = rawBody;
  const allowed = new Set(["category", "audience", "title", "body", "status", "notifyChannels", "notifyOnPublish"]);
  const keys = Object.keys(body);
  if (keys.some((key) => !allowed.has(key))) return { error: "unknown field" };
  if (partial && keys.length === 0) return { error: "at least one notice field is required" };
  if (!partial && (typeof body.category !== "string" || typeof body.audience !== "string" || typeof body.title !== "string" || typeof body.body !== "string")) {
    return { error: "category, audience, title and body are required" };
  }
  if (body.category !== undefined && (typeof body.category !== "string" || !NOTICE_CATEGORIES.has(body.category as NoticeCategory))) return { error: "invalid category" };
  if (body.audience !== undefined && (typeof body.audience !== "string" || !NOTICE_AUDIENCES.has(body.audience))) return { error: "invalid audience" };
  if (body.status !== undefined && (typeof body.status !== "string" || !NOTICE_STATUSES.has(body.status as NoticeStatus))) return { error: "invalid status" };
  if (!partial && body.status === "ARCHIVED") return { error: "ARCHIVED status is not allowed when creating a notice" };
  if (body.title !== undefined && typeof body.title !== "string") return { error: "title must be a string" };
  if (body.body !== undefined && typeof body.body !== "string") return { error: "body must be a string" };
  if (body.notifyChannels !== undefined && parseNoticeChannels(body.notifyChannels) === null) return { error: "invalid notifyChannels" };
  if (body.notifyOnPublish !== undefined && typeof body.notifyOnPublish !== "boolean") return { error: "notifyOnPublish must be boolean" };
  if (body.notifyChannels !== undefined && body.notifyOnPublish !== undefined) return { error: "choose notifyChannels or notifyOnPublish" };
  const channels = body.notifyChannels !== undefined
    ? parseNoticeChannels(body.notifyChannels)!
    : body.notifyOnPublish === true
      ? ["WEBPUSH", "KAKAO"] as NoticeDeliveryChannel[]
      : body.notifyOnPublish === false
        ? []
        : undefined;
  const value: Record<string, unknown> = { ...body };
  delete value.notifyOnPublish;
  if (channels !== undefined) value.notifyChannels = channels;
  return { value };
}
