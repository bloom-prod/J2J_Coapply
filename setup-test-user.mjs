import { db } from "./db/index.js";
import { users } from "./db/schema.ts";
import { signToken } from "./lib/jwt.ts";
import { hashPassword } from "./lib/jwt.ts";
import { eq } from "drizzle-orm";

async function setup() {
  try {
    // Create or update test user
    const email = "test@local.dev";
    const password = "test123456";
    
    // Check if user exists
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    let userId;
    if (existing) {
      userId = existing.id;
      console.log(`✓ Test user already exists: ${email}`);
    } else {
      // Insert new user (approved + not admin for simple testing)
      const result = await db.insert(users).values({
        email,
        name: "Test User",
        approved: true,
        isAdmin: false,
      }).returning({ id: users.id });
      
      userId = result[0].id;
      console.log(`✓ Created test user: ${email}`);
    }

    // Generate JWT token
    const token = await signToken({
      id: userId,
      email,
      isAdmin: false,
    });

    console.log("\n📋 Test User Credentials:");
    console.log(`Email: ${email}`);
    console.log(`User ID: ${userId}`);
    console.log(`\n🔐 Auth Token (save this):`);
    console.log(token);
    console.log("\n💾 To use in browser console, run:");
    console.log(`localStorage.setItem("token", "${token}")`);
    console.log(`localStorage.setItem("user", JSON.stringify({id: "${userId}", email: "${email}", name: "Test User"}))`);
    console.log(`window.location.reload()`);

  } catch (error) {
    console.error("Error setting up test user:", error);
    process.exit(1);
  }
}

setup();
