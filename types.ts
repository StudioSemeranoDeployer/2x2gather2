
export interface Player {
  id: string;
  deposit: number;
  target: number; // The x2 amount
  collected: number;
  entryRound: number;
  timestamp: number;
  slashed?: boolean; // True if hit by Guillotine
  multiplier: number; // The specific multiplier at entry
  isVip?: boolean;
  isTaxTarget?: boolean; // True if selected for Winners Tax (1 in X)
  fastFilled?: boolean; // True if filled within 10 transactions
  isClientDeposit?: boolean; // Tracked for dApp
  isUnlucky?: boolean; // True if hit by 10% break-even risk
}

export enum DistributionStrategy {
  STANDARD = 'STANDARD', // 100% to Head
  COMMUNITY_YIELD = 'COMMUNITY_YIELD', // 80% to Head, 20% split among all in queue
}

export interface SimulationConfig {
  feePercent: number;        // Entry Fee (0-0.10)
  
  // Guillotine Config
  guillotineStrength: number; // How much to slash (0.05-0.50)
  guillotineThreshold: number; // Minimum deposit to be eligible for slash
  guillotineInterval: number; // How often it triggers (ticks)

  // Winners Tax Config (Frequency Based)
  winnersTaxEnabled: boolean;
  winnersTaxFrequency: number; // 1 in X users

  // Dynamic Success Tax (Profit Fee based on Mult)
  dynamicSuccessTaxEnabled: boolean;
  
  // 10% Break Even Risk
  randomUnluckyEnabled: boolean;

  // Drip Config
  dailyDripRate: number;     // % of Vault to drip daily (0.01-1.0)
  
  // Elastic Strategy Config
  elasticMultiplierEnabled: boolean;
  elasticMin: number;
  elasticMax: number;

  // Chaos Mode
  chaosModeEnabled: boolean;
  
  // Random Decay Config (Legacy/Combo)
  randomDecayEnabled: boolean;
  randomDecayMin: number;
  randomDecayMax: number;
  randomDecayFrequency: number;

  initialReserve: number;    // Starting Vault Balance
  
  // Tax Bot Config
  taxBotEnabled: boolean;
  taxBotFrequency: number;   // Every X users
  taxBotAmount: number;      // Deposit Amount

  // Jackpot Config
  jackpotFrequency: number;  // Every X users
  jackpotAmount: number;     // Deposit Amount
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
  guillotineEnabled: boolean;
  elasticMultiplierEnabled: boolean;
  chaosModeEnabled: boolean;
  winnersTaxEnabled: boolean;
  config: SimulationConfig; // Added customizable config
  isAutoPaused?: boolean; // Track if paused by 30-day limit
}

export interface ChartDataPoint {
  round: number;
  usersTrapped: number;
  requiredNewLiquidity: number;
}

export enum SimulationStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED', // Added for 30-day stop
}
