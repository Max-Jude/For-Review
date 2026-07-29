import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;

if (apiKey) {
  aiClient = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

// Academic Assistant System Prompt incorporating PDF instructions
const SYSTEM_INSTRUCTIONS = `
You are "De Wisdom AI Academic Assistant", an intelligent, polite, and friendly academic tutor and teaching assistant for students and staff of De Wisdom Comprehensive Academy.

STUDENT GUIDELINES:
- Your role is to help students understand their assignments, not to do the work entirely for them.
- Explain concepts clearly and step-by-step based on the student's level.
- Break down difficult questions into simple parts.
- Encourage learning, critical thinking, and problem solving.
- Provide practical examples where helpful.
- Do NOT just give final answers without explanation. Teach the student!
- For math and science, show detailed workings and methods.
- Ask follow-up questions if the student's request is unclear.
- Be polite, supportive, encouraging, and motivating.

STAFF / TEACHER GUIDELINES:
- Help teachers create structured 45-minute lesson plans, schemes of work, and teaching strategies.
- Help generate quiz/exam questions with marking guides for Senior and Junior Secondary classes.
- Assist in simplifying complex topics into engaging class activities.

STRICT FORMATTING RULES (CRITICAL):
- Respond in simple, clean, readable text.
- Do NOT use symbols like $, $$, LaTeX, or equations formatting (e.g., no \\frac, no \\sqrt).
- Write all formulas in simple plain text (e.g., v = d/t, KE = 1/2 mv^2, A = pi * r^2). Use ^ for exponents (x^2) and / for fractions.
- Do NOT use markdown headings like ### or long separators like --.
- Format all responses cleanly with short paragraphs and bullet points where helpful.
- Highlight key terms using bold (e.g., **key term**) so users can quickly grasp important concepts.
- Keep chat replies concise, clear, and well-structured.
`;

// API Endpoint for AI Chatbot
app.post("/api/ai/chat", async (req, res) => {
  try {
    const { prompt, userRole, history } = req.body;

    if (!prompt) {
      return res.status(400).json({ status: "error", message: "Prompt is required" });
    }

    // Check if API key is initialized
    if (!process.env.GEMINI_API_KEY) {
      // Return clear informative fallback if key is missing
      const fallbackReply = getFallbackAcademicReply(prompt, userRole);
      return res.json({
        status: "success",
        reply: fallbackReply,
        note: "Local offline assistant mode"
      });
    }

    if (!aiClient) {
      aiClient = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
    }

    const roleContext = userRole === 'staff'
      ? "User is a Staff/Teacher at De Wisdom Comprehensive Academy."
      : "User is a Student at De Wisdom Comprehensive Academy.";

    const contents = [
      {
        role: "user",
        parts: [
          { text: `${roleContext}\n\nUser Question: ${prompt}` }
        ]
      }
    ];

    const response = await aiClient.models.generateContent({
      model: "gemini-3.6-flash",
      contents: contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS,
        temperature: 0.7,
      }
    });

    const replyText = response.text || "I am sorry, I could not generate an academic response at this moment. Please try rephrasing your question.";

    return res.json({
      status: "success",
      reply: replyText
    });

  } catch (error: any) {
    console.error("Gemini AI Chat Error:", error);
    // Fallback response for continuity
    const fallbackReply = getFallbackAcademicReply(req.body.prompt || "", req.body.userRole || "student");
    return res.json({
      status: "success",
      reply: fallbackReply,
      errorMsg: error?.message
    });
  }
});

// Fallback logic for offline / missing API key situations
function getFallbackAcademicReply(prompt: string, role: string): string {
  const lower = prompt.toLowerCase();

  if (role === 'staff') {
    if (lower.includes('lesson plan') || lower.includes('lesson')) {
      return "Here is a structured **45-minute Lesson Plan Framework**:\n\n1. **Topic Introduction (5 mins)**: Hook students with an engaging question or real-world example.\n2. **Core Explanation (15 mins)**: Break the topic into 2 main concepts with diagram/board illustrations.\n3. **Guided Class Activity (15 mins)**: Group work or solving sample problems on the board.\n4. **Summary & Evaluation (10 mins)**: Quick 3-question quiz and homework assignment.";
    }
    if (lower.includes('question') || lower.includes('quiz') || lower.includes('exam')) {
      return "Here are sample **Assessment Questions**:\n\n1. Define the core key term and state two practical applications in daily life.\n2. Differentiate between primary and secondary processes with relevant examples.\n3. Solve for x when given the standard relationship formula.\n\n**Marking Scheme**: 2 marks for definition, 4 marks for explanation, 4 marks for calculation steps.";
    }
    return "As **De Wisdom AI Academic Assistant**, I am here to assist staff with lesson plans, schemes of work, marking schemes, and interactive teaching methods. How can I support your classroom preparation today?";
  }

  // Student fallbacks
  if (lower.includes('quadratic') || lower.includes('math') || lower.includes('equation')) {
    return "Let us break down solving a **Quadratic Equation** step-by-step:\n\nStandard form: **a*x^2 + b*x + c = 0**\n\n1. **Identify Coefficients**: Find values for a, b, and c.\n2. **Quadratic Formula**: x = (-b +/- sqrt(b^2 - 4*a*c)) / (2*a)\n3. **Calculate Discriminant**: Evaluate b^2 - 4*a*c to check if roots are real.\n4. **Substitute**: Plug values into the formula to find x1 and x2.\n\nWould you like us to try solving an example together?";
  }
  if (lower.includes('photosynthesis') || lower.includes('biology')) {
    return "**Photosynthesis** is the process where green plants convert light energy into chemical energy (food).\n\n**Equation**: 6CO2 + 6H2O + Light -> C6H12O6 + 6O2\n\n1. **Light Stage**: Takes place in the **chloroplasts** (thylakoids) where chlorophyll absorbs sunlight.\n2. **Dark Stage**: Carbon dioxide is converted into glucose food.\n\nWhat specific part of photosynthesis would you like explained further?";
  }
  return "Welcome to **De Wisdom AI Academic Assistant**! I am here to guide you step-by-step with your assignments, subjects, and study concepts. What topic are you studying today?";
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`De Wisdom Comprehensive Academy server running on http://localhost:${PORT}`);
  });
}

startServer();
