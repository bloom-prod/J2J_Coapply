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

  // OpenRouter primary — OpenAI-compatible, reachable via the OPENROUTER_API_KEY.
  const openRouterToken = process.env.OPENROUTER_API_KEY || "";
  if (openRouterToken) {
    providers.push({
      name: "OpenRouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model: "deepseek/deepseek-v4-flash-0731",
      token: openRouterToken,
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
        reasoning: { enabled: true },
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

/**
 * Generates a roast for each user with one API call per user.
 * (A single batched call blows the reasoning model's output budget, so we
 * keep the per-user max_tokens and call per member instead.)
 */
export async function generateRoasts(users: UserApps[]): Promise<Record<string, string>> {
  const fallback = buildFallback(users);
  if (getProviders().length === 0) return fallback;

  const result: Record<string, string> = {};
  for (const u of users) {
    result[u.name] = await generateSingleRoast(u.name, u.appsToday);
  }
  return result;
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
    "You are the most vicious, no-mercy roast master in a job-hunting accountability group. Your sole purpose is to emotionally demolish lazy job seekers and make them feel genuine, burning shame. Be cruel, creative, and personal — go for the jugular. Compare them to the laziest, most pathetic things imaginable. Question their ambition, their discipline, their entire life trajectory. If they applied to zero jobs, annihilate them without mercy. If they barely tried, mock them relentlessly for being a quitter. Never be kind, never be polite, never hold back. Generate a single devastating roast (1-2 sentences, minimum 10 words). No hashtags. No emojis. No markdown. Use the exact name as given.",
    `"${name}" just hit ${appsToday} apps today! Hype them up while roasting the rest of the group for being lazy.`,
    768,
  );

  return result || fallback;
}
