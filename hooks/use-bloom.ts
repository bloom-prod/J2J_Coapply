"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  updateProfile as fbUpdateProfile,
  type User,
} from "firebase/auth";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { toast } from "sonner";
import { auth, db } from "@/lib/firebase";
import type { FeedEvent, Job, JobPost, Resume, UserProfile, InterviewPrepPost, InterviewPrepComment } from "@/lib/types";

const USER_COLORS = ["#E07BA0","#7BB87B","#78AEDE","#DDB060","#A87BD4","#5FC5C5","#E8895A"];
const NAME_COLOR_OVERRIDES: Record<string, string> = { "Shruti": "#FF69B4" }; // hot pink

async function ensureUserProfile(_uid: string, _name: string, _email: string | null) {
  // Disabled Firestore access - user profiles not stored in Firestore
  // Just using static color system instead
  return;
}

function tsToISO(t: unknown): string {
  try {
    const v = t as Timestamp | undefined;
    return v && typeof v.toDate === "function" ? v.toDate().toISOString() : "";
  } catch {
    return "";
  }
}

function mapDoc(d: QueryDocumentSnapshot<DocumentData>): Job {
  const x = d.data();
  return {
    id: d.id,
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
    starred: x.starred === true || x.starred === "true",
    ownerUid: x.ownerUid || "",
    ownerName: "",
    added: tsToISO(x.createdAt),
    updated: tsToISO(x.updatedAt),
  };
}

function mapFeed(d: QueryDocumentSnapshot<DocumentData>): FeedEvent {
  const x = d.data();
  const ts = x.ts as Timestamp | undefined;
  return {
    type: (x.type as FeedEvent["type"]) || "applied",
    company: x.company || "",
    role: x.role || "",
    status: x.status || "",
    ownerUid: x.ownerUid || "",
    ownerName: "",
    ts: ts && typeof ts.toDate === "function" ? ts.toDate() : null,
  };
}

interface Pending {
  adds: Job[];
  patches: Record<string, Partial<Job>>;
  deletes: Record<string, true>;
}

const EMPTY_PENDING: Pending = { adds: [], patches: {}, deletes: {} };

export function useBloom() {
  const [user, setUser] = useState<User | null>(null);
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

  // ---- user profiles — live listener for uid→name resolution ----
  const applyProfileSnapshot = useCallback((snap: { docs: QueryDocumentSnapshot<DocumentData>[] }) => {
    const names = new Map<string, string>();
    const profiles = new Map<string, { name: string; color: string }>();
    snap.docs.forEach((d, i) => {
      const data = d.data();
      const name = (data.name as string) || "Someone";
      const color = NAME_COLOR_OVERRIDES[name] || (data.color as string) || USER_COLORS[i % USER_COLORS.length];
      names.set(d.id, name);
      profiles.set(d.id, { name, color });
    });
    setUidNameMap(names);
    setUserProfiles(profiles);
    // Signal profiles ready; clear loading if apps snapshot already arrived
    profilesReady.current = true;
    if (!firstSnap.current) setLoading(false);
  }, []);

  // ---- auth ----
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        const name = u.displayName || u.email || "Someone";
        ensureUserProfile(u.uid, name, u.email).catch(console.error);
      }
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

  // ---- live snapshots ----
  useEffect(() => {
    if (!user) return;
    firstSnap.current = true;
    profilesReady.current = false;
    setLoading(true);

    const unsubApps = onSnapshot(
      collection(db, "applications"),
      (snap) => {
        setServerJobs(snap.docs.map(mapDoc));
        if (firstSnap.current) {
          firstSnap.current = false;
          // Only clear loading once the profiles snapshot has also arrived,
          // so uidNameMap is populated before any name-resolved data renders.
          if (profilesReady.current) setLoading(false);
        }
      },
      (err) => console.error("applications snapshot error", err)
    );

    const unsubFeed = onSnapshot(
      query(collection(db, "feed"), orderBy("ts", "desc"), limit(10)),
      (snap) => setRawFeed(snap.docs.map(mapFeed)),
      (err) => console.error("feed snapshot error", err)
    );

    const unsubProfiles = onSnapshot(
      collection(db, "userProfiles"),
      (snap) => applyProfileSnapshot(snap),
      (err) => {
        console.error("userProfiles snapshot error", err);
        // Fallback: use current user info
        const u = auth.currentUser;
        if (!u) return;
        const name = u.displayName || u.email || "Someone";
        setUidNameMap(new Map([[u.uid, name]]));
        setUserProfiles(new Map([[u.uid, { name, color: USER_COLORS[0] }]]));
        profilesReady.current = true;
        if (!firstSnap.current) setLoading(false);
      }
    );

    return () => {
      unsubApps();
      unsubFeed();
      unsubProfiles();
    };
  }, [user, applyProfileSnapshot]);

  // ---- derived: merge server data with optimistic overlay + resolve names ----
  const allJobs = useMemo<Job[]>(() => {
    const patched = serverJobs
      .filter((j) => !pending.deletes[j.id])
      .map((j) => (pending.patches[j.id] ? { ...j, ...pending.patches[j.id] } : j));
    const adds = pending.adds.filter((a) => !serverJobs.some((s) => s.id === a.id));
    const list = [...adds, ...patched].map((j) => ({
      ...j,
      ownerName: (j.ownerUid ? uidNameMap.get(j.ownerUid) : undefined) ?? j.ownerName,
    }));
    list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return list;
  }, [serverJobs, pending, uidNameMap]);

  const myJobs = useMemo<Job[]>(
    () => allJobs.filter((j) => j.ownerUid === user?.uid),
    [allJobs, user]
  );

  // Resolve feed names from uid→name map
  const feed = useMemo<FeedEvent[]>(
    () => rawFeed.map((e) => ({
      ...e,
      ownerName: (e.ownerUid ? uidNameMap.get(e.ownerUid) : undefined) ?? e.ownerName,
    })),
    [rawFeed, uidNameMap]
  );

  // ---- writes (through the TS API, with optimistic overlay) ----
  const authedFetch = useCallback(
    async (method: string, body: Record<string, unknown>) => {
      const token = await auth.currentUser!.getIdToken();
      const res = await fetch("/api/applications", {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let d: { ok?: boolean; error?: string } = {};
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
        ownerUid: user.uid,
        ownerName: user.displayName || user.email || "You",
        added: now,
        updated: now,
      };
      setPending((p) => ({ ...p, adds: [temp, ...p.adds] }));
      toast.success("Application added 🌸 — a new tree is growing!");
      try {
        await authedFetch("POST", data);
      } catch (e) {
        toast.error("Save failed — " + (e as Error).message);
      } finally {
        setPending((p) => ({ ...p, adds: p.adds.filter((a) => a.id !== tempId) }));
      }
    },
    [user, authedFetch]
  );

  const updateJob = useCallback(
    async (id: string, data: Record<string, string>) => {
      setPending((p) => ({ ...p, patches: { ...p.patches, [id]: { ...p.patches[id], ...data } } }));
      toast.success("Updated 🌿");
      try {
        await authedFetch("PUT", { id, ...data });
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
      toast.success("Removed 🍂");
      try {
        await authedFetch("DELETE", { id });
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
    if (!auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
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
      if (!auth.currentUser) return;
      try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d.error || `Update failed (${res.status})`);
        // Update client-side Firebase Auth displayName so nav bar reflects change immediately
        if (data.name && auth.currentUser) {
          await fbUpdateProfile(auth.currentUser, { displayName: data.name.trim() });
          // Optimistically update uid→name map so all views reflect the new name immediately
          const uid = auth.currentUser.uid;
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
            next.set(uid, { name: newName, color: existing?.color || USER_COLORS[0] });
            return next;
          });
        }
        await fetchProfile();
        // The onSnapshot listener on userProfiles will automatically pick up the server-side change
        toast.success("Profile updated 🌿");
      } catch (e) {
        toast.error("Profile update failed — " + (e as Error).message);
      }
    },
    [fetchProfile]
  );

  const fetchJobPosts = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    const fileBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
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
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("/api/interview-prep/comments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ postId, text }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || "Failed to add comment");
    await fetchInterviewPrepComments(postId);
  }, [fetchInterviewPrepComments]);

  const signOut = useCallback(() => fbSignOut(auth), []);

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
    () => new Set(resolvedJobPosts.map((p) => `${p.company}|${p.role}|${p.url}`)),
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
    createJob,
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
