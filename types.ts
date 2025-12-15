
export interface Player {
  id: string;
  deposit: number;
  target: number; // The x2 amount
  collected: number;
  entryRound: number;
  exitRound?: number; // When they finished
  timestamp: number;
  slashed?: boolean; // True if hit by generic penalty
  multiplier: number; // The specific multiplier at entry
  isVip?: boolean;
  isTaxTarget?: boolean;
  fastFilled?: boolean; 
  isClientDeposit?: boolean; // Tracked for dApp
  isUnlucky?: boolean; // True if hit by break-even risk
  isReinvest?: boolean; // True if this is an auto-compound entry
  exitReason?: 'PAID' | 'REFUND' | 'SLASHED' | 'JACKPOT_WIN' | 'EARLY_EXIT';
  netProfit?: number;
}

export enum DistributionStrategy {
  STANDARD = 'STANDARD', // Legacy (Now controlled by yieldSplit)
  INFINITY_LOOP = 'INFINITY_LOOP', // 100% Flush, Mandatory Reinvest
}

export interface RoundLog {
  roundNumber: number;
  finalBalance: number;
  totalVolume: number;
  winnerId?: string;
  timestamp: number;
  reason: 'TIMER' | 'CAP_REACHED';
}

export interface SimulationConfig {
  feePercent: number;        // Entry Fee (0-0.20)
  
  // Single Customizable Penalty
  penaltyEnabled: boolean;
  penaltyThreshold: number; // Min deposit to trigger
  penaltyRate: number;      // % to slash or tax
  penaltyType: 'ENTRY' | 'EXIT'; 

  // Break Even Risk
  breakEvenChance: number; 

  // Drip Config
  dailyDripRate: number;     // % of Vault to drip daily
  
  // Yield Strategy
  yieldSplit: number;        // 0 = 100% Head

  // Strategies
  target100Enabled: boolean; // Adaptive Target 100
  decayStrategyEnabled: boolean; // Queue-based Decay

  initialReserve: number;    // Starting Vault Balance
  
  // Jackpot Config
  jackpotFrequency: number;  // Every X users
  jackpotAmount: number;     // Deposit Amount
  
  // Loop Config
  reinvestRate: number;      // % Forced Reinvest
  reverseYieldRate: number;  // % to Tail
  
  decayRate: number; // Per user decay amount
  
  // Sustainability
  maxDepositLimit: number; // 1000 USDC Cap
  maxTransactions: number; // 1000 Tx Cap per day
  roundDurationSeconds: number; // Initial time
}

export interface SimulationStats {
  totalDeposited: number;
  totalPaidOut: number;
  totalUsers: number;
  usersPaidExit: number;
  usersTrapped: number;
  currentQueueLength: number;
  currentRound: number;
  strategy: DistributionStrategy;
  multiplier: number;
  protocolBalance: number; // Tracks Reserve + Fees + Taxes
  jackpotBalance: number;  // Tracks profits from Jackpot Bots
  target100Enabled: boolean;
  config: SimulationConfig; 
  isAutoPaused?: boolean; 
  
  // Mathematical Indicators
  healthFactor: number; // Reserve / Liability
  currentExitPenalty: number; // Dynamic penalty for emergency exit

  // Timer & Round Stats
  roundExpiry: number; // Timestamp
  lastDepositorId: string | null;
  roundActive: boolean;
  transactionsInCurrentRound: number;
  
  roundHistory: RoundLog[];
}

export interface ChartDataPoint {
  round: number;
  usersTrapped: number;
  requiredNewLiquidity: number;
  protocolReserves: number;
}

export enum SimulationStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  ROUND_ENDED = 'ROUND_ENDED'
}
