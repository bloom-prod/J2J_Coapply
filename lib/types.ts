export const STATUSES = [
  "Want to Apply",
  "Applied",
  "OA",
  "Phone Screen",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
  "Withdrawn",
] as const;
export type Status = (typeof STATUSES)[number];

// Funnel stages in forward progression order. An application "reaches" a stage
// once its status ever hits that stage or a later one; reaching a stage implies
// reaching every earlier stage (Applied → OA → Phone Screen → Interview → Offer).
// Terminal outcomes (Rejected / Ghosted / Withdrawn) and "Want to Apply" sit
// OUTSIDE the funnel — moving to them never sets a reached flag, it only
// preserves the flags already collected. This is what makes tracking accurate:
// an app that went Applied → OA → Interview → Rejected still counts toward the
// Applied, OA, and Interview buckets, not just Rejected.
export const FUNNEL_STAGES = ["Applied", "OA", "Phone Screen", "Interview", "Offer"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// Rank of each status along the funnel. Outcomes / wishlist are intentionally
// absent (their index resolves to undefined) so they never forward-fill flags.
export const STATUS_STAGE_INDEX: Record<string, number> = {
  Applied: 0,
  OA: 1,
  "Phone Screen": 2,
  Interview: 3,
  Offer: 4,
};

// Sticky boolean fields stored on each application doc, one per funnel stage.
// Kept in funnel order so REACHED_FLAG_KEYS[i] corresponds to FUNNEL_STAGES[i].
export const REACHED_FLAG_KEYS = [
  "reachedApplied",
  "reachedOA",
  "reachedPhoneScreen",
  "reachedInterview",
  "reachedOffer",
] as const;
export type ReachedFlag = (typeof REACHED_FLAG_KEYS)[number];

/** Sticky flags set when `status` becomes current. Only the flag for the stage
 *  actually reached is set — we do NOT forward-fill earlier stages, because an
 *  app can legitimately skip OA or Phone Screen (Applied → Interview directly).
 *  The one implication we keep is Offer ⇒ Interview (an offer essentially
 *  always follows an interview). Returns {} for non-funnel statuses so a move
 *  to Rejected / Ghosted / Withdrawn / Want to Apply never clears prior flags. */
export function reachedFlagsForStatus(status: string): Partial<Record<ReachedFlag, true>> {
  switch (status) {
    case "Applied": return { reachedApplied: true };
    case "OA": return { reachedOA: true };
    case "Phone Screen": return { reachedPhoneScreen: true };
    case "Interview": return { reachedInterview: true };
    case "Offer": return { reachedInterview: true, reachedOffer: true };
    default: return {};
  }
}

/** Merge a new status's flags into the prior sticky flags (never clears them).
 *  Applying is a prerequisite for every later stage, so if any later flag is
 *  set we also set reachedApplied — without assuming the app passed through
 *  every intermediate stage. Used on PUT to preserve history collected before
 *  a terminal outcome (e.g. reachedInterview stays true when the app later
 *  moves to Rejected). */
export function computeReachedFlags(
  status: string,
  existing: Partial<Record<ReachedFlag, boolean>> = {}
): Partial<Record<ReachedFlag, boolean>> {
  const merged: Partial<Record<ReachedFlag, boolean>> = {
    ...existing,
    ...reachedFlagsForStatus(status),
  };
  if (
    merged.reachedOA || merged.reachedPhoneScreen ||
    merged.reachedInterview || merged.reachedOffer
  ) {
    merged.reachedApplied = true;
  }
  return merged;
}

/** Did a job ever reach funnel stage `stageIndex`? Honors sticky flags first,
 *  then falls back to the current status's rank so legacy docs without flags
 *  (e.g. created before the backfill) still count in the funnel. */
export function reachedStage(
  job: { status: string } & Partial<Record<ReachedFlag, boolean>>,
  stageIndex: number
): boolean {
  if (job[REACHED_FLAG_KEYS[stageIndex]] === true) return true;
  const cur = STATUS_STAGE_INDEX[job.status];
  return cur !== undefined && cur >= stageIndex;
}

// "Want to Apply" is a wishlist/bookmark state — the user hasn't applied yet.
// It must not count toward daily application totals, and must not emit an
// "applied" feed event (that made the activity feed announce bookmarks as
// applications, showing far more activity than the shame count).
export const NOT_YET_APPLIED_STATUS = "Want to Apply";

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
  // Sticky funnel-stage flags (see reachedFlagsForStatus). Optional because
  // legacy docs and optimistic temp rows may not carry them yet.
  reachedApplied?: boolean;
  reachedOA?: boolean;
  reachedPhoneScreen?: boolean;
  reachedInterview?: boolean;
  reachedOffer?: boolean;
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

export interface JobPost {
  id: string;
  company: string;
  role: string;
  url: string;
  location: string;
  notes: string;
  ownerUid: string;
  ownerName: string;
  postedAt: string; // ISO datetime
}

export interface FeedEvent {
  type: "applied" | "status" | "offer" | "job_share";
  company: string;
  role: string;
  status: string;
  ownerUid: string;
  ownerName: string;
  ts: Date | null;
}

export interface Resume {
  id: string;
  userId: string;
  userName: string;
  title: string;
  fileName: string;
  uploadedAt: string;
}

export interface ResumeComment {
  id: string;
  resumeId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface InterviewPrepPost {
  id: string;
  title: string;
  content: string;
  company: string; // company name or "general"
  ownerUid: string;
  ownerName: string;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  commentCount?: number;
}

export interface InterviewPrepComment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string; // ISO datetime
}

export interface CommunityStats {
  ok: boolean;
  totalApps: number;
  totalUsers: number;
  avgPerUser: number;
  interviewRate: number;
  offerRate: number;
  responseRate: number;
  oaRate: number;
  statusCounts: Record<string, number>;
  funnelCounts: Record<string, number>;
  topCompanies: { name: string; count: number }[];
  monthlyVolume: { month: string; count: number }[];
  uidToName: Record<string, string>;
  userColors: Record<string, string>;
  weeklyData: Record<string, string | number>[];
  weeklyUsers: string[];
  roleCatData: Record<string, string | number>[];
  roleCatUsers: string[];
}
