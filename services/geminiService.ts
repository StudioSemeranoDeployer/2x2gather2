
import { GoogleGenAI } from "@google/genai";
import { SimulationStats, DistributionStrategy } from "../types";

const apiKey = process.env.API_KEY || '';

// Safely initialize GenAI
let ai: GoogleGenAI | null = null;
try {
  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  }
} catch (error) {
  console.error("Failed to initialize Gemini client", error);
}

export const analyzeRisk = async (stats: SimulationStats, conceptDescription: string): Promise<string> => {
  if (!ai) {
    return "API Key missing. Cannot generate analysis.";
  }

  try {
    const isYield = stats.config.yieldSplit > 0;
    const isInfinity = stats.strategy === DistributionStrategy.INFINITY_LOOP;
    
    const strategyDescription = isInfinity 
      ? "INFINITY LOOP (100% Flush)" 
      : isYield 
        ? `COMMUNITY YIELD (${(stats.config.yieldSplit * 100).toFixed(0)}% Split)` 
        : "STANDARD FIFO";
    
    const prompt = `
      You are a senior DeFi Strategist and Tokenomics Auditor. Analyze the "x2gether" protocol simulation.

      Current Configuration:
      - **Multiplier**: ${stats.multiplier.toFixed(2)}x (Effective)
      - **Strategy**: ${strategyDescription}
      - **Sustainability Tax**: ${stats.config.penaltyEnabled ? `ON (${(stats.config.penaltyRate * 100).toFixed(0)}% on > $${stats.config.penaltyThreshold})` : "OFF"}
      - **Target 100 Strategy**: ${stats.target100Enabled ? "ON (Adjusts ROI based on queue length)" : "OFF"}
      
      Simulation Snapshot:
      - Total Volume: $${stats.totalDeposited.toFixed(2)}
      - Protocol Vault: $${stats.protocolBalance.toFixed(2)}
      - Active Users: ${stats.usersTrapped}
      - Exited Users: ${stats.usersPaidExit}

      Specific Analysis Questions:
      1. **Target 100 Strategy**: ${stats.target100Enabled ? "Is the dynamic multiplier adjustment effective at stabilizing the system?" : "Should they enable the Target 100 Strategy to prevent collapse?"}
      2. **Sustainability Tax**: ${stats.config.penaltyEnabled ? "Is the tax threshold and rate effective for long-term sustainability?" : "Would enabling a sustainability tax help extend the runway?"}
      3. **Solvency**: With the current Reserve of $${stats.protocolBalance.toFixed(0)}, can the Midnight Refund save the trapped users?
      4. **Verdict**: Give a risk score (1-10) and a brutally honest conclusion.

      Keep the tone direct, technical, and analytical.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return "An error occurred while analyzing the simulation data.";
  }
};