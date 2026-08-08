ALTER TYPE "public"."activity_type" ADD VALUE 'RESUME_UPLOAD';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'RESUME_DELETE';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'LC_SOLVED';--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "resume_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "problem_id" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_resume_id_resumes_resume_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("resume_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_problem_id_lc_problems_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."lc_problems"("problem_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_resume" ON "activity_log" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX "activity_log_problem" ON "activity_log" USING btree ("problem_id");