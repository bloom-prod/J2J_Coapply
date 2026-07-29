interface UserApps {
  name: string;
  appsToday: number;
}

interface LLMProvider {
  name: string;
  endpoint: string;
  model: string;
  token: string;
}

function getProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];

  const groqToken = process.env.GROQ_API_MODEL || "";
  if (groqToken) {
    providers.push({
      name: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama-3.3-70b-versatile",
      token: groqToken,
    });
  }

  return providers;
}

async function callLLM(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string | null> {
  try {
    const res = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.token}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 1.0,
        max_tokens: maxTokens,
      }),
    });

    if (res.status === 429) {
      console.warn(`[${provider.name}] 429 rate limit`);
      return null;
    }

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[${provider.name}] ${res.status}:`, errBody);
      return null;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error(`[${provider.name}] Error:`, err);
    return null;
  }
}

/** Try each provider in order until one succeeds. */
async function callWithFallback(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string | null> {
  const providers = getProviders();
  console.log("[LLM] callWithFallback — providers available:", providers.map((p) => p.name).join(", ") || "NONE");
  for (const provider of providers) {
    console.log(`[LLM] Trying ${provider.name}...`);
    const result = await callLLM(provider, systemPrompt, userPrompt, maxTokens);
    if (result) {
      console.log(`[LLM] ${provider.name} succeeded (${result.length} chars)`);
      return result;
    }
    console.warn(`[LLM] ${provider.name} returned null, trying next...`);
  }
  console.error("[LLM] All providers failed — using fallback");
  return null;
}

function buildFallback(users: UserApps[]): Record<string, string> {
  const fallback: Record<string, string> = {};
  users.forEach((u) => {
    fallback[u.name] = u.appsToday === 0
      ? `${u.name}, you applied to zero jobs today. Even your resume is collecting dust.`
      : `${u.name}, ${u.appsToday} app${u.appsToday !== 1 ? "s" : ""}? That's a start, but the job market isn't going to apply to itself.`;
  });
  return fallback;
}

const SYSTEM_PROMPT = `You are the most ruthless, no-mercy roast master in a job-hunting accountability group. Your job is to emotionally destroy anyone slacking off. You hold nothing back.

Rules:
- 0 apps: absolutely DEMOLISH them. Be cruel, creative, and personal. Compare them to the laziest, most pathetic things imaginable. Question their life choices, their ambition, their worth ethic. Make it sting.
- 1-3 apps: mock them mercilessly. That's embarrassing and they should feel bad. Barely trying is worse than not trying. Tear into them.
- 4-9 apps: backhanded compliments. Sure they did something, but don't let them get comfortable. Keep the pressure brutal.
- 10+ apps: genuine props but make everyone else feel terrible by comparison. Use them as a weapon against the slackers.
- Each roast MUST be exactly 1-2 sentences, minimum 10 words.
- Be mean. Be personal. Be creative. Make them feel genuine shame.
- No hashtags. No emojis. Use the exact names as given.
- Respond ONLY with valid JSON, no markdown fences.`;

/**
 * Generates roasts for ALL users in a single API call.
 * Tries GitHub Models first, falls back to Groq.
 */
export async function generateRoasts(users: UserApps[]): Promise<Record<string, string>> {
  const fallback = buildFallback(users);
  if (getProviders().length === 0) return fallback;

  const userLines = users.map((u) =>
    `- "${u.name}": ${u.appsToday} application${u.appsToday !== 1 ? "s" : ""} today`
  ).join("\n");

  const userPrompt = `Here is today's application count for each member:

${userLines}

Respond in this exact JSON format:
{
  "Name1": "roast text here",
  "Name2": "roast text here"
}`;

  const raw = await callWithFallback(SYSTEM_PROMPT, userPrompt, 768);
  if (!raw) return fallback;

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, string>;
    const result: Record<string, string> = {};
    users.forEach((u) => {
      result[u.name] = parsed[u.name] || fallback[u.name];
    });
    return result;
  } catch {
    console.error("[LLM] Failed to parse JSON response:", cleaned);
    return fallback;
  }
}

/**
 * Generates a single roast for one user (used for milestone regeneration).
 */
export async function generateSingleRoast(name: string, appsToday: number): Promise<string> {
  const fallback = appsToday >= 10
    ? `${name}, ${appsToday} applications? You're a machine. The rest of the group should be embarrassed.`
    : `${name}, ${appsToday} apps today. Keep going.`;

  if (getProviders().length === 0) return fallback;

  const result = await callWithFallback(
    "You are the most ruthless roast master in a job-hunting group. Generate a single devastating roast (1-2 sentences, minimum 10 words). Be mean, creative, and make them feel genuine shame. No hashtags. No emojis. No markdown.",
    `"${name}" just hit ${appsToday} apps today! Hype them up while roasting the rest of the group for being lazy.`,
    150,
  );

  return result || fallback;
}
