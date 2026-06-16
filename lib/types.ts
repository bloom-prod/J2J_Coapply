export const STATUSES = [
  "Want to Apply",
  "Applied",
  "Phone Screen",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
  "Withdrawn",
] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["High", "Medium", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

// User-editable fields shared by the form and the API.
export const FIELD_KEYS = [
  "company",
  "role",
  "roleCategory",
  "status",
  "priority",
  "location",
  "date",
  "salary",
  "url",
  "recruiter",
  "followup",
  "notes",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface Job {
  id: string;
  company: string;
  role: string;
  roleCategory: string;
  status: string;
  priority: string;
  location: string;
  date: string;
  salary: string;
  url: string;
  recruiter: string;
  followup: string;
  notes: string;
  starred: boolean;
  ownerUid: string;
  ownerName: string;
  added: string;
  updated: string;
}

export interface FeedEvent {
  type: "applied" | "status" | "offer";
  company: string;
  role: string;
  status: string;
  ownerName: string;
  ts: Date | null;
}

export interface CommunityStats {
  ok: boolean;
  totalApps: number;
  totalUsers: number;
  avgPerUser: number;
  interviewRate: number;
  offerRate: number;
  responseRate: number;
  statusCounts: Record<string, number>;
  topCompanies: { name: string; count: number }[];
  monthlyVolume: { month: string; count: number }[];
}
