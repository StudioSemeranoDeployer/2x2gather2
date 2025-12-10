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
    const isYield = stats.strategy === DistributionStrategy.COMMUNITY_YIELD;
    
    const prompt = `
      You are a senior DeFi Strategist and Tokenomics Auditor. Analyze the "x2gether" protocol simulation.

      Current Configuration:
      - **Multiplier**: ${stats.multiplier}x (Base)
      - **Strategy**: ${isYield ? "COMMUNITY YIELD" : "STANDARD FIFO"}
      - **Guillotine**: ${stats.guillotineEnabled ? "ON" : "OFF"}
      - **Dynamic Decay**: ${stats.dynamicDecayEnabled ? "ON (Lowers ROI for late entrants to reduce debt)" : "OFF"}
      - **Winners Tax**: ${stats.winnersTaxEnabled ? "ON (20% fee on fast exits < 1hr)" : "OFF"}
      
      Simulation Snapshot:
      - Total Volume: $${stats.totalDeposited.toFixed(2)}
      - Protocol Vault: $${stats.protocolBalance.toFixed(2)}
      - Active Users: ${stats.usersTrapped}
      - Exited Users: ${stats.usersPaidExit}

      Specific Analysis Questions:
      1. **Dynamic Decay**: ${stats.dynamicDecayEnabled ? "Is the reduction in multiplier effective at slowing debt growth?" : "Should they enable Dynamic Decay to prevent collapse?"}
      2. **Winners Tax**: ${stats.winnersTaxEnabled ? "How much does the 20% fast-exit tax help the Reserve Vault? Is it too high?" : "Would a tax on winners help the midnight refund?"}
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