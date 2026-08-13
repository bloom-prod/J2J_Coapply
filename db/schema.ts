import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ── Enums (schema.txt) ────────────────────────────────────────────────────
export const applicationStatus = pgEnum("application_status", [
  "WANT_TO_APPLY",
  "APPLIED",
  "PHONE_SCREEN",
  "ONLINE_ASSESMENT",
  "INTERVIEW",
  // Holding state: a step (OA, screen, interview) is done and the user is
  // waiting to hear back. Deliberately NOT a funnel stage — it records no
  // progress of its own, it only preserves whatever stage was already
  // reached. See lib/types.ts FUNNEL_STAGES.
  "WAITING",
  "OFFER",
  "REJECTED",
  "GHOSTED",
  "WITHDRAWN",
]);

export const applicationPriority = pgEnum("application_priority", [
  "HIGH",
  "MEDIUM",
  "LOW",
]);

export const activityType = pgEnum("activity_type", [
  "APPLIED",
  "STATUS",
  "OFFER",
  "JOB_SHARE",
  "RESUME_UPLOAD",
  "RESUME_DELETE",
  "LC_SOLVED",
]);

export const leetcodeDifficulty = pgEnum("leetcode_difficulty", [
  "EASY",
  "MEDIUM",
  "HARD",
  "UNKNOWN",
]);

export const roleCategory = pgEnum("role_category", [
  "SOFTWARE_ENGINEERING",
  "AI_ENGINEERING",
  "ML_ENGINEERING",
  "PRODUCT_MANAGEMENT",
  "DATA_AND_ANALYTICS",
  "DESIGN",
  "DEVOPS_AND_INFRA",
  "RESEARCH",
  "MARKETING",
  "SALES",
  "FINANCE",
  "OPERATIONS",
  "HR_AND_RECRUITING",
  "OTHER",
]);

// ── Tables ────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  userColor: text("user_color").default("#78AEDE"),
  leetcodeRepoUrl: text("leetcode_repo_url"),
  leetcodeLastSyncedAt: timestamp("leetcode_last_synced_at", { withTimezone: true }),
  websiteUrl: text("website_url"),
  linkedinUrl: text("linkedin_url"),
  githubUrl: text("github_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  approved: boolean("approved").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const lcProblems = pgTable("lc_problems", {
  problemId: text("problem_id").primaryKey(),
  problemName: text("problem_name").notNull(),
  problemDifficulty: leetcodeDifficulty("problem_difficulty"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
});

export const lcSolvedUser = pgTable(
  "lc_solved_user",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    problemId: text("problem_id")
      .notNull()
      .references(() => lcProblems.problemId),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    languageUsed: text("language_used"),
    commitHash: text("commit_hash"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.problemId] }),
    index("lc_solved_user_problem_id").on(t.problemId),
    index("lc_solved_user_user_id").on(t.userId),
    index("lc_solved_user_solved_at").on(t.solvedAt),
  ]
);

export const resumes = pgTable(
  "resumes",
  {
    resumeId: uuid("resume_id").primaryKey().defaultRandom(),
    filePath: text("file_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    fileName: text("file_name"),
    resumeTitle: text("resume_title"),
    communityId: uuid("community_id"),
  },
  (t) => [
    index("resumes_user_id").on(t.userId),
    index("resumes_user_created").on(t.userId, t.createdAt),
    index("resumes_file_name").on(t.fileName),
  ]
);

export const resumeComments = pgTable(
  "resume_comments",
  {
    commentId: uuid("comment_id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    comment: text("comment"),
    commenterId: uuid("commenter_id")
      .notNull()
      .references(() => users.id),
    resolvedStatus: boolean("resolved_status").notNull().default(false),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.resumeId, { onDelete: "cascade" }),
  },
  (t) => [
    index("resume_comments_commenter").on(t.commenterId),
    index("resume_comments_resume").on(t.resumeId),
    index("resume_comments_resume_created").on(t.resumeId, t.createdAt),
    index("resume_comments_resume_resolved").on(t.resumeId, t.resolvedStatus),
  ]
);

export const applications = pgTable(
  "applications",
  {
    applicationId: uuid("application_id").primaryKey().defaultRandom(),
    company: text("company").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    appliedDate: date("applied_date"),
    location: text("location"),
    notes: text("notes"),
    applicantId: uuid("applicant_id")
      .notNull()
      .references(() => users.id),
    priority: applicationPriority("priority").default("MEDIUM"),
    recruiterName: text("recruiter_name"),
    role: text("role").notNull(),
    roleCategory: roleCategory("role_category"),
    salary: text("salary"),
    starred: boolean("starred").notNull().default(false),
    status: applicationStatus("status").default("APPLIED"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    followUp: date("follow_up"),
    url: text("url"),
  },
  (t) => [
    index("applications_applicant").on(t.applicantId),
    index("applications_applicant_status").on(t.applicantId, t.status),
    index("applications_applicant_applied").on(t.applicantId, t.appliedDate),
    index("applications_applicant_starred").on(t.applicantId, t.starred),
    index("applications_applicant_priority").on(t.applicantId, t.priority),
    index("applications_created").on(t.createdAt),
    index("applications_company").on(t.company),
    index("applications_status").on(t.status),
    index("applications_applied").on(t.appliedDate),
    index("applications_follow_up").on(t.followUp),
    index("applications_updated").on(t.updatedAt),
  ]
);

export const activityLog = pgTable(
  "activity_log",
  {
    activityId: uuid("activity_id").primaryKey().defaultRandom(),
    company: text("company"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    occuredAt: timestamp("occured_at", { withTimezone: true }).notNull().defaultNow(),
    type: activityType("type"),
    role: text("role"),
    status: text("status"),
    resumeId: uuid("resume_id").references(() => resumes.resumeId, { onDelete: "set null" }),
    problemId: text("problem_id").references(() => lcProblems.problemId, { onDelete: "set null" }),
    communityId: uuid("community_id"),
  },
  (t) => [
    index("activity_log_occured").on(t.occuredAt),
    index("activity_log_user").on(t.userId),
    index("activity_log_user_occured").on(t.userId, t.occuredAt),
    index("activity_log_resume").on(t.resumeId),
    index("activity_log_problem").on(t.problemId),
  ]
);

export const applicationUserStatus = pgTable(
  "application_user_status",
  {
    statusLogId: uuid("status_log_id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.applicationId, { onDelete: "cascade" }),
    changedById: uuid("changed_by_id")
      .notNull()
      .references(() => users.id),
    status: applicationStatus("status").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("aus_application").on(t.applicationId),
    index("aus_application_changed").on(t.applicationId, t.changedAt),
    index("aus_application_status").on(t.applicationId, t.status),
    index("aus_changed_by").on(t.changedById),
    index("aus_status").on(t.status),
  ]
);

export const interviewPrep = pgTable(
  "interview_prep",
  {
    postId: uuid("post_id").primaryKey().defaultRandom(),
    company: text("company"),
    postContent: text("post_content"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    postTitle: text("post_title"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    communityId: uuid("community_id"),
  },
  (t) => [
    index("ip_creator").on(t.creatorId),
    index("ip_creator_created").on(t.creatorId, t.createdAt),
    index("ip_company").on(t.company),
    index("ip_created").on(t.createdAt),
    index("ip_updated").on(t.updatedAt),
  ]
);

export const ivpComments = pgTable(
  "ivp_comments",
  {
    commentId: uuid("comment_id").primaryKey().defaultRandom(),
    commentedOn: uuid("commented_on")
      .notNull()
      .references(() => interviewPrep.postId, { onDelete: "cascade" }),
    commentedBy: uuid("commented_by")
      .notNull()
      .references(() => users.id),
    commentContent: text("comment_content"),
    commentDate: timestamp("comment_date", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("ivp_comments_on").on(t.commentedOn),
    index("ivp_comments_by").on(t.commentedBy),
    index("ivp_comments_on_date").on(t.commentedOn, t.commentDate),
  ]
);

export const jobboard = pgTable(
  "jobboard",
  {
    postId: uuid("post_id").primaryKey().defaultRandom(),
    postedBy: uuid("posted_by")
      .notNull()
      .references(() => users.id),
    company: text("company").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    jobRole: text("job_role").notNull(),
    jobUrl: text("job_url").notNull(),
    jobLocation: text("job_location"),
    jobNotes: text("job_notes"),
    communityId: uuid("community_id"),
  },
  (t) => [
    index("jb_posted_by").on(t.postedBy),
    index("jb_posted_created").on(t.postedBy, t.createdAt),
    index("jb_company").on(t.company),
    index("jb_role").on(t.jobRole),
    index("jb_location").on(t.jobLocation),
    index("jb_created").on(t.createdAt),
  ]
);

export const dailyRoasts = pgTable(
  "daily_roasts",
  {
    roastDate: date("roast_date"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roastText: text("roast_text"),
    appsCount: integer("apps_count"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow(),
    communityId: uuid("community_id"),
  },
  (t) => [
    primaryKey({ columns: [t.roastDate, t.userId] }),
    index("dr_user").on(t.userId),
  ]
);

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("password_resets_email").on(t.email),
    index("password_resets_email_created").on(t.email, t.createdAt),
  ]
);

export const communities = pgTable(
  "communities",
  {
    communityId: uuid("community_id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    inviteCode: text("invite_code").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("communities_created_by").on(t.createdBy),
    index("communities_invite_code").on(t.inviteCode),
  ]
);

export const communityMembers = pgTable(
  "community_members",
  {
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.communityId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.communityId, t.userId] }),
    index("cm_community").on(t.communityId),
    index("cm_user").on(t.userId),
  ]
);

// Personal scratchpad — exactly one row per user, hence user_id as the PK.
// Private and NOT community-scoped: these are the user's own temp notes, and
// they are never surfaced in the feed, stats, or any community view.
export const userNotes = pgTable("user_notes", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});