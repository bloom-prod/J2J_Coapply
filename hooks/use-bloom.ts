"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  onAuthChange,
  signOut as clientSignOut,
  getToken,
  getCurrentUser,
  type ClientUser,
} from "@/lib/client-auth";
import type { FeedEvent, Job, JobPost, Resume, UserProfile, InterviewPrepPost, InterviewPrepComment } from "@/lib/types";
import { resolveUserColor } from "@/lib/user-colors";
import { jobKey } from "@/lib/import-utils";

interface ApiApplication {
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
  reachedApplied: boolean;
  reachedOA: boolean;
  reachedPhoneScreen: boolean;
  reachedInterview: boolean;
  reachedOffer: boolean;
  ownerUid: string;
  ownerName: string;
  added: string;
  updated: string;
}

function mapDoc(x: ApiApplication): Job {
  return {
    id: x.id,
    company: x.company || "",
    role: x.role || "",
    roleCategory: x.roleCategory || "",
    status: x.status || "Applied",
    priority: x.priority || "",
    location: x.location || "",
    date: x.date || "",
    salary: x.salary || "",
    url: x.url || "",
    recruiter: x.recruiter || "",
    followup: x.followup || "",
    notes: x.notes || "",
    starred: x.starred === true,
    // Sticky funnel flags come from the server (recovered from the status
    // log, same as /api/stats) so the community/insights buckets agree.
    reachedApplied: x.reachedApplied === true,
    reachedOA: x.reachedOA === true,
    reachedPhoneScreen: x.reachedPhoneScreen === true,
    reachedInterview: x.reachedInterview === true,
    reachedOffer: x.reachedOffer === true,
    ownerUid: x.ownerUid || "",
    ownerName: x.ownerName || "",
    added: x.added || "",
    updated: x.updated || "",
  };
}

interface ApiFeedEvent {
  id: string;
  type: FeedEvent["type"];
  company: string;
  role: string;
  status: string;
  ownerUid: string;
  ownerName: string;
  ts: string | Date | null;
}

function mapFeed(x: ApiFeedEvent): FeedEvent {
  const ts = typeof x.ts === "string" ? new Date(x.ts) : x.ts instanceof Date ? x.ts : null;
  return {
    type: x.type || "applied",
    company: x.company || "",
    role: x.role || "",
    status: x.status || "",
    ownerUid: x.ownerUid || "",
    ownerName: x.ownerName || "",
    ts,
  };
}

interface Pending {
  adds: Job[];
  patches: Record<string, Partial<Job>>;
  deletes: Record<string, true>;
}

const EMPTY_PENDING: Pending = { adds: [], patches: {}, deletes: {} };

export function useBloom() {
  const [user, setUser] = useState<ClientUser | null>(getCurrentUser());
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverJobs, setServerJobs] = useState<Job[]>([]);
  const [rawFeed, setRawFeed] = useState<FeedEvent[]>([]);
  const [jobPosts, setJobPosts] = useState<JobPost[]>([]);
  const [interviewPrepPosts, setInterviewPrepPosts] = useState<InterviewPrepPost[]>([]);
  const [interviewPrepComments, setInterviewPrepComments] = useState<Record<string, InterviewPrepComment[]>>({});
  const [pending, setPending] = useState<Pending>(EMPTY_PENDING);
  const [userProfiles, setUserProfiles] = useState<Map<string, { name: string; color: string }> | null>(null);
  // uid → latest display name from userProfiles collection
  const [uidNameMap, setUidNameMap] = useState<Map<string, string>>(new Map());

  // Both flags must be true before we clear the loading spinner.
  // This prevents the community tab from rendering before uidNameMap is populated,
  // which would cause stale ownerNames (e.g. "Plant 1 (heh)") to appear as
  // separate entries alongside the resolved new name ("Superior plant 1").
  const firstSnap = useRef(true);
  const profilesReady = useRef(false);

  // ---- auth ----
  useEffect(() => {
    return onAuthChange((u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setServerJobs([]);
        setRawFeed([]);
        setJobPosts([]);
        setInterviewPrepPosts([]);
        setInterviewPrepComments({});
        setPending(EMPTY_PENDING);
        setUidNameMap(new Map());
        setUserProfiles(null);
        setLoading(true);
        firstSnap.current = true;
      }
    });
  }, []);

  // ---- polling ----
  useEffect(() => {
    if (!user) return;
    firstSnap.current = true;
    profilesReady.current = false;
    setLoading(true);

    let cancelled = false;

    async function refresh() {
      const token = getToken();
      if (!token) return;
      try {
        const [appsRes, feedRes] = await Promise.all([
          fetch("/api/applications", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/feed?limit=10", { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const [appsData, feedData] = await Promise.all([appsRes.json(), feedRes.json()]);
        if (cancelled) return;
        if (appsData.ok) {
          setServerJobs(appsData.applications.map(mapDoc));
        }
        if (feedData.ok) setRawFeed(feedData.feed.map(mapFeed));
      } catch (err) {
        console.error("poll error", err);
      } finally {
        if (!cancelled) {
          // Mark the first snapshot done regardless of success so the loader
          // never hangs if a single poll fails.
          firstSnap.current = false;
          if (profilesReady.current) setLoading(false);
        }
      }
    }

    refresh();

    // Push refreshes over SSE instead of polling every 15s (see /api/live).
    // EventSource auto-reconnects; a slow fallback poll keeps data fresh if
    // push is ever unavailable. On each `refresh` event we refetch the (now on
    // push) endpoints once, not on a timer.
    let es: EventSource | null = null;
    let esToken = "";
    const openLive = () => {
      const token = getToken();
      if (!token || token === esToken) return;
      esToken = token;
      es?.close();
      try {
        es = new EventSource(`/api/live?token=${encodeURIComponent(token)}`);
        es.addEventListener("refresh", () => { if (!cancelled) refresh(); });
        es.onerror = () => { /* EventSource reconnects automatically */ };
      } catch {
        es = null;
      }
    };
    openLive();
    const fallbackPoll = setInterval(refresh, 60000);

    // uid→name/color map comes from the server. We fetch it alongside the
    // jobs/feed poll so the loader only clears after names are resolved.
    const loadNames = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch("/api/usernames", { headers: { Authorization: `Bearer ${token}` } });
        const d = await res.json();
        if (cancelled || !d.ok) return;
        const names = new Map<string, string>(Object.entries(d.uidToName as Record<string, string>));
        const colors = (d.userColors || {}) as Record<string, string>;
        const profiles = new Map<string, { name: string; color: string }>();
        for (const [uid, name] of names) {
          profiles.set(uid, { name, color: colors[name] || resolveUserColor(uid, name) });
        }
        setUidNameMap(names);
        setUserProfiles(profiles);
      } catch (err) {
        console.error("usernames fetch error", err);
      } finally {
        if (!cancelled) {
          profilesReady.current = true;
          if (!firstSnap.current) setLoading(false);
        }
      }
    };

    loadNames();
    // Names can change while the tab is open (someone renames themselves), and
    // there's no live listener to pick that up — refresh on focus so the group
    // sees new names without a reload. One small request, only when refocusing.
    const onFocus = () => { loadNames(); };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(fallbackPoll);
      es?.close();
      window.removeEventListener("focus", onFocus);
    };
  }, [user]);

  // ---- derived: merge server data with optimistic overlay + resolve names ----
  const allJobs = useMemo<Job[]>(() => {
    const patched = serverJobs
      .filter((j) => !pending.deletes[j.id])
      .map((j) => (pending.patches[j.id] ? { ...j, ...pending.patches[j.id] } : j));
    // Dedupe optimistic adds against the server list. ID match covers the
    // common case (createJob reconciles the temp id to the real one once the
    // POST resolves); content match covers the race where onSnapshot delivers
    // the real doc before that reconciliation happens, which would otherwise
    // flash the same application twice for a moment.
    const adds = pending.adds.filter((a) => {
      if (serverJobs.some((s) => s.id === a.id)) return false;
      return !serverJobs.some(
        (s) =>
          s.ownerUid === a.ownerUid &&
          s.company === a.company &&
          s.role === a.role &&
          s.date === a.date &&
          Math.abs(new Date(s.added || 0).getTime() - new Date(a.added || 0).getTime()) < 15000
      );
    });
    const list = [...adds, ...patched].map((j) => ({
      ...j,
      ownerName: (j.ownerUid ? uidNameMap.get(j.ownerUid) : undefined) ?? (j.ownerName || "Someone"),
    }));
    list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return list;
  }, [serverJobs, pending, uidNameMap]);

  const myJobs = useMemo<Job[]>(
    () => allJobs.filter((j) => j.ownerUid === user?.id),
    [allJobs, user]
  );

  // Resolve feed names from uid→name map
  const feed = useMemo<FeedEvent[]>(
    () => rawFeed.map((e) => ({
      ...e,
      ownerName: (e.ownerUid ? uidNameMap.get(e.ownerUid) : undefined) ?? (e.ownerName || "Someone"),
    })),
    [rawFeed, uidNameMap]
  );

  // ---- writes (through the TS API, with optimistic overlay) ----
  const authedFetch = useCallback(
    async (method: string, body: Record<string, unknown>) => {
      const token = getToken();
      if (!token) return { ok: false, error: "Not signed in" };
      const res = await fetch("/api/applications", {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let d: { ok?: boolean; error?: string; id?: string } = {};
      try {
        d = await res.json();
      } catch {
        d = { ok: false, error: "Bad response from server" };
      }
      if (!res.ok || !d.ok) throw new Error(d.error || `Request failed (${res.status})`);
      return d;
    },
    []
  );

  const createJob = useCallback(
    async (data: Record<string, string>) => {
      if (!user) return;
      const tempId = "tmp-" + Math.random().toString(36).slice(2);
      const now = new Date().toISOString();
      const temp: Job = {
        id: tempId,
        company: data.company || "",
        role: data.role || "",
        roleCategory: data.roleCategory || "",
        status: data.status || "Applied",
        priority: data.priority || "",
        location: data.location || "",
        date: data.date || "",
        salary: data.salary || "",
        url: data.url || "",
        recruiter: data.recruiter || "",
        followup: data.followup || "",
        notes: data.notes || "",
        starred: false,
        ownerUid: user.id,
        ownerName: user.name || user.email || "You",
        added: now,
        updated: now,
      };
      setPending((p) => ({ ...p, adds: [temp, ...p.adds] }));
      let currentId = tempId;
      try {
        const result = await authedFetch("POST", data);
        // Reconcile the temp id with the server-assigned one immediately, so the
        // dedupe in `allJobs` matches on id as soon as it can (content-matching
        // covers the remaining window before this resolves).
        if (result.id) {
          currentId = result.id;
          setPending((p) => ({
            ...p,
            adds: p.adds.map((a) => (a.id === tempId ? { ...a, id: result.id! } : a)),
          }));
        }
        toast.success("Application added 🌸 — a new tree is growing!");
      } catch (e) {
        toast.error("Save failed — " + (e as Error).message);
      } finally {
        setPending((p) => ({ ...p, adds: p.adds.filter((a) => a.id !== currentId) }));
      }
    },
    [user, authedFetch]
  );

  const bulkCreateJobs = useCallback(
    async (rows: Record<string, string>[]) => {
      if (!user || rows.length === 0) return;
      const now = new Date().toISOString();
      const tempJobs: Job[] = rows.map((data) => {
        const tempId = "tmp-" + Math.random().toString(36).slice(2);
        return {
          id: tempId,
          company: data.company || "",
          role: data.role || "",
          roleCategory: data.roleCategory || "",
          status: data.status || "Applied",
          priority: data.priority || "",
          location: data.location || "",
          date: data.date || "",
          salary: data.salary || "",
          url: data.url || "",
          recruiter: data.recruiter || "",
          followup: data.followup || "",
          notes: data.notes || "",
          starred: false,
          ownerUid: user.id,
          ownerName: user.name || user.email || "You",
          added: now,
          updated: now,
        };
      });
      const tempIds = tempJobs.map((j) => j.id);
      setPending((p) => ({ ...p, adds: [...tempJobs, ...p.adds] }));
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch("/api/applications/bulk", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ jobs: rows }),
        });
        let d: { ok?: boolean; error?: string; created?: number } = {};
        try {
          d = await res.json();
        } catch {
          d = { ok: false, error: "Bad response from server" };
        }
        if (!res.ok || !d.ok) throw new Error(d.error || `Import failed (${res.status})`);
      } catch (e) {
        toast.error("Import failed — " + (e as Error).message);
      } finally {
        setPending((p) => ({
          ...p,
          adds: p.adds.filter((a) => !tempIds.includes(a.id)),
        }));
      }
    },
    [user]
  );

  const updateJob = useCallback(
    async (id: string, data: Record<string, string>) => {
      setPending((p) => ({ ...p, patches: { ...p.patches, [id]: { ...p.patches[id], ...data } } }));
      try {
        await authedFetch("PUT", { id, ...data });
        toast.success("Updated 🌿");
      } catch (e) {
        toast.error("Save failed — " + (e as Error).message);
      } finally {
        setPending((p) => {
          const patches = { ...p.patches };
          delete patches[id];
          return { ...p, patches };
        });
      }
    },
    [authedFetch]
  );

  const toggleStar = useCallback(
    async (id: string) => {
      const current = allJobs.find((j) => j.id === id);
      if (!current) return;
      const next = !current.starred;
      setPending((p) => ({ ...p, patches: { ...p.patches, [id]: { ...p.patches[id], starred: next } } }));
      try {
        await authedFetch("PUT", { id, starred: next });
      } catch (e) {
        toast.error("Couldn't save star — " + (e as Error).message);
      } finally {
        setPending((p) => {
          const patches = { ...p.patches };
          if (patches[id]) {
            const { starred, ...rest } = patches[id]!;
            if (Object.keys(rest).length) patches[id] = rest;
            else delete patches[id];
          }
          return { ...p, patches };
        });
      }
    },
    [allJobs, authedFetch]
  );

  const deleteJob = useCallback(
    async (id: string) => {
      setPending((p) => ({ ...p, deletes: { ...p.deletes, [id]: true } }));
      try {
        await authedFetch("DELETE", { id });
        toast.success("Removed 🍂");
      } catch (e) {
        toast.error("Delete failed — " + (e as Error).message);
      } finally {
        setPending((p) => {
          const deletes = { ...p.deletes };
          delete deletes[id];
          return { ...p, deletes };
        });
      }
    },
    [authedFetch]
  );

  const [resumes, setResumes] = useState<Resume[]>([]);
  const [fetchedProfile, setFetchedProfile] = useState<UserProfile | null>(null);

  const fetchProfile = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (d.ok) setFetchedProfile(d.profile);
    } catch (e) {
      console.error("fetchProfile error", e);
    }
  }, []);

  useEffect(() => {
    if (user) fetchProfile();
    else setFetchedProfile(null);
  }, [user, fetchProfile]);

  const updateProfile = useCallback(
    async (data: Record<string, string>) => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d.error || `Update failed (${res.status})`);
        // Update the uid→name map so nav bar and all views reflect the new name immediately
        const me = getCurrentUser();
        if (data.name && me) {
          const uid = me.id;
          const newName = data.name.trim();
          setUidNameMap((prev) => {
            const next = new Map(prev);
            next.set(uid, newName);
            return next;
          });
          setUserProfiles((prev) => {
            if (!prev) return prev;
            const next = new Map(prev);
            const existing = next.get(uid);
            next.set(uid, { name: newName, color: existing?.color || resolveUserColor(uid, newName) });
            return next;
          });
        }
        await fetchProfile();
        // The next names poll will pick up the server-side change.
        toast.success("Profile updated 🌿");
      } catch (e) {
        toast.error("Profile update failed — " + (e as Error).message);
      }
    },
    [fetchProfile]
  );

  const fetchJobPosts = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/jobboard", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (d.ok) setJobPosts(d.posts as JobPost[]);
    } catch (e) {
      console.error("fetchJobPosts error", e);
    }
  }, []);

  useEffect(() => {
    if (user) fetchJobPosts();
    else setJobPosts([]);
  }, [user, fetchJobPosts]);

  const shareJob = useCallback(async (data: { company: string; role: string; url: string; location: string; notes: string }) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch("/api/jobboard", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Failed to share job");
    toast.success("Job shared with the group 💼");
    await fetchJobPosts();
  }, [fetchJobPosts]);

  const fetchResumes = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/resumes", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (d.ok) setResumes(d.resumes as Resume[]);
    } catch (e) {
      console.error("fetchResumes error", e);
    }
  }, []);

  useEffect(() => {
    if (user) fetchResumes();
    else setResumes([]);
  }, [user, fetchResumes]);

  const uploadResume = useCallback(async (title: string, file: File) => {
    const token = getToken();
    if (!token) return;
    const fileBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await fetch("/api/resumes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title, fileName: file.name, fileBase64 }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Upload failed");
    await fetchResumes();
  }, [fetchResumes]);

  const deleteResume = useCallback(async (id: string) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch("/api/resumes", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Delete failed");
    await fetchResumes();
  }, [fetchResumes]);

  const deleteJobPost = useCallback(async (id: string) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch("/api/jobboard", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Failed to delete post");
    toast.success("Post removed 🗑");
    await fetchJobPosts();
  }, [fetchJobPosts]);

  const fetchInterviewPrepPosts = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/interview-prep", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (d.ok) setInterviewPrepPosts(d.posts as InterviewPrepPost[]);
    } catch (e) {
      console.error("fetchInterviewPrepPosts error", e);
    }
  }, []);

  useEffect(() => {
    if (user) fetchInterviewPrepPosts();
    else setInterviewPrepPosts([]);
  }, [user, fetchInterviewPrepPosts]);

  const createInterviewPrepPost = useCallback(async (data: { title: string; content: string; company: string }) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch("/api/interview-prep", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Failed to create post");
    await fetchInterviewPrepPosts();
  }, [fetchInterviewPrepPosts]);

  const deleteInterviewPrepPost = useCallback(async (id: string) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch("/api/interview-prep", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Failed to delete post");
    await fetchInterviewPrepPosts();
  }, [fetchInterviewPrepPosts]);

  const fetchInterviewPrepComments = useCallback(async (postId: string) => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/interview-prep/comments?postId=${postId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (d.ok) {
        setInterviewPrepComments((prev) => ({ ...prev, [postId]: d.comments as InterviewPrepComment[] }));
      }
    } catch (e) {
      console.error("fetchInterviewPrepComments error", e);
    }
  }, []);

  const addInterviewPrepComment = useCallback(async (postId: string, text: string) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch("/api/interview-prep/comments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ postId, text }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Failed to add comment");
    await fetchInterviewPrepComments(postId);
  }, [fetchInterviewPrepComments]);

  const signOut = useCallback(() => clientSignOut(), []);

  const userColors = useMemo(
    () => new Map(userProfiles ? [...userProfiles.values()].map((p) => [p.name, p.color]) : []),
    [userProfiles]
  );

  // Resolve names for jobPosts, interviewPrepPosts, interviewPrepComments, resumes
  const resolvedJobPosts = useMemo(
    () => jobPosts.map((p) => {
      const resolved = p.ownerUid ? uidNameMap.get(p.ownerUid) : undefined;
      return resolved ? { ...p, ownerName: resolved } : p;
    }),
    [jobPosts, uidNameMap]
  );

  const resolvedInterviewPrepPosts = useMemo(
    () => interviewPrepPosts.map((p) => {
      const resolved = p.ownerUid ? uidNameMap.get(p.ownerUid) : undefined;
      return resolved ? { ...p, ownerName: resolved } : p;
    }),
    [interviewPrepPosts, uidNameMap]
  );

  const resolvedInterviewPrepComments = useMemo(() => {
    const result: Record<string, InterviewPrepComment[]> = {};
    for (const [postId, comments] of Object.entries(interviewPrepComments)) {
      result[postId] = comments.map((c) => {
        const resolved = c.userId ? uidNameMap.get(c.userId) : undefined;
        return resolved ? { ...c, userName: resolved } : c;
      });
    }
    return result;
  }, [interviewPrepComments, uidNameMap]);

  const resolvedResumes = useMemo(
    () => resumes.map((r) => {
      const resolved = r.userId ? uidNameMap.get(r.userId) : undefined;
      return resolved ? { ...r, userName: resolved } : r;
    }),
    [resumes, uidNameMap]
  );

  const sharedJobKeys = useMemo(
    () => new Set(resolvedJobPosts.map((p) => jobKey(p))),
    [resolvedJobPosts]
  );

  return {
    user,
    authReady,
    loading,
    allJobs,
    myJobs,
    feed,
    jobPosts: resolvedJobPosts,
    interviewPrepPosts: resolvedInterviewPrepPosts,
    interviewPrepComments: resolvedInterviewPrepComments,
    userColors,
    userProfiles,
    createJob,
    bulkCreateJobs,
    updateJob,
    deleteJob,
    toggleStar,
    fetchJobPosts,
    shareJob,
    deleteJobPost,
    fetchInterviewPrepPosts,
    createInterviewPrepPost,
    deleteInterviewPrepPost,
    fetchInterviewPrepComments,
    addInterviewPrepComment,
    resumes: resolvedResumes,
    fetchResumes,
    uploadResume,
    deleteResume,
    sharedJobKeys,
    signOut,
    profile: fetchedProfile,
    updateProfile,
  };
}

export type BloomApi = ReturnType<typeof useBloom>;
