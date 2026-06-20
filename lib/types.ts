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

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  color: string;
  githubUrl?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  leetcodeRepoUrl?: string;
  leetcodeLastSyncedAt?: string;
}

export interface LeetCodeProblemDoc {
  problemId: string;
  title: string;
  difficulty?: string;
  language: string;
  commitHash: string;
  solvedAt: string;
}

export interface LeetCodeStats {
  ok: boolean;
  totalUsers: number;
  totalSolved: number;
  avgPerUser: number;
  languageCounts: Record<string, number>;
  difficultyCounts: Record<string, number>;
  weeklyVolume: { week: string; count: number }[];
  weeklyData: Record<string, string | number>[];
  weeklyUsers: string[];
  userLeaderboard: { name: string; count: number }[];
  recentActivity: { userName: string; problemId: string; title: string; difficulty: string; language: string; solvedAt: string }[];
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
