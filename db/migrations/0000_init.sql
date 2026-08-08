CREATE TYPE "public"."activity_type" AS ENUM('APPLIED', 'STATUS', 'OFFER', 'JOB_SHARE');--> statement-breakpoint
CREATE TYPE "public"."application_priority" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('WANT_TO_APPLY', 'APPLIED', 'PHONE_SCREEN', 'ONLINE_ASSESMENT', 'INTERVIEW', 'OFFER', 'REJECTED', 'GHOSTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."leetcode_difficulty" AS ENUM('EASY', 'MEDIUM', 'HARD', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."role_category" AS ENUM('SOFTWARE_ENGINEERING', 'AI_ENGINEERING', 'ML_ENGINEERING', 'PRODUCT_MANAGEMENT', 'DATA_AND_ANALYTICS', 'DESIGN', 'DEVOPS_AND_INFRA', 'RESEARCH', 'MARKETING', 'SALES', 'FINANCE', 'OPERATIONS', 'HR_AND_RECRUITING', 'OTHER');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"activity_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text,
	"user_id" uuid NOT NULL,
	"occured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "activity_type",
	"role" text,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "application_user_status" (
	"status_log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"changed_by_id" uuid NOT NULL,
	"status" "application_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"application_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"applied_date" date,
	"location" text,
	"notes" text,
	"applicant_id" uuid NOT NULL,
	"priority" "application_priority" DEFAULT 'MEDIUM',
	"recruiter_name" text,
	"role" text NOT NULL,
	"role_category" "role_category",
	"salary" text,
	"starred" boolean DEFAULT false NOT NULL,
	"status" "application_status" DEFAULT 'APPLIED',
	"updated_at" timestamp with time zone DEFAULT now(),
	"follow_up" date,
	"url" text
);
--> statement-breakpoint
CREATE TABLE "daily_roasts" (
	"roast_date" date,
	"user_id" uuid NOT NULL,
	"roast_text" text,
	"apps_count" integer,
	"generated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "daily_roasts_roast_date_user_id_pk" PRIMARY KEY("roast_date","user_id")
);
--> statement-breakpoint
CREATE TABLE "interview_prep" (
	"post_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text,
	"post_content" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"creator_id" uuid NOT NULL,
	"post_title" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ivp_comments" (
	"comment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commented_on" uuid NOT NULL,
	"commented_by" uuid NOT NULL,
	"comment_content" text,
	"comment_date" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jobboard" (
	"post_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"posted_by" uuid NOT NULL,
	"company" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"job_role" text NOT NULL,
	"job_url" text NOT NULL,
	"job_location" text,
	"job_notes" text
);
--> statement-breakpoint
CREATE TABLE "lc_problems" (
	"problem_id" text PRIMARY KEY NOT NULL,
	"problem_name" text NOT NULL,
	"problem_difficulty" "leetcode_difficulty",
	"first_seen_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lc_solved_user" (
	"user_id" uuid NOT NULL,
	"problem_id" text NOT NULL,
	"solved_at" timestamp with time zone,
	"language_used" text,
	"commit_hash" text,
	CONSTRAINT "lc_solved_user_user_id_problem_id_pk" PRIMARY KEY("user_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "resume_comments" (
	"comment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"comment" text,
	"commenter_id" uuid NOT NULL,
	"resolved_status" boolean DEFAULT false NOT NULL,
	"resume_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"resume_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"user_id" uuid NOT NULL,
	"file_name" text,
	"resume_title" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"password_hash" text,
	"user_color" text DEFAULT '#78AEDE',
	"leetcode_repo_url" text,
	"leetcode_last_synced_at" timestamp with time zone,
	"website_url" text,
	"linkedin_url" text,
	"github_url" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_user_status" ADD CONSTRAINT "application_user_status_application_id_applications_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_user_status" ADD CONSTRAINT "application_user_status_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_roasts" ADD CONSTRAINT "daily_roasts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep" ADD CONSTRAINT "interview_prep_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivp_comments" ADD CONSTRAINT "ivp_comments_commented_on_interview_prep_post_id_fk" FOREIGN KEY ("commented_on") REFERENCES "public"."interview_prep"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivp_comments" ADD CONSTRAINT "ivp_comments_commented_by_users_id_fk" FOREIGN KEY ("commented_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobboard" ADD CONSTRAINT "jobboard_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lc_solved_user" ADD CONSTRAINT "lc_solved_user_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lc_solved_user" ADD CONSTRAINT "lc_solved_user_problem_id_lc_problems_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."lc_problems"("problem_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_comments" ADD CONSTRAINT "resume_comments_commenter_id_users_id_fk" FOREIGN KEY ("commenter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_comments" ADD CONSTRAINT "resume_comments_resume_id_resumes_resume_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("resume_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_occured" ON "activity_log" USING btree ("occured_at");--> statement-breakpoint
CREATE INDEX "activity_log_user" ON "activity_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_log_user_occured" ON "activity_log" USING btree ("user_id","occured_at");--> statement-breakpoint
CREATE INDEX "aus_application" ON "application_user_status" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "aus_application_changed" ON "application_user_status" USING btree ("application_id","changed_at");--> statement-breakpoint
CREATE INDEX "aus_application_status" ON "application_user_status" USING btree ("application_id","status");--> statement-breakpoint
CREATE INDEX "aus_changed_by" ON "application_user_status" USING btree ("changed_by_id");--> statement-breakpoint
CREATE INDEX "aus_status" ON "application_user_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_applicant" ON "applications" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "applications_applicant_status" ON "applications" USING btree ("applicant_id","status");--> statement-breakpoint
CREATE INDEX "applications_applicant_applied" ON "applications" USING btree ("applicant_id","applied_date");--> statement-breakpoint
CREATE INDEX "applications_applicant_starred" ON "applications" USING btree ("applicant_id","starred");--> statement-breakpoint
CREATE INDEX "applications_applicant_priority" ON "applications" USING btree ("applicant_id","priority");--> statement-breakpoint
CREATE INDEX "applications_created" ON "applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "applications_company" ON "applications" USING btree ("company");--> statement-breakpoint
CREATE INDEX "applications_status" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_applied" ON "applications" USING btree ("applied_date");--> statement-breakpoint
CREATE INDEX "applications_follow_up" ON "applications" USING btree ("follow_up");--> statement-breakpoint
CREATE INDEX "applications_updated" ON "applications" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "dr_user" ON "daily_roasts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ip_creator" ON "interview_prep" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "ip_creator_created" ON "interview_prep" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "ip_company" ON "interview_prep" USING btree ("company");--> statement-breakpoint
CREATE INDEX "ip_created" ON "interview_prep" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ip_updated" ON "interview_prep" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ivp_comments_on" ON "ivp_comments" USING btree ("commented_on");--> statement-breakpoint
CREATE INDEX "ivp_comments_by" ON "ivp_comments" USING btree ("commented_by");--> statement-breakpoint
CREATE INDEX "ivp_comments_on_date" ON "ivp_comments" USING btree ("commented_on","comment_date");--> statement-breakpoint
CREATE INDEX "jb_posted_by" ON "jobboard" USING btree ("posted_by");--> statement-breakpoint
CREATE INDEX "jb_posted_created" ON "jobboard" USING btree ("posted_by","created_at");--> statement-breakpoint
CREATE INDEX "jb_company" ON "jobboard" USING btree ("company");--> statement-breakpoint
CREATE INDEX "jb_role" ON "jobboard" USING btree ("job_role");--> statement-breakpoint
CREATE INDEX "jb_location" ON "jobboard" USING btree ("job_location");--> statement-breakpoint
CREATE INDEX "jb_created" ON "jobboard" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lc_solved_user_problem_id" ON "lc_solved_user" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "lc_solved_user_user_id" ON "lc_solved_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lc_solved_user_solved_at" ON "lc_solved_user" USING btree ("solved_at");--> statement-breakpoint
CREATE INDEX "resume_comments_commenter" ON "resume_comments" USING btree ("commenter_id");--> statement-breakpoint
CREATE INDEX "resume_comments_resume" ON "resume_comments" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX "resume_comments_resume_created" ON "resume_comments" USING btree ("resume_id","created_at");--> statement-breakpoint
CREATE INDEX "resume_comments_resume_resolved" ON "resume_comments" USING btree ("resume_id","resolved_status");--> statement-breakpoint
CREATE INDEX "resumes_user_id" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resumes_user_created" ON "resumes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "resumes_file_name" ON "resumes" USING btree ("file_name");