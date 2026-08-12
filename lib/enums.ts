import { applicationPriority, applicationStatus, roleCategory } from "@/db/schema";

type StatusEnum = (typeof applicationStatus.enumValues)[number];
type PriorityEnum = (typeof applicationPriority.enumValues)[number];
type RoleCategoryEnum = (typeof roleCategory.enumValues)[number];

// UI display strings (what the client sends / lib/types STATUSES) -> Postgres enum.
export const STATUS_TO_ENUM: Record<string, StatusEnum> = {
  "Want to Apply": "WANT_TO_APPLY",
  Applied: "APPLIED",
  OA: "ONLINE_ASSESMENT",
  "Phone Screen": "PHONE_SCREEN",
  Interview: "INTERVIEW",
  Waiting: "WAITING",
  Offer: "OFFER",
  Rejected: "REJECTED",
  Ghosted: "GHOSTED",
  Withdrawn: "WITHDRAWN",
};

export const ENUM_TO_STATUS: Record<StatusEnum, string> = Object.fromEntries(
  Object.entries(STATUS_TO_ENUM).map(([k, v]) => [v, k])
) as Record<StatusEnum, string>;

export function statusToEnum(status: string): StatusEnum | undefined {
  return STATUS_TO_ENUM[status];
}

export function enumToStatus(enumValue: string | null | undefined): string {
  return enumValue ? ENUM_TO_STATUS[enumValue as StatusEnum] || "" : "";
}

export const PRIORITY_TO_ENUM: Record<string, PriorityEnum> = {
  High: "HIGH",
  Medium: "MEDIUM",
  Low: "LOW",
};

export const ENUM_TO_PRIORITY: Record<PriorityEnum, string> = Object.fromEntries(
  Object.entries(PRIORITY_TO_ENUM).map(([k, v]) => [v, k])
) as Record<PriorityEnum, string>;

export function priorityToEnum(p: string): PriorityEnum | undefined {
  return PRIORITY_TO_ENUM[p];
}

export function enumToPriority(e: string | null | undefined): string {
  return e ? ENUM_TO_PRIORITY[e as PriorityEnum] || "" : "";
}

export const ROLE_CATEGORY_TO_ENUM: Record<string, RoleCategoryEnum> = {
  "Software Engineering": "SOFTWARE_ENGINEERING",
  "AI Engineering": "AI_ENGINEERING",
  "ML Engineering": "ML_ENGINEERING",
  "Product Management": "PRODUCT_MANAGEMENT",
  "Data & Analytics": "DATA_AND_ANALYTICS",
  Design: "DESIGN",
  "DevOps & Infra": "DEVOPS_AND_INFRA",
  Research: "RESEARCH",
  Marketing: "MARKETING",
  Sales: "SALES",
  Finance: "FINANCE",
  Operations: "OPERATIONS",
  "HR & Recruiting": "HR_AND_RECRUITING",
  Other: "OTHER",
};

export const ENUM_TO_ROLE_CATEGORY: Record<RoleCategoryEnum, string> = Object.fromEntries(
  Object.entries(ROLE_CATEGORY_TO_ENUM).map(([k, v]) => [v, k])
) as Record<RoleCategoryEnum, string>;

export function roleCategoryToEnum(rc: string): RoleCategoryEnum | null {
  return ROLE_CATEGORY_TO_ENUM[rc] || null;
}

export function enumToRoleCategory(e: string | null | undefined): string {
  return e ? ENUM_TO_ROLE_CATEGORY[e as RoleCategoryEnum] || "" : "";
}