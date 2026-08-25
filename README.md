# 🌿 bloom tracker

A collaborative job tracker. Users log their applications, keep status history, and share
a community garden — a job board, an activity feed, pooled stats, charts, a leaderboard,
and daily roasts.

Built with Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui, Drizzle ORM, Postgres,
JWT auth, and MinIO/S3 for resumes.

## Schema

```dbml
Enum application_status {
  WANT_TO_APPLY
  APPLIED
  PHONE_SCREEN
  ONLINE_ASSESMENT
  INTERVIEW
  WAITING
  OFFER
  REJECTED
  GHOSTED
  WITHDRAWN
}

Enum application_priority {
  HIGH
  MEDIUM
  LOW
}

Enum activity_type {
  APPLIED
  STATUS
  OFFER
  JOB_SHARE
  RESUME_UPLOAD
  RESUME_DELETE
  LC_SOLVED
}

Enum leetcode_difficulty {
  EASY
  MEDIUM
  HARD
  UNKNOWN
}

Enum role_category {
  SOFTWARE_ENGINEERING
  AI_ENGINEERING
  ML_ENGINEERING
  PRODUCT_MANAGEMENT
  DATA_AND_ANALYTICS
  DESIGN
  DEVOPS_AND_INFRA
  RESEARCH
  MARKETING
  SALES
  FINANCE
  OPERATIONS
  HR_AND_RECRUITING
  OTHER
}

Table users {
  id uuid [pk, default: `gen_random_uuid()`]
  name varchar
  email varchar [not null, unique]
  password_hash varchar
  user_color varchar [default: '#78AEDE']
  leetcode_repo_url varchar
  leetcode_last_synced_at timestamptz
  website_url varchar
  linkedin_url varchar
  github_url varchar
  is_admin bool [not null, default: false]
  approved bool [not null, default: false]
  updated_at timestamptz [default: `now()`]

  Indexes {
    users_email [unique]
  }
}

Table communities {
  community_id uuid [pk, default: `gen_random_uuid()`]
  name varchar [not null]
  invite_code varchar [not null, unique]
  created_by uuid [not null]
  created_at timestamptz [default: `now()`]
  updated_at timestamptz [default: `now()`]

  Indexes {
    communities_created_by
    communities_invite_code
  }
}

Table community_members {
  community_id uuid [not null]
  user_id uuid [not null]
  role varchar [not null, default: 'member']
  joined_at timestamptz [default: `now()`]

  Indexes {
    (community_id, user_id) [pk]
    cm_community
    cm_user
  }
}

Table user_notes {
  user_id uuid [pk]
  content varchar [not null, default: '']
  updated_at timestamptz [not null, default: `now()`]
}

Table lc_problems {
  problem_id varchar [pk]
  problem_name varchar [not null]
  problem_difficulty leetcode_difficulty
  first_seen_at timestamptz [default: `now()`]

  Indexes {
    problem_name
    problem_difficulty
  }
}

Table lc_solved_user {
  user_id uuid [not null]
  problem_id varchar [not null]
  solved_at timestamptz
  language_used varchar
  commit_hash varchar

  Indexes {
    (user_id, problem_id) [pk]
    problem_id
    user_id
    solved_at
  }
}

Table resumes {
  resume_id uuid [pk, default: `gen_random_uuid()`]
  file_path varchar [not null]
  created_at timestamptz [default: `now()`]
  user_id uuid [not null]
  file_name varchar
  resume_title varchar
  community_id uuid

  Indexes {
    resumes_user_id
    resumes_user_created
    resumes_file_name
  }
}

Table resume_comments {
  comment_id uuid [pk, default: `gen_random_uuid()`]
  created_at timestamptz [default: `now()`]
  comment varchar
  commenter_id uuid [not null]
  resolved_status bool [not null, default: false]
  resume_id uuid [not null]

  Indexes {
    commenter_id
    resume_id
    (resume_id, created_at)
    (resume_id, resolved_status)
  }
}

Table applications {
  application_id uuid [pk, default: `gen_random_uuid()`]
  company varchar [not null]
  created_at timestamptz [default: `now()`]
  applied_date date
  location varchar
  notes varchar
  applicant_id uuid [not null]
  priority application_priority [default: 'MEDIUM']
  recruiter_name varchar
  role varchar [not null]
  role_category role_category
  salary varchar
  starred bool [not null, default: false]
  status application_status [default: 'APPLIED']
  updated_at timestamptz [default: `now()`]
  follow_up date
  url varchar

  Indexes {
    applicant_id
    (applicant_id, status)
    (applicant_id, applied_date)
    (applicant_id, starred)
    (applicant_id, priority)
    created_at
    company
    status
    applied_date
    follow_up
    updated_at
  }
}

Table activity_log {
  activity_id uuid [pk, default: `gen_random_uuid()`]
  company varchar
  user_id uuid [not null]
  occured_at timestamptz [not null, default: `now()`]
  type activity_type
  role varchar
  status varchar
  resume_id uuid
  problem_id varchar
  community_id uuid

  Indexes {
    activity_log_occured
    activity_log_user
    activity_log_user_occured
    activity_log_resume
    activity_log_problem
  }
}

Table application_user_status {
  status_log_id uuid [pk, default: `gen_random_uuid()`]
  application_id uuid [not null]
  changed_by_id uuid [not null]
  status application_status [not null]
  changed_at timestamptz [not null, default: `now()`]

  Indexes {
    application_id
    (application_id, changed_at)
    (application_id, status)
    changed_by_id
    status
  }
}

Table interview_prep {
  post_id uuid [pk, default: `gen_random_uuid()`]
  company varchar
  post_content varchar
  created_at timestamptz [default: `now()`]
  creator_id uuid [not null]
  post_title varchar
  updated_at timestamptz [default: `now()`]
  community_id uuid

  Indexes {
    ip_creator
    ip_creator_created
    ip_company
    ip_created
    ip_updated
  }
}

Table ivp_comments {
  comment_id uuid [pk, default: `gen_random_uuid()`]
  commented_on uuid [not null]
  commented_by uuid [not null]
  comment_content varchar
  comment_date timestamptz [default: `now()`]

  Indexes {
    commented_on
    commented_by
    (commented_on, comment_date)
  }
}

Table jobboard {
  post_id uuid [pk, default: `gen_random_uuid()`]
  posted_by uuid [not null]
  company varchar [not null]
  created_at timestamptz [default: `now()`]
  job_role varchar [not null]
  job_url varchar [not null]
  job_location varchar
  job_notes varchar
  community_id uuid

  Indexes {
    jb_posted_by
    jb_posted_created
    jb_company
    jb_role
    jb_location
    jb_created
  }
}

Table daily_roasts {
  roast_date date
  user_id uuid [not null]
  roast_text varchar
  apps_count int
  generated_at timestamptz [default: `now()`]
  community_id uuid

  Indexes {
    (roast_date, user_id) [pk]
    dr_user
  }
}

Table password_resets {
  id uuid [pk, default: `gen_random_uuid()`]
  email varchar [not null]
  otp_hash varchar [not null]
  expires_at timestamptz [not null]
  used_at timestamptz
  created_at timestamptz [not null, default: `now()`]

  Indexes {
    email
    (email, created_at)
  }
}

Ref: lc_solved_user.user_id > users.id
Ref: lc_solved_user.problem_id > lc_problems.problem_id
Ref: resumes.user_id > users.id
Ref: resume_comments.commenter_id > users.id
Ref: resume_comments.resume_id > resumes.resume_id [delete: cascade]
Ref: applications.applicant_id > users.id
Ref: activity_log.user_id > users.id
Ref: activity_log.resume_id > resumes.resume_id [delete: set null]
Ref: activity_log.problem_id > lc_problems.problem_id [delete: set null]
Ref: application_user_status.application_id > applications.application_id [delete: cascade]
Ref: application_user_status.changed_by_id > users.id
Ref: interview_prep.creator_id > users.id
Ref: ivp_comments.commented_on > interview_prep.post_id [delete: cascade]
Ref: ivp_comments.commented_by > users.id
Ref: jobboard.posted_by > users.id
Ref: daily_roasts.user_id > users.id
Ref: communities.created_by > users.id
Ref: community_members.community_id > communities.community_id [delete: cascade]
Ref: community_members.user_id > users.id [delete: cascade]
Ref: user_notes.user_id > users.id [delete: cascade]
```

## Feature List

**Applications**
- Track companies, roles, statuses, priority, location, salary, notes, recruiter, dates, URLs, and starring
- Status funnel with `application_user_status` history
- Backfill past stages with "Update past status" (date + status rows)

**Analytics / Insights**
- Personal funnel, weekly volume, application heatmap, and per-status / company / location / role breakdowns
- Sankey diagram of the application flow (status transitions over time)
- Community stats, leaderboard, and daily roasts (shame wall)

**Community**
- Shared job board with direct apply links
- Live activity feed (`activity_log`)
- Interview-prep posts with comments
- Resume uploads (stored in MinIO/S3) with review comments and resolve flags

**LeetCode**
- Track solved problems, languages, and commit hashes
- Automatic sync from GitHub repos (hourly cron), using repo commit timestamps
- Per-user leaderboard, language/difficulty counts, and weekly volume

**Auth**
- Email/password signup with JWT sessions
- 6-digit OTP password reset via email
- Admin approval for new signups (`/admin`), with `admin@pxndey.com`

**Crons** (`cron/`)
- `daily-email` — daily recap of each user's last 24h from `activity_log`, plus job-board suggestions
- `sync-leetcode` — hourly force-refresh of LeetCode solves from GitHub into Postgres
