import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function extractTextFromImage(base64Image: string, mimeType: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: "Extract all the text from this image. Maintain the original language. Return only the extracted text, formatted cleanly. If there is a title and a body, separate them. Do not include any other commentary." },
            {
              inlineData: {
                data: base64Image.split(",")[1], // Remove prefix
                mimeType: mimeType,
              },
            },
          ],
        },
      ],
    });

    return response.text || "No text found.";
  } catch (error) {
    console.error("Error extracting text:", error);
    return "Error extracting text.";
  }
}
