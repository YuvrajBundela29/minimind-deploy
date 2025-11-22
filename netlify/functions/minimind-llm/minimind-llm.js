// Netlify Function to handle AI API calls securely
import { OpenAIClient } from 'openai';

// Environment variables
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

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
  hi: 'Respond in Hindi.',
  // Add other languages as needed
  // ...
};

// Initialize OpenAI client
const client = new OpenAIClient({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://minimind-ai.netlify.app',
    'X-Title': 'MiniMind AI Learning Platform'
  },
  defaultQuery: { 'models': 'openai/gpt-4o-mini' }
});

// Main handler function
export const handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Parse the request body
    const body = JSON.parse(event.body);
    const { question, mode, language = 'en', action = 'explain' } = body;

    // Validate required fields
    if (!question || !mode) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Missing required fields: question and mode are required' 
        })
      };
    }

    // Get the appropriate system prompt based on mode
    const systemPrompt = modePrompts[mode] || modePrompts.beginner;
    const languageInstruction = languageInstructions[language] || languageInstructions.en;

    let messages = [];
    let response;

    // Handle different actions
    switch (action) {
      case 'explain':
        messages = [
          { role: 'system', content: `${systemPrompt} ${languageInstruction}` },
          { role: 'user', content: question }
        ];
        break;

      case 'refine':
        messages = [
          { 
            role: 'system', 
            content: `You are a helpful assistant that improves user questions to make them clearer and more specific for better educational explanations. Take the user's question and rephrase it to be more detailed, specific, and optimized for learning. Keep the core intent but make it more educational and comprehensive. ${languageInstruction}`
          },
          { 
            role: 'user', 
            content: `Please improve this question to make it better for learning: "${question}"`
          }
        ];
        break;

      case 'one-word':
        messages = [
          {
            role: 'system',
            content: `You are Ekakshar, a concise AI assistant that provides quick, accurate answers. Respond with either:
            1. A single word answer when appropriate
            2. A bullet-point summary (3-5 key points) when the question asks for explanation or summary
            3. A brief phrase for definitions
            
            Be precise and to the point. Format bullet points with "•" at the start of each line.
            ${languageInstruction}`
          },
          { role: 'user', content: question }
        ];
        break;

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }

    // Make the API call to OpenRouter
    const completion = await client.chat.completions.create({
      model: 'openai/gpt-4o-mini',
      messages,
      temperature: action === 'one-word' ? 0.3 : 0.7,
      max_tokens: 2000,
      stream: false
    });

    // Extract the response
    const content = completion.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in API response');
    }

    // Return the successful response
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        content,
        mode,
        language
      })
    };

  } catch (error) {
    console.error('Error in Netlify Function:', error);
    
    return {
      statusCode: error.statusCode || 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal Server Error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
