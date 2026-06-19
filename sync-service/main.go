package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// Config from environment
var (
	internalAPIBase = getEnv("INTERNAL_API_BASE", "http://web:3000")
	internalSecret  = getEnv("INTERNAL_API_SECRET", "dev-secret")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Types
type userConfig struct {
	UID          string  `json:"uid"`
	RepoURL      string  `json:"repoUrl"`
	LastSyncedAt *string `json:"lastSyncedAt"`
}

type problemSync struct {
	UID      string    `json:"uid"`
	Problems []problem `json:"problems"`
}

type problem struct {
	ProblemID  string    `json:"problemId"`
	Title      string    `json:"title"`
	Difficulty string    `json:"difficulty"`
	Language   string    `json:"language"`
	CommitHash string    `json:"commitHash"`
	SolvedAt   time.Time `json:"solvedAt"`
}

type gitHubCommit struct {
	SHA    string      `json:"sha"`
	Commit commitInner `json:"commit"`
}

type commitInner struct {
	Message string      `json:"message"`
	Author  commitAuthor `json:"author"`
}

type commitAuthor struct {
	Date time.Time `json:"date"`
}

type statsJSON struct {
	LeetCode struct {
		Shas map[string]map[string]interface{} `json:"shas"`
	} `json:"leetcode"`
}

// Entry point
func main() {
	fmt.Printf("LeetCode Sync Service starting...\n")
	fmt.Printf("Internal API: %s\n", internalAPIBase)

	if os.Getenv("SINGLE_RUN") != "" {
		fmt.Println("Single run mode")
		if err := syncAll(); err != nil {
			fmt.Printf("Sync failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("Single run complete")
		return
	}

	for {
		if err := syncAll(); err != nil {
			fmt.Printf("Sync error: %v\n", err)
		}
		sleep := 3 * time.Hour
		fmt.Printf("[%s] Sleeping for %v until next sync...\n", time.Now().Format(time.RFC3339), sleep)
		time.Sleep(sleep)
	}
}

func syncAll() error {
	fmt.Printf("[%s] Starting sync...\n", time.Now().Format(time.RFC3339))
	users, err := getUsersToSync()
	if err != nil {
		return fmt.Errorf("fetch users: %w", err)
	}
	if len(users) == 0 {
		fmt.Println("No users with LeetCode repos configured")
		return nil
	}
	fmt.Printf("Found %d users to sync\n", len(users))

	for _, u := range users {
		if err := syncUser(u); err != nil {
			fmt.Printf("Sync failed for user %s: %v\n", u.UID, err)
		} else {
			fmt.Printf("User %s synced successfully\n", u.UID)
		}
	}
	return nil
}

func getUsersToSync() ([]userConfig, error) {
	url := internalAPIBase + "/api/leetcode/sync"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-internal-secret", internalSecret)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("internal API returned %d: %s", resp.StatusCode, string(body))
	}
	var data struct {
		Users []userConfig `json:"users"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data.Users, nil
}

func parseRepoURL(raw string) (owner, repo string) {
	raw = strings.TrimSuffix(raw, ".git")
	raw = strings.TrimSuffix(raw, "/")
	if strings.HasPrefix(raw, "https://github.com/") {
		parts := strings.Split(raw[len("https://github.com/"):], "/")
		if len(parts) >= 2 {
			return parts[0], parts[1]
		}
	}
	if strings.HasPrefix(raw, "http://github.com/") {
		parts := strings.Split(raw[len("http://github.com/"):], "/")
		if len(parts) >= 2 {
			return parts[0], parts[1]
		}
	}
	return "", ""
}

func fetchStatsJSON(owner, repo string) (*statsJSON, error) {
	url := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/main/stats.json", owner, repo)
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("stats.json not found (%s)", resp.Status)
	}
	var s statsJSON
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return nil, err
	}
	return &s, nil
}

// fetchCommits fetches commits from GitHub API. For public repos, unauthenticated requests are rate-limited to 60/hour.
func fetchCommits(owner, repo string, since *time.Time) ([]gitHubCommit, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/commits?per_page=100", owner, repo)
	if since != nil {
		url += "&since=" + since.Format(time.RFC3339)
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "bloom-tracker-sync")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API %d: %s", resp.StatusCode, string(body))
	}
	var commits []gitHubCommit
	if err := json.NewDecoder(resp.Body).Decode(&commits); err != nil {
		return nil, err
	}
	return commits, nil
}

var statDelimiter = regexp.MustCompile(`(?i)\s+(Stats:|Time:|\|)\s*`)

func parseCommitMessage(msg string) (problemID, title string) {
	msg = strings.TrimSpace(msg)

	// Strip LeetHub / LeetSync suffix
	if i := strings.Index(msg, " - LeetHub"); i > 0 {
		msg = msg[:i]
	}
	if i := strings.Index(msg, " - LeetSync"); i > 0 {
		msg = msg[:i]
	}

	// Take first line only
	if i := strings.Index(msg, "\n"); i > 0 {
		msg = msg[:i]
	}

	// Split on common delimiters
	parts := statDelimiter.Split(msg, 2)
	ident := strings.TrimSpace(parts[0])
	if ident == "" {
		return "", ""
	}

	problemID = strings.ToLower(ident)

	// Build title: remove leading number prefix, capitalize words
	titlePart := ident
	if i := strings.IndexFunc(titlePart, func(r rune) bool {
		return r >= 'a' && r <= 'z'
	}); i >= 0 {
		titlePart = titlePart[i:]
	}
	// For the case where it's ALL CAPS
	if i := strings.IndexFunc(titlePart, func(r rune) bool {
		return r >= 'A' && r <= 'Z'
	}); i >= 0 {
		titlePart = titlePart[i:]
	}
	words := strings.Split(strings.ToLower(titlePart), "-")
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	title = strings.Join(words, " ")

	return problemID, title
}

var extToLang = map[string]string{
	"cpp": "C++", "cc": "C++", "cxx": "C++", "c++": "C++",
	"py": "Python", "py3": "Python",
	"java": "Java",
	"js": "JavaScript", "jsx": "JavaScript",
	"ts": "TypeScript", "tsx": "TypeScript",
	"go": "Go",
	"rs": "Rust",
	"rb": "Ruby",
	"cs": "C#",
	"swift": "Swift",
	"kt": "Kotlin",
	"php": "PHP",
	"c": "C",
	"r": "R",
	"scala": "Scala",
	"dart": "Dart",
}

func detectLanguage(fileName string) string {
	if i := strings.LastIndex(fileName, "."); i > 0 {
		ext := strings.ToLower(fileName[i+1:])
		if lang, ok := extToLang[ext]; ok {
			return lang
		}
		return strings.ToUpper(ext[:1]) + ext[1:]
	}
	return "Unknown"
}

func buildProblemMeta(stats *statsJSON) map[string]struct{ difficulty, language string } {
	m := make(map[string]struct{ difficulty, language string })
	for pid, files := range stats.LeetCode.Shas {
		// Skip meta entries
		if pid == "README.md" || pid == "stats.json" {
			continue
		}
		var diff string
		var lang string
		for key, val := range files {
			if strings.ToLower(key) == "difficulty" {
				if s, ok := val.(string); ok {
					diff = strings.ToUpper(s[:1]) + s[1:] // easy -> Easy
				}
			} else if strings.HasPrefix(key, pid) && strings.Contains(key, ".") {
				// This is the solution file, e.g., "0001-two-sum.cpp"
				lang = detectLanguage(key)
			}
		}
		if diff != "" && lang != "" {
			m[pid] = struct{ difficulty, language string }{diff, lang}
		}
	}
	return m
}

func syncUser(u userConfig) error {
	owner, repo := parseRepoURL(u.RepoURL)
	if owner == "" || repo == "" {
		return fmt.Errorf("could not parse repo URL: %s", u.RepoURL)
	}

	fmt.Printf("Syncing user %s repo %s/%s\n", u.UID, owner, repo)

	// Fetch stats.json to build problem metadata
	stats, err := fetchStatsJSON(owner, repo)
	if err != nil {
		return fmt.Errorf("fetch stats.json: %w", err)
	}
	meta := buildProblemMeta(stats)
	fmt.Printf("  Found %d problems in stats.json\n", len(meta))

	// Fetch commits since last sync
	var since *time.Time
	if u.LastSyncedAt != nil && *u.LastSyncedAt != "" {
		t, err := time.Parse(time.RFC3339, *u.LastSyncedAt)
		if err == nil {
			since = &t
		}
	}

	commits, err := fetchCommits(owner, repo, since)
	if err != nil {
		return fmt.Errorf("fetch commits: %w", err)
	}
	fmt.Printf("  Found %d new commits\n", len(commits))

	var problems []problem
	seen := make(map[string]bool)
	for _, c := range commits {
		pid, title := parseCommitMessage(c.Commit.Message)
		if pid == "" {
			continue
		}
		if seen[pid] {
			continue // Keep earliest (first seen since commits are newest-first)
		}
		seen[pid] = true

		m, ok := meta[pid]
		if !ok {
			continue // Skip if not in stats.json (can't determine difficulty/language)
		}

		problems = append(problems, problem{
			ProblemID:  pid,
			Title:      title,
			Difficulty: m.difficulty,
			Language:   m.language,
			CommitHash: c.SHA,
			SolvedAt:   c.Commit.Author.Date,
		})
	}

	if len(problems) == 0 {
		fmt.Printf("  No new problems found\n")
		return nil
	}

	// Post to internal API
	payload := problemSync{UID: u.UID, Problems: problems}
	if err := postSync(payload); err != nil {
		return fmt.Errorf("post sync: %w", err)
	}
	fmt.Printf("  Synced %d problems\n", len(problems))
	return nil
}

func postSync(payload problemSync) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	url := internalAPIBase + "/api/leetcode/sync"
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-secret", internalSecret)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		rb, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("internal API %d: %s", resp.StatusCode, string(rb))
	}
	return nil
}
