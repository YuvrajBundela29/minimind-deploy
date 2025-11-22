// Netlify Function to handle AI API calls securely using OpenRouter
// This file is written in pure CommonJS for maximum Netlify compatibility.

// Environment variable: set this in Netlify UI as OPENROUTER_API_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Basic validation so we fail fast if the key is missing
if (!OPENROUTER_API_KEY) {
  // Logged once at cold start in Netlify logs
  console.error('OPENROUTER_API_KEY is not set. Configure it in Netlify environment variables.');
}

// Mode-specific prompts (same as in the frontend)
const modePrompts = {
  beginner: `You are a friendly, patient teacher explaining concepts to children ages 5-10. Use simple analogies, toys, cartoons, and everyday examples. Be cheerful, encouraging, and use emojis. Keep sentences short and fun. Always provide COMPLETE explanations. If you include formulas, wrap them in [brackets] like [E=mc²]. End with a warm, encouraging question like "Does that make sense, buddy?" or "Want to learn more about this?".`,

  thinker: `You are a cool, knowledgeable teacher explaining concepts to teenagers and college students. Use pop culture references, memes, and real-world applications. Be casual but structured. Explain why things matter and how they apply to real life. Use some humor and sarcasm when appropriate. Make it relatable and engaging. Always provide COMPLETE explanations. For formulas, use [formula] notation like [BDP = Bandwidth × RTT].`,

  story: `You are a friendly storyteller who explains everything through simple, fun stories. Create a very short story like you're telling it to a friend. Use everyday objects, animals, or people as characters. Keep sentences short and words simple. Start with "Once upon a time" or "Imagine if..." and tell a tiny story that naturally explains the concept. Make it feel like a bedtime story - warm, simple, and easy to understand. No complex words or long explanations. Just a sweet, simple story that teaches the idea.`,

  mastery: `You are an academic expert providing comprehensive, research-level explanations. Start with an abstract overview, then break down into theory, models, and formulas. Reference real-world applications in major companies and research. Use technical terminology appropriately. For mathematical formulas, use proper notation within [brackets] like [TCP_Throughput = (MSS/RTT) × sqrt(3/2) / sqrt(p)]. End with thought-provoking Socratic questions. Be thorough and rigorous.`
};

// Language instructions (simplified for backend)
const languageInstructions = {
  en: 'Respond in English.',
  hi: 'Respond in Hindi.'
  // Add other languages as needed
};

// Helper: build messages for different actions
function buildMessages({ question, mode, language, action }) {
  const systemPrompt = modePrompts[mode] || modePrompts.beginner;
  const languageInstruction = languageInstructions[language] || languageInstructions.en;

  switch (action) {
    case 'explain':
      return [
        { role: 'system', content: `${systemPrompt} ${languageInstruction}` },
        { role: 'user', content: question }
      ];

    case 'refine':
      return [
        {
          role: 'system',
          content:
            `You are a helpful assistant that improves user questions to make them clearer and more specific for better educational explanations. ` +
            `Take the user's question and rephrase it to be more detailed, specific, and optimized for learning. ` +
            `Keep the core intent but make it more educational and comprehensive. ${languageInstruction}`
        },
        {
          role: 'user',
          content: `Please improve this question to make it better for learning: "${question}"`
        }
      ];

    case 'one-word':
      return [
        {
          role: 'system',
          content:
            `You are Ekakshar, a concise AI assistant that provides quick, accurate answers. ` +
            `Respond with either (1) a single word answer when appropriate, (2) a bullet-point summary (3-5 key points) when the question asks for explanation or summary, ` +
            `(3) a brief phrase for definitions. Be precise and to the point. Format bullet points with "•" at the start of each line. ` +
            languageInstruction
        },
        { role: 'user', content: question }
      ];

    default:
      return null;
  }
}

// Main handler function
exports.handler = async (event, context) => {
  const requestId = context && context.awsRequestId ? context.awsRequestId : `req-${Date.now()}`;

  // Basic method guard
  if (event.httpMethod !== 'POST') {
    console.warn(`[${requestId}] Method not allowed: ${event.httpMethod}`);
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
    };
  }

  // Log incoming request (without body content in case it grows large)
  console.log(`[${requestId}] Incoming request`, {
    path: event.path,
    httpMethod: event.httpMethod,
    headers: {
      'user-agent': event.headers && event.headers['user-agent'],
      origin: event.headers && event.headers.origin
    }
  });

  try {
    if (!OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY is not configured on the server');
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Missing request body' })
      };
    }

    const body = JSON.parse(event.body);
    const { question, mode, language = 'en', action = 'explain' } = body;

    if (!question || !mode) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: question and mode are required'
        })
      };
    }

    const messages = buildMessages({ question, mode, language, action });
    if (!messages) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid action' })
      };
    }

    const temperature = action === 'one-word' ? 0.3 : 0.7;

    // Call OpenRouter using native fetch (Node 18+)
    const apiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://minimind-ai.netlify.app',
        'X-Title': 'MiniMind AI Learning Platform'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages,
        temperature,
        max_tokens: 2000,
        stream: false
      })
    });

    const rawText = await apiResponse.text();

    if (!apiResponse.ok) {
      console.error(`[${requestId}] OpenRouter error`, {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        body: rawText
      });

      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Upstream AI provider error',
          status: apiResponse.status,
          statusText: apiResponse.statusText
        })
      };
    }

    let completion;
    try {
      completion = JSON.parse(rawText);
    } catch (parseErr) {
      console.error(`[${requestId}] Failed to parse OpenRouter JSON`, { rawText });
      throw new Error('Failed to parse AI provider response');
    }

    let content =
      completion &&
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content;

    if (!content) {
      console.error(`[${requestId}] No content field in OpenRouter response`, { completion });
      throw new Error('No content in AI response');
    }

    // OpenRouter / OpenAI can sometimes return structured content (arrays of parts).
    // Normalize to a simple string so the frontend can safely call .replace, etc.
    if (Array.isArray(content)) {
      content = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part.text === 'string') return part.text;
          return JSON.stringify(part);
        })
        .join(' ');
    } else if (typeof content !== 'string') {
      content = String(content);
    }

    const responsePayload = {
      success: true,
      content,
      mode,
      language
    };

    console.log(`[${requestId}] Successful AI response`, {
      mode,
      language,
      action,
      contentPreview: String(content).slice(0, 120)
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responsePayload)
    };
  } catch (err) {
    console.error(`[${requestId}] Error in minimind-llm function`, {
      message: err.message,
      stack: err.stack
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'AI service unavailable: API request failed'
      })
    };
  }
};
