import type { Job } from "./types";

export const ROLE_CATEGORIES = [
  "Software Engineering",
  "AI Engineering",
  "ML Engineering",
  "Product Management",
  "Data & Analytics",
  "Design",
  "DevOps & Infra",
  "Research",
  "Marketing",
  "Sales",
  "Finance",
  "Operations",
  "HR & Recruiting",
  "Other",
] as const;

export function classifyRole(role: string): string {
  const r = role.toLowerCase();
  // AI Engineering: agent/LLM/GenAI work — model application, not model training
  if (/\b(ai engineer|ai developer|llm engineer|generative ai engineer|genai engineer|applied ai|ai product engineer|prompt engineer|ai infrastructure|rag engineer)\b/.test(r)) return "AI Engineering";
  // ML Engineering: model training, research-to-prod pipelines
  if (/\b(ml engineer|machine learning engineer|mlops|deep learning engineer|computer vision engineer|nlp engineer|model engineer|applied ml)\b/.test(r)) return "ML Engineering";
  if (/\b(software engineer|software developer|swe|sde|programmer|backend|frontend|fullstack|full.stack|\bios\b|android|mobile engineer|web engineer|architect|staff engineer|principal engineer)\b/.test(r)) return "Software Engineering";
  if (/product manager|program manager|\bpm\b|product owner|product lead/.test(r)) return "Product Management";
  if (/data scientist|data analyst|data engineer|analytics engineer|business intelligence|bi engineer/.test(r)) return "Data & Analytics";
  if (/\bdesigner|\bux\b|\bui\b|product design|graphic design|visual design/.test(r)) return "Design";
  if (/devops|infrastructure|\bsre\b|cloud engineer|platform engineer|security engineer|cybersecurity/.test(r)) return "DevOps & Infra";
  if (/research scientist|research engineer|\bscientist\b/.test(r)) return "Research";
  if (/\bmarketing|growth hacker|content writer|copywriter|\bseo\b/.test(r)) return "Marketing";
  if (/\bsales\b|account executive|\bae\b|business development|\bbdr\b|\bsdr\b|account manager/.test(r)) return "Sales";
  if (/\bfinance\b|financial analyst|investment banking|\baccounting\b|\baccountant\b/.test(r)) return "Finance";
  if (/\boperations\b|\bops\b|chief of staff|biz ops/.test(r)) return "Operations";
  if (/\brecruiter\b|talent acquisition|\bhr\b|human resources|people ops/.test(r)) return "HR & Recruiting";
  return "Other";
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const statusKey = (s: string) => (s || "Applied").replace(/\s+/g, "-");
export const isStarred = (j: Job) => j.starred === true;

export const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export function fmtDate(d: string): string {
  if (!d) return "—";
  const [y, m, day] = String(d).split("-");
  if (!m) return d;
  return `${MONTHS[parseInt(m)]} ${parseInt(day)}, ${y}`;
}

export function timeAgo(date: Date | null): string {
  if (!date) return "just now";
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
