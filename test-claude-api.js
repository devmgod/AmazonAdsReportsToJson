import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY, // or paste directly for test
});

async function testKey() {
  const apiKey = process.env.CLAUDE_API_KEY;
  
  // Show first and last few characters of the key for verification (without exposing full key)
  if (apiKey) {
    const keyPreview = apiKey.length > 20 
      ? `${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 10)}`
      : "***";
    console.log("Testing API key:", keyPreview);
    console.log("Key length:", apiKey.length);
  } else {
    console.error("❌ CLAUDE_API_KEY not found in environment variables");
    return;
  }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 10,
      messages: [{ role: "user", content: "Ping" }],
    });

    console.log("✅ API key is VALID");
    console.log("Response:", msg);
  } catch (err) {
    console.error("❌ API key is INVALID or restricted");
    console.error("Status:", err.status);
    console.error("Message:", err.message);
    console.error("Full error:", err);
  }
}

testKey();

