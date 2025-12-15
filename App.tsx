
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Player, SimulationStats, ChartDataPoint, SimulationStatus, DistributionStrategy, SimulationConfig, RoundLog } from './types';
import { QueueVisualizer } from './components/QueueVisualizer';
import { ExitsVisualizer } from './components/ExitsVisualizer';
import { StatsChart } from './components/StatsChart';
import { SmartContractViewer } from './components/SmartContractViewer';
import { UserDapp } from './components/UserDapp';
import { analyzeRisk } from './services/geminiService';
import { Play, Pause, RefreshCw, Bot, TrendingUp, Settings, Users, ShieldCheck, Droplets, Trophy, Crown, Skull, Clock, Zap, Target, Activity, Globe, ShieldAlert, Percent, ArrowRightLeft, TrendingDown, Scale, Hourglass, History, AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const INITIAL_SEED_AMOUNT = 1000;
const INITIAL_SEED_MULTIPLIER = 1.1; 
const DAILY_DRIP_INTERVAL = 240; 
const ROUND_EXTENSION_SECONDS = 600; 
const MAX_ROUND_DURATION_SECONDS = 86400; 
const AUTO_PAUSE_TICKS = 20000; // Increased for longer sims

// Internal Engine State
interface EngineState {
  queue: Player[];
  exits: Player[]; 
  historyCount: number;
  historySum: number;
  totalDeposited: number;
  protocolBalance: number;
  jackpotBalance: number; 
  currentRound: number; // Engine Tick
  gameRound: number; // Actual Game Day
  chartData: ChartDataPoint[];
  tickCount: number;
  config: SimulationConfig;
  currentAdaptiveMultiplier: number; 
  pendingTransactions: { amount: number; isClient: boolean; isReinvest: boolean }[];
  
  // Round State
  roundExpiry: number;
  lastDepositorId: string | null;
  roundHistory: RoundLog[];
  roundActive: boolean;
  transactionsInCurrentRound: number;

  // Sustainability Metrics
  currentLiability: number;
  healthFactor: number;
  dynamicFee: number;
  exitPenaltyRate: number; // Fluctuation based on panic
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'simulation' | 'contract' | 'dapp'>('dapp'); 
  const [settingsTab, setSettingsTab] = useState<'core' | 'economy' | 'risks'>('core');
  const [multiplier, setMultiplier] = useState<number>(2.0); 
  const [strategy, setStrategy] = useState<DistributionStrategy>(DistributionStrategy.STANDARD);

  // Config State
  const [config, setConfig] = useState<SimulationConfig>({
    feePercent: 0.05, 
    
    penaltyEnabled: true,
    penaltyThreshold: 500,
    penaltyRate: 0.10, 
    penaltyType: 'ENTRY',

    breakEvenChance: 0.0, 
    dailyDripRate: 0.10,      
    yieldSplit: 0.0, 
    target100Enabled: false,
    decayStrategyEnabled: true, 
    initialReserve: 10000,     
    jackpotFrequency: 1000,
    jackpotAmount: 500,
    reinvestRate: 0.40,
    reverseYieldRate: 0.20,
    decayRate: 0.005, // Lowered for smoother decay
    
    maxDepositLimit: 1000, 
    maxTransactions: 1000, // Fixed 1000 Tx per day limit
    roundDurationSeconds: 86400 
  });

  const [status, setStatus] = useState<SimulationStatus>(SimulationStatus.RUNNING);
  const [analysis, setAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [manualDepositAmount, setManualDepositAmount] = useState<number>(100);

  // Rendering Snapshot
  const [uiSnapshot, setUiSnapshot] = useState<{
    queueSlice: Player[];
    exitSlice: Player[];
    stats: SimulationStats;
    chartData: ChartDataPoint[];
    headPlayer: Player | null;
    clientPositions: Player[];
  }>({
    queueSlice: [],
    exitSlice: [],
    stats: {
      totalDeposited: 0,
      totalPaidOut: 0,
      totalUsers: 0,
      usersPaidExit: 0,
      usersTrapped: 0,
      currentQueueLength: 0,
      currentRound: 1,
      strategy: DistributionStrategy.STANDARD,
      multiplier: 2.0,
      protocolBalance: config.initialReserve,
      jackpotBalance: 0,
      target100Enabled: false,
      config: config,
      roundExpiry: Date.now() + config.roundDurationSeconds * 1000,
      lastDepositorId: null,
      roundActive: true,
      roundHistory: [],
      transactionsInCurrentRound: 0,
      healthFactor: 1.0,
      currentExitPenalty: 0.20
    },
    chartData: [],
    headPlayer: null,
    clientPositions: []
  });

  const engine = useRef<EngineState>({
    queue: [{
      id: 'PROTOCOL_SEED',
      deposit: INITIAL_SEED_AMOUNT,
      target: INITIAL_SEED_AMOUNT * INITIAL_SEED_MULTIPLIER, 
      collected: 0,
      entryRound: 1,
      timestamp: Date.now(),
      slashed: false,
      multiplier: INITIAL_SEED_MULTIPLIER,
      isTaxTarget: false,
      fastFilled: false,
      isClientDeposit: false,
      isReinvest: false,
      isUnlucky: false
    }],
    exits: [],
    historyCount: 0,
    historySum: 0,
    totalDeposited: INITIAL_SEED_AMOUNT,
    protocolBalance: config.initialReserve,
    jackpotBalance: 0,
    currentRound: 1,
    gameRound: 1,
    chartData: [],
    tickCount: 0,
    config: config,
    currentAdaptiveMultiplier: 2.0,
    pendingTransactions: [],
    roundExpiry: Date.now() + 86400000,
    lastDepositorId: 'PROTOCOL_SEED',
    roundHistory: [],
    roundActive: true,
    transactionsInCurrentRound: 0,
    currentLiability: 0,
    healthFactor: 10,
    dynamicFee: config.feePercent,
    exitPenaltyRate: 0.20
  });

  useEffect(() => {
    engine.current.config = config;
  }, [config]);

  // --- MATHEMATICAL HELPERS ---
  const updateHealthMetrics = () => {
    const state = engine.current;
    // Liability = Sum of (Target - Collected) for everyone in queue
    const liability = state.queue.reduce((acc, p) => acc + (p.target - p.collected), 0);
    state.currentLiability = liability;

    // Health Factor = Reserves / Liability
    // If Liability is 0, Health is Infinite (cap at 10 for logic)
    state.healthFactor = liability > 0 ? state.protocolBalance / liability : 10;

    // Dynamic Fee Adjustment based on Health
    // If Health < 0.2 (20% backed), increase entry fees linearly up to 15%
    if (state.healthFactor < 0.2) {
       state.dynamicFee = Math.min(0.15, state.config.feePercent + (0.2 - state.healthFactor) * 0.5);
    } else {
       state.dynamicFee = state.config.feePercent;
    }
  };

  // --- LOGIC: EMERGENCY WITHDRAW (Dynamic Penalty) ---
  const handleEmergencyWithdraw = (playerId: string) => {
      const state = engine.current;
      const index = state.queue.findIndex(p => p.id === playerId);
      
      if (index !== -1) {
          const player = state.queue[index];
          
          // Panic Multiplier: If Health is low, Exit Penalty increases to discourage runs
          let penaltyRate = state.exitPenaltyRate;
          if (state.healthFactor < 0.1) penaltyRate = 0.35; // 35% penalty if system is stressed
          
          const penaltyAmount = player.deposit * penaltyRate;
          const refundAmount = player.deposit - penaltyAmount;
          
          // Penalty goes to Protocol Reserve to sustain the system (The "Tax")
          state.protocolBalance += penaltyAmount;
          
          player.collected = refundAmount;
          player.exitReason = 'EARLY_EXIT';
          player.netProfit = -penaltyAmount;
          
          // Remove from Queue and Add to Exits
          state.queue.splice(index, 1);
          state.exits = [player, ...state.exits].slice(0, 50);
          state.historyCount++;
          
          // Recalculate Health immediately after exit (Liability drops, Reserve grows -> Health goes UP)
          updateHealthMetrics();
      }
  };

  const triggerDailyDrip = () => {
    const state = engine.current;
    if (state.protocolBalance <= 1 || state.queue.length === 0) return;

    const isLoop = strategy === DistributionStrategy.INFINITY_LOOP;
    // Adaptive Drip: Don't drip if Health Factor is critical (< 0.05)
    if (state.healthFactor < 0.05 && !isLoop) return;

    const dripAmount = isLoop ? state.protocolBalance : state.protocolBalance * state.config.dailyDripRate;
    state.protocolBalance -= dripAmount;

    let headPool = dripAmount;
    let reversePool = 0;
    if (isLoop && state.queue.length > 5) {
       reversePool = dripAmount * state.config.reverseYieldRate;
       headPool = dripAmount - reversePool;
    }
    if (reversePool > 0) {
       const tailSlice = state.queue.slice(-10);
       if (tailSlice.length > 0) {
          const share = reversePool / tailSlice.length;
          tailSlice.forEach(p => p.collected += share);
       }
    }
    let remaining = headPool;
    for (const p of state.queue) {
      if (remaining <= 0) break;
      const needed = p.target - p.collected;
      if (needed <= 0) continue; 
      if (remaining >= needed) {
        p.collected += needed; 
        remaining -= needed;
      } else {
        p.collected += remaining;
        remaining = 0;
      }
    }
  };

  const injectBot = (type: 'JACKPOT') => {
    const state = engine.current;
    const deposit = state.config.jackpotAmount;
    const target = deposit * 2.0;
    const botId = `JACKPOT_BOT_${state.historyCount}`;
    
    const bot: Player = {
      id: botId,
      deposit: deposit,
      target: target,
      collected: 0,
      entryRound: state.currentRound,
      timestamp: Date.now(),
      slashed: false,
      multiplier: 2.0,
      fastFilled: false,
      isClientDeposit: false,
      isUnlucky: false,
      isReinvest: false
    };
    state.totalDeposited += deposit;
    state.queue.push(bot);
  };

  const processDeposit = (amount: number, isSystem: boolean = false, isClient: boolean = false, isReinvest: boolean = false, advanceTime: boolean = true) => {
    const state = engine.current;
    
    // CAP CHECK
    if (amount > state.config.maxDepositLimit && !isSystem && !isReinvest) {
        amount = state.config.maxDepositLimit;
    }
    
    // Update Health before processing
    updateHealthMetrics();

    if (advanceTime) {
      state.tickCount++;
      if (state.tickCount % DAILY_DRIP_INTERVAL === 0) triggerDailyDrip();
    }

    // ROUND TIMER & TX COUNT LOGIC
    if (!isSystem && !isReinvest) {
        state.transactionsInCurrentRound++;
        
        if (state.transactionsInCurrentRound > state.config.maxTransactions) {
             // If we somehow exceed, refund immediately or just don't accept.
             // But for simulation, we trigger end.
             triggerRoundEnd('CAP_REACHED');
             return; 
        }

        const now = Date.now();
        const extension = ROUND_EXTENSION_SECONDS * 1000;
        const maxTime = now + (MAX_ROUND_DURATION_SECONDS * 1000);
        let newExpiry = state.roundExpiry + extension;
        if (newExpiry > maxTime) newExpiry = maxTime;
        state.roundExpiry = newExpiry;
    }
    
    // Fee Logic (Using Dynamic Fee)
    let netAmount = amount;
    if (!isSystem && !isReinvest) {
      const fee = amount * state.dynamicFee; // Uses the adaptive fee
      let penalty = 0;
      if (state.config.penaltyEnabled && amount >= state.config.penaltyThreshold) {
         penalty = amount * state.config.penaltyRate;
      }
      const totalFee = Math.max(1, fee + penalty); 
      netAmount = amount - totalFee;
      state.protocolBalance += totalFee * 0.5; 
      state.jackpotBalance += totalFee * 0.5; 
    }

    state.totalDeposited += amount;

    // Pools & Distribution
    const yieldRatio = state.config.yieldSplit;
    const yieldPool = netAmount * yieldRatio;
    const headPool = netAmount * (1 - yieldRatio);

    // --- MATHEMATICIAN'S MULTIPLIER LOGIC ---
    let effectiveMultiplier = multiplier;
    
    if (state.config.decayStrategyEnabled) {
        // Logistic Decay: More sustainable than linear
        // M = Base * (1 / (1 + decay * QueueLength))
        // Simplified: 2.0 -> decays towards 1.1 based on queue length
        const decayFactor = state.queue.length * state.config.decayRate;
        let decayed = 1.1 + (0.9 / (1 + decayFactor)); // Sigmoid-like dampener
        
        // If Health Factor is CRITICAL (< 0.1), clamp multiplier even harder
        if (state.healthFactor < 0.1) decayed = Math.min(decayed, 1.25);
        
        effectiveMultiplier = Math.max(1.1, decayed);
        state.currentAdaptiveMultiplier = effectiveMultiplier;
    }

    // Break Even Risk
    let isUnlucky = false;
    if (!isSystem && !isReinvest) {
        if (Math.random() < state.config.breakEvenChance) {
            isUnlucky = true;
            effectiveMultiplier = 1.0; 
        }
    }

    const playerId = isSystem ? 'PROTOCOL_SEED' : isClient ? `CLIENT_${uuidv4()}` : uuidv4();
    if (!isSystem && !isReinvest) {
        state.lastDepositorId = playerId;
    }

    const newPlayer: Player = {
      id: playerId,
      deposit: amount,
      target: amount * effectiveMultiplier,
      collected: 0,
      entryRound: state.currentRound,
      timestamp: Date.now(),
      slashed: false,
      multiplier: effectiveMultiplier,
      fastFilled: false,
      isClientDeposit: isClient,
      isUnlucky: isUnlucky,
      isReinvest: isReinvest
    };

    // Distribution Execution
    if (yieldPool > 0 && state.queue.length > 0) {
      const yieldShare = yieldPool / state.queue.length;
      for (const p of state.queue) {
        p.collected += yieldShare;
      }
    }

    let remaining = headPool;
    for (const p of state.queue) {
      if (remaining <= 0) break;
      const needed = p.target - p.collected;
      if (needed <= 0) continue; 
      if (remaining >= needed) {
        p.collected += needed; 
        remaining -= needed;
      } else {
        p.collected += remaining;
        remaining = 0;
      }
    }

    state.queue.push(newPlayer);

    const totalUsers = state.historyCount + state.queue.length;
    if (totalUsers > 0 && totalUsers % state.config.jackpotFrequency === 0) injectBot('JACKPOT');

    // Cleanup Paid Users
    const nextQueue: Player[] = [];
    const recentExits: Player[] = [];

    for (const p of state.queue) {
      if (p.collected >= p.target - 0.01) {
        p.collected = p.target;
        const duration = state.currentRound - p.entryRound;
        if (duration < 10) p.fastFilled = true;

        const profit = p.collected - p.deposit;
        p.netProfit = profit;
        p.exitRound = state.currentRound;
        p.exitReason = p.isUnlucky ? 'REFUND' : 'PAID';

        if (p.id.startsWith('JACKPOT_BOT')) {
            state.jackpotBalance += profit;
        } else if (strategy === DistributionStrategy.INFINITY_LOOP && !p.isUnlucky && !p.id.startsWith('PROTOCOL')) {
             const reinvestAmt = p.collected * state.config.reinvestRate;
             if (reinvestAmt > 5) {
                 state.pendingTransactions.push({ 
                    amount: reinvestAmt, 
                    isClient: p.isClientDeposit || false,
                    isReinvest: true
                 });
             }
        }
        state.historyCount++;
        state.historySum += p.target;
        recentExits.push(p);
      } else {
        nextQueue.push(p);
      }
    }
    
    state.queue = nextQueue;
    state.exits = [...recentExits, ...state.exits].slice(0, 50); 
    state.currentRound++; 
    
    // Update chart with health metrics
    state.chartData.push({
      round: state.totalDeposited,
      usersTrapped: state.queue.length,
      requiredNewLiquidity: state.currentLiability,
      protocolReserves: state.protocolBalance
    });
    if (state.chartData.length > 100) state.chartData.shift();

    // Check tx cap at end of processing as well to be safe
    if (!isSystem && !isReinvest && state.transactionsInCurrentRound >= state.config.maxTransactions) {
        triggerRoundEnd('CAP_REACHED');
    }
  };

  const handleFullReset = () => {
    setStatus(SimulationStatus.IDLE);
    engine.current = {
      queue: [{
        id: 'PROTOCOL_SEED',
        deposit: INITIAL_SEED_AMOUNT,
        target: INITIAL_SEED_AMOUNT * INITIAL_SEED_MULTIPLIER, 
        collected: 0,
        entryRound: 1,
        timestamp: Date.now(),
        slashed: false,
        multiplier: INITIAL_SEED_MULTIPLIER,
        isTaxTarget: false,
        fastFilled: false,
        isClientDeposit: false,
        isUnlucky: false,
        isReinvest: false
      }],
      exits: [],
      historyCount: 0,
      historySum: 0,
      totalDeposited: INITIAL_SEED_AMOUNT,
      protocolBalance: config.initialReserve,
      jackpotBalance: 0,
      currentRound: 1,
      gameRound: 1,
      chartData: [],
      tickCount: 0,
      config: config,
      currentAdaptiveMultiplier: 2.0,
      pendingTransactions: [],
      roundExpiry: Date.now() + 86400000,
      lastDepositorId: 'PROTOCOL_SEED',
      roundHistory: [],
      roundActive: true,
      transactionsInCurrentRound: 0,
      currentLiability: 0,
      healthFactor: 10,
      dynamicFee: config.feePercent,
      exitPenaltyRate: 0.20
    };
    syncUI();
  };

  const startNextRound = () => {
    const state = engine.current;
    
    // Logic Fix: Carry over a small seed from reserve if possible, but generally restart
    // New Round Seed
    state.queue = [{
        id: 'PROTOCOL_SEED',
        deposit: INITIAL_SEED_AMOUNT,
        target: INITIAL_SEED_AMOUNT * INITIAL_SEED_MULTIPLIER,
        collected: 0,
        entryRound: state.currentRound,
        timestamp: Date.now(),
        slashed: false,
        multiplier: INITIAL_SEED_MULTIPLIER,
        fastFilled: false,
        isClientDeposit: false,
        isReinvest: false,
        isUnlucky: false
    }];
    
    state.gameRound++;
    state.roundExpiry = Date.now() + (MAX_ROUND_DURATION_SECONDS * 1000);
    state.roundActive = true;
    state.lastDepositorId = 'PROTOCOL_SEED';
    state.transactionsInCurrentRound = 0;
    
    // Reset Liabilities for chart visualization
    state.currentLiability = 0;
    updateHealthMetrics();
    
    setStatus(SimulationStatus.RUNNING);
    syncUI();
  };

  const triggerRoundEnd = (reason: 'TIMER' | 'CAP_REACHED') => {
    const state = engine.current;
    // Prevent double triggering
    if (status === SimulationStatus.ROUND_ENDED || !state.roundActive) return;

    setStatus(SimulationStatus.ROUND_ENDED);
    state.roundActive = false;
    
    // 1. Give Jackpot to Last Depositor
    if (state.lastDepositorId) {
        const winner = state.queue.find(p => p.id === state.lastDepositorId);
        if (winner) {
            const jackpotPrize = state.jackpotBalance * 0.5; 
            winner.collected += jackpotPrize;
            winner.exitReason = 'JACKPOT_WIN';
            state.jackpotBalance -= jackpotPrize;
        }
    }

    // 2. MIDNIGHT REFUND (Distribute Reserve)
    let availableFunds = state.protocolBalance;
    // Sort stuck users by entry order (FIFO Refund)
    const stuckUsers = state.queue.filter(p => p.collected < p.deposit);

    for (const p of stuckUsers) {
        if (availableFunds <= 0) break;
        const refundNeeded = p.deposit - p.collected; 
        if (refundNeeded > 0) {
            // Attempt to pay back up to break even
            const payout = Math.min(availableFunds, refundNeeded);
            p.collected += payout;
            availableFunds -= payout;
            
            // If fully refunded (reached deposit), mark exits
            if (p.collected >= p.deposit) {
                p.exitReason = 'REFUND';
                p.target = p.deposit;
            }
        }
    }
    state.protocolBalance = availableFunds;

    // Log final state of this round
    state.roundHistory.push({
       roundNumber: state.gameRound,
       finalBalance: state.protocolBalance,
       totalVolume: state.totalDeposited,
       winnerId: state.lastDepositorId || undefined,
       timestamp: Date.now(),
       reason: reason
    });
  };

  const syncUI = useCallback(() => {
    const state = engine.current;
    
    let effectiveDisplayMultiplier = multiplier;
    if (state.config.target100Enabled || state.config.decayStrategyEnabled) {
        effectiveDisplayMultiplier = state.currentAdaptiveMultiplier;
    }

    setUiSnapshot({
      queueSlice: state.queue.slice(0, 8),
      exitSlice: state.exits.slice(0, 8),
      clientPositions: state.queue.filter(p => p.isClientDeposit),
      stats: {
        totalDeposited: state.totalDeposited,
        totalPaidOut: state.historySum,
        totalUsers: state.historyCount + state.queue.length,
        usersPaidExit: state.historyCount,
        usersTrapped: state.queue.length,
        currentQueueLength: state.queue.length,
        currentRound: state.gameRound,
        strategy,
        multiplier: effectiveDisplayMultiplier, 
        protocolBalance: state.protocolBalance,
        jackpotBalance: state.jackpotBalance,
        target100Enabled: state.config.target100Enabled,
        config: state.config,
        isAutoPaused: state.tickCount >= AUTO_PAUSE_TICKS,
        roundExpiry: state.roundExpiry,
        lastDepositorId: state.lastDepositorId,
        roundActive: state.roundActive,
        roundHistory: state.roundHistory,
        transactionsInCurrentRound: state.transactionsInCurrentRound,
        healthFactor: state.healthFactor,
        currentExitPenalty: state.healthFactor < 0.1 ? 0.35 : 0.20 // Visual feedback on penalty
      },
      chartData: [...state.chartData], 
      headPlayer: state.queue[0] || null
    });
  }, [strategy, multiplier, config, status]);

  useEffect(() => {
    const timer = setInterval(syncUI, 200); 
    return () => clearInterval(timer);
  }, [syncUI]);

  useEffect(() => {
    if (status !== SimulationStatus.RUNNING) return;
    
    const timer = setInterval(() => {
      // Check Round Timer
      if (Date.now() > engine.current.roundExpiry) {
         triggerRoundEnd('TIMER');
         return;
      }

      if (engine.current.tickCount >= AUTO_PAUSE_TICKS) {
        setStatus(SimulationStatus.COMPLETED);
        return;
      }
      const pending = [...engine.current.pendingTransactions];
      engine.current.pendingTransactions = []; 
      pending.forEach(tx => processDeposit(tx.amount, false, tx.isClient, tx.isReinvest, false));
      
      // Simulation Bot Activity
      if (Math.random() > 0.7) { 
          // Regular Deposit
          const amount = Math.floor(Math.random() * 450) + 50; 
          processDeposit(amount, false, false, false, true); 

          // Random Emergency Withdraw (Panic Simulation)
          // Higher chance to panic if Health Factor is low
          const panicChance = engine.current.healthFactor < 0.2 ? 0.05 : 0.01;
          
          if (engine.current.queue.length > 5 && Math.random() < panicChance) {
             const eligible = engine.current.queue.filter(p => !p.id.startsWith('PROTOCOL') && !p.id.startsWith('JACKPOT') && !p.isClientDeposit);
             if (eligible.length > 0) {
                 const victim = eligible[Math.floor(Math.random() * eligible.length)];
                 handleEmergencyWithdraw(victim.id);
             }
          }
      }
    }, 200); 

    return () => clearInterval(timer);
  }, [status, strategy, multiplier]);

  const handleManualDeposit = () => {
    if (status === SimulationStatus.ROUND_ENDED) return;
    processDeposit(manualDepositAmount, false, false, false, true);
    syncUI();
  };

  const handleDappDeposit = (amt: number) => {
    processDeposit(amt, false, true, false, true); 
    syncUI();
  };

  const handleClientWithdraw = (id: string) => {
      handleEmergencyWithdraw(id);
      syncUI();
  };

  const handleAnalyze = async () => {
    if (!process.env.API_KEY) {
      setAnalysis("Error: API Key not found.");
      return;
    }
    setIsAnalyzing(true);
    const concept = `
      Protocol Max 2.0x. Max Deposit 1000 USDC.
      Current Multiplier: ${uiSnapshot.stats.multiplier.toFixed(2)}x.
      Strategy: Controlled Ponzi with Round Timer & 1000 Tx Cap.
      Sustainability: Last Depositor wins Jackpot, Reserves used to refund principal to stuck users.
      Emergency Withdraw: Users can exit early with ${uiSnapshot.stats.currentExitPenalty * 100}% penalty.
      Health Factor: ${uiSnapshot.stats.healthFactor.toFixed(2)}.
    `;
    const result = await analyzeRisk(uiSnapshot.stats, concept);
    setAnalysis(result);
    setIsAnalyzing(false);
  };

  const { stats, queueSlice, exitSlice, chartData, headPlayer } = uiSnapshot;
  const totalLiability = uiSnapshot.stats.usersTrapped > 0 
     ? engine.current.currentLiability
     : 0;
  
  const dripDisplay = (stats.config.dailyDripRate * 100).toFixed(0);

  // Helper color for health
  const healthColor = stats.healthFactor > 0.5 ? 'text-emerald-400' : stats.healthFactor > 0.2 ? 'text-yellow-400' : 'text-red-500';

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-emerald-500/30 pb-12 relative">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
        
        {/* Top Header */}
        <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800/50 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
              <Crown className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                x2gether <span className="text-emerald-500">Protocol</span>
              </h1>
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-400 font-mono">v9.6-MATH-OPTIMIZED</span>
                <span className="text-emerald-500 font-bold flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Audit Passed</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-400 font-mono">Round {stats.currentRound}</span>
              </div>
            </div>
          </div>

          <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            <button onClick={() => setActiveTab('dapp')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'dapp' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><Globe className="w-4 h-4" /> Client App</button>
            <button onClick={() => setActiveTab('simulation')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'simulation' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Admin View</button>
            <button onClick={() => setActiveTab('contract')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'contract' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><Settings className="w-4 h-4" /> Contract</button>
          </div>
        </header>

        {activeTab === 'simulation' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-6 relative overflow-hidden group shadow-2xl">
                 <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-emerald-500/10 transition-all duration-1000"></div>
                 <div className="flex items-center justify-between mb-8 relative z-10">
                   <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Protocol Liquidity</h2>
                 </div>
                 <div className="relative z-10 grid grid-cols-2 gap-6">
                   <div className="col-span-2">
                      <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Total Reserve</div>
                      <div className="text-4xl font-mono font-bold text-white mb-2 tracking-tight">${stats.protocolBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                      <div className="flex gap-2">
                        <div className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded border border-blue-500/20 flex items-center gap-1"><Droplets className="w-3 h-3"/> {dripDisplay}% Drip / Day</div>
                      </div>
                   </div>
                   <div className="pt-4 border-t border-slate-800/50 col-span-2 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 flex items-center gap-2 uppercase"><Trophy className="w-3 h-3 text-amber-500" /> Jackpot Pool</div>
                        <div className="text-xl font-mono font-bold text-amber-400">${stats.jackpotBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                      </div>
                      <div className="text-right">
                         <div className="text-[10px] text-slate-500 mb-1 flex items-center justify-end gap-2 uppercase"><TrendingUp className="w-3 h-3 text-indigo-500" /> Round Activity</div>
                         <div className="text-xl font-mono font-bold text-indigo-400">{stats.transactionsInCurrentRound} / 1000</div>
                      </div>
                   </div>
                 </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden h-[calc(100vh-450px)] flex flex-col shadow-xl">
                <div className="flex border-b border-slate-800 bg-slate-950/50">
                   <button onClick={() => setSettingsTab('core')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'core' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>Core</button>
                   <button onClick={() => setSettingsTab('economy')} className={`relative flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'economy' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>Econ</button>
                   <button onClick={() => setSettingsTab('risks')} className={`relative flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'risks' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>Penalties</button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar flex-grow space-y-6">
                  {settingsTab === 'core' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                       <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                          <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">Initial Reserve <span className="text-emerald-400 font-mono">${config.initialReserve.toLocaleString()}</span></label>
                          <input type="range" min="0" max="100000" step="5000" value={config.initialReserve} onChange={(e) => { const val = parseInt(e.target.value); setConfig(prev => ({...prev, initialReserve: val})); engine.current.protocolBalance = val; }} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                       </div>
                       
                       <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                          <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">Daily Drip Rate <span className="text-blue-400 font-mono">{(config.dailyDripRate * 100).toFixed(0)}%</span></label>
                          <input type="range" min="0" max="100" step="5" value={config.dailyDripRate * 100} onChange={(e) => setConfig({...config, dailyDripRate: parseFloat(e.target.value) / 100})} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                          <div className="text-[9px] text-slate-500 mt-1">Percentage of Reserve released daily</div>
                       </div>
                    </div>
                  )}

                  {settingsTab === 'economy' && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                       <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                          <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">Entry Fee <span className="text-white font-mono">{(config.feePercent * 100).toFixed(1)}%</span></label>
                          <input type="range" min="0" max="20" step="0.5" value={config.feePercent * 100} onChange={(e) => setConfig({...config, feePercent: parseFloat(e.target.value) / 100})} className="w-full h-1.5 bg-slate-800 rounded-lg accent-white" />
                       </div>

                       {/* Queue Decay Strategy */}
                       <div className={`p-4 rounded-xl border transition-all ${config.decayStrategyEnabled ? 'bg-indigo-950/20 border-indigo-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                          <div className="flex items-center justify-between mb-3">
                             <div className="flex items-center gap-2">
                                <TrendingDown className={`w-4 h-4 ${config.decayStrategyEnabled ? 'text-indigo-400' : 'text-slate-500'}`} />
                                <span className={`text-xs font-bold uppercase ${config.decayStrategyEnabled ? 'text-indigo-400' : 'text-slate-500'}`}>Queue Decay Strategy</span>
                             </div>
                             <button onClick={() => setConfig({...config, decayStrategyEnabled: !config.decayStrategyEnabled, target100Enabled: false})} className={`w-9 h-5 rounded-full relative transition-colors ${config.decayStrategyEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                               <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: config.decayStrategyEnabled ? '20px' : '4px'}}></div>
                             </button>
                          </div>
                          {config.decayStrategyEnabled && (
                            <div className="space-y-2 pt-2 border-t border-indigo-900/30">
                               <div className="text-[10px] text-indigo-300">ROI decreases as queue length grows. Max 2.0x.</div>
                               <input type="range" min="0.001" max="0.05" step="0.001" value={config.decayRate} onChange={(e) => setConfig({...config, decayRate: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-800 rounded accent-indigo-500" />
                               <div className="text-[9px] text-right text-indigo-400">Decay: {config.decayRate.toFixed(3)} per user</div>
                            </div>
                          )}
                       </div>

                       {/* Fixed Multiplier - CAP MAX 2.0 */}
                       {!config.target100Enabled && !config.decayStrategyEnabled && (
                          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50">
                             <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">Fixed Multiplier <span className="text-white font-mono">{multiplier}x</span></label>
                             <input type="range" min="1.1" max="2.0" step="0.1" value={multiplier} onChange={(e) => { setMultiplier(parseFloat(e.target.value)); handleFullReset(); }} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white" />
                             <div className="text-[9px] text-slate-500 mt-1">xmax 2.0 (Hard Cap)</div>
                          </div>
                       )}
                    </div>
                  )}

                  {settingsTab === 'risks' && (
                     <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {/* Single Custom Penalty */}
                        <div className={`p-4 rounded-xl border transition-all ${config.penaltyEnabled ? 'bg-orange-950/20 border-orange-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                           <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                 <Scale className={`w-4 h-4 ${config.penaltyEnabled ? 'text-orange-400' : 'text-slate-500'}`} />
                                 <span className={`text-xs font-bold uppercase ${config.penaltyEnabled ? 'text-orange-400' : 'text-slate-500'}`}>Sustainability Tax</span>
                              </div>
                              <button onClick={() => setConfig({...config, penaltyEnabled: !config.penaltyEnabled})} className={`w-9 h-5 rounded-full relative transition-colors ${config.penaltyEnabled ? 'bg-orange-600' : 'bg-slate-700'}`}>
                                 <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: config.penaltyEnabled ? '20px' : '4px'}}></div>
                              </button>
                           </div>
                           {config.penaltyEnabled && (
                              <div className="pt-2 border-t border-orange-900/30 space-y-2">
                                 <div className="text-[9px] text-orange-300 mb-2">Applies to deposits over threshold.</div>
                                 <div className="flex justify-between text-[10px]"><span>Tax Rate</span> <span className="text-white">{(config.penaltyRate * 100).toFixed(0)}%</span></div>
                                 <input type="range" min="0.01" max="0.5" step="0.01" value={config.penaltyRate} onChange={(e) => setConfig({...config, penaltyRate: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-800 rounded accent-orange-500" />
                                 <div className="flex justify-between text-[10px]"><span>Threshold Amount</span> <span className="text-white">${config.penaltyThreshold}</span></div>
                                 <input type="range" min="100" max="2000" step="100" value={config.penaltyThreshold} onChange={(e) => setConfig({...config, penaltyThreshold: parseInt(e.target.value)})} className="w-full h-1 bg-slate-800 rounded accent-orange-500" />
                              </div>
                           )}
                        </div>
                     </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-800 bg-slate-950">
                   <div className="flex gap-2 mb-2">
                      <button onClick={handleManualDeposit} disabled={status === SimulationStatus.COMPLETED || status === SimulationStatus.ROUND_ENDED} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white p-3 rounded-xl text-sm font-bold border border-slate-700 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"><Settings className="w-4 h-4" /> Deposit</button>
                      <button onClick={() => status !== SimulationStatus.COMPLETED && setStatus(status === SimulationStatus.RUNNING ? SimulationStatus.PAUSED : SimulationStatus.RUNNING)} disabled={status === SimulationStatus.COMPLETED || status === SimulationStatus.ROUND_ENDED} className={`flex-1 p-3 rounded-xl text-sm font-bold border transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 ${status === SimulationStatus.RUNNING ? 'bg-amber-500/10 text-amber-500 border-amber-500/50' : 'bg-emerald-600 text-white border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]'}`}>{status === SimulationStatus.RUNNING ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Auto Run</>}</button>
                   </div>
                   <button onClick={handleFullReset} className="w-full py-2 text-[10px] text-slate-500 hover:text-red-400 uppercase tracking-widest flex items-center justify-center gap-1 transition-colors"><RefreshCw className="w-3 h-3" /> Hard Reset System</button>
                </div>
              </div>
            </div>

            {/* Middle: Stats & Queue */}
            <div className="lg:col-span-4 space-y-6">
               <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-lg">
                 {status === SimulationStatus.ROUND_ENDED && (
                    <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center p-6 animate-in fade-in zoom-in duration-300">
                       <h3 className="text-3xl font-bold text-white mb-2">ROUND {stats.currentRound} ENDED</h3>
                       <p className="text-slate-400 mb-6 text-sm">{stats.roundHistory[stats.roundHistory.length-1]?.reason === 'CAP_REACHED' ? '1000 TX Limit Reached!' : 'Timer Expired!'} Jackpot Distributed.</p>
                       <div className="flex flex-col gap-2 mb-6 text-xs text-emerald-400 font-mono bg-emerald-950/30 p-4 rounded-xl border border-emerald-500/20">
                          <div className="flex justify-between"><span>FINAL BALANCE</span> <span className="text-white">${stats.protocolBalance.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span>WINNER</span> <span className="text-white">{stats.lastDepositorId === 'PROTOCOL_SEED' ? 'PROTOCOL' : 'USER/BOT'}</span></div>
                       </div>
                       <button onClick={startNextRound} className="w-full px-6 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-base font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2">
                          <RefreshCw className="w-5 h-5" /> START ROUND {stats.currentRound + 1}
                       </button>
                    </div>
                 )}
                 <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500" /> Network Status</h2>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800"><div className={`w-2 h-2 rounded-full ${status === SimulationStatus.RUNNING ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div><span className="text-[10px] text-slate-400 font-mono font-bold uppercase">{status === SimulationStatus.RUNNING ? 'Live' : 'Paused'}</span></div>
                 </div>
                 <div className="bg-gradient-to-br from-slate-950 to-slate-900 rounded-2xl border border-slate-800 p-5 mb-5 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-300 opacity-20"></div>
                    {headPlayer ? (
                      <>
                        <div className="flex justify-between items-start mb-3 relative z-10">
                          <div><div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Paying Out</div><div className="text-base font-bold text-white flex items-center gap-2">{headPlayer.id === 'PROTOCOL_SEED' ? 'PROTOCOL SEED' : headPlayer.id.startsWith('JACKPOT') ? 'JACKPOT BOT' : `User ${headPlayer.id.slice(0,6)}`}{headPlayer.slashed && <Skull className="w-3.5 h-3.5 text-red-500 animate-pulse" />}</div></div>
                          <div className="text-right"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Target</div><div className="text-base font-mono font-bold text-emerald-400">${headPlayer.collected.toFixed(0)} <span className="text-slate-600 text-xs">/ ${headPlayer.target.toFixed(0)}</span></div></div>
                        </div>
                        <div className="relative h-2.5 bg-slate-800 rounded-full overflow-hidden mb-2"><div className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]" style={{ width: `${(headPlayer.collected / headPlayer.target) * 100}%` }}/></div>
                      </>
                    ) : <div className="text-center py-6 text-slate-500 text-xs italic">Queue Empty</div>}
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                   <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50"><div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Users in Queue</div><div className="text-2xl font-mono font-bold text-white tracking-tight">{stats.usersTrapped.toLocaleString()}</div></div>
                   <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50"><div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Exits / Total</div><div className="text-2xl font-mono font-bold text-white tracking-tight">{stats.usersPaidExit} <span className="text-sm text-slate-500 font-normal">/ {stats.totalUsers}</span></div></div>
                   <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50 col-span-2 flex justify-between items-center"><div><div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Total Volume</div><div className="text-2xl font-mono font-bold text-emerald-400 tracking-tight">${stats.totalDeposited.toLocaleString()}</div></div><div className="text-right"><div className="text-[10px] text-slate-500 uppercase font-bold mb-1">System Debt</div><div className="text-xl font-mono font-bold text-red-400 tracking-tight">${totalLiability.toLocaleString()}</div></div></div>
                 </div>
               </div>

               {/* Active Queue */}
               <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 h-[400px] flex flex-col shadow-lg">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Target className="w-4 h-4 text-emerald-500" /> Active Queue</h2>
                  <div className="flex-grow overflow-hidden relative">
                    <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-slate-900 to-transparent z-10 pointer-events-none"></div>
                    <QueueVisualizer queue={queueSlice} maxDisplay={7} />
                    <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-slate-900 to-transparent z-10 pointer-events-none"></div>
                  </div>
               </div>
            </div>

            {/* Right: Charts, Audit, Exits */}
            <div className="lg:col-span-4 space-y-6">
              
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><TrendingUp className="w-4 h-4 text-amber-500" /> Growth Curve</h2>
                  <div className={`px-2 py-1 rounded border text-[10px] font-bold uppercase ${stats.healthFactor > 0.5 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : stats.healthFactor > 0.15 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                     Health: {stats.healthFactor.toFixed(2)}
                  </div>
                </div>
                <StatsChart data={chartData} />
              </div>

               {/* Round History */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 h-[200px] flex flex-col shadow-lg">
                 <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><History className="w-4 h-4 text-indigo-500" /> Round History</h2>
                 <div className="flex-grow overflow-y-auto pr-2 custom-scrollbar space-y-2">
                    {stats.roundHistory.length === 0 ? <div className="text-center text-xs text-slate-600 italic py-4">No finished rounds</div> : 
                    stats.roundHistory.slice().reverse().map(log => (
                       <div key={log.timestamp} className="flex justify-between items-center p-2 rounded bg-slate-950 border border-slate-800 text-xs">
                          <div>
                              <span className="text-slate-400 mr-2">Round {log.roundNumber}</span>
                              {log.reason === 'CAP_REACHED' && <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1 rounded">CAP</span>}
                          </div>
                          <span className="font-mono text-emerald-400">${log.finalBalance.toFixed(0)} bal</span>
                       </div>
                    ))}
                 </div>
              </div>

              {/* Users Out (Exits) */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 h-[300px] flex flex-col shadow-lg">
                 <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-blue-500" /> Recent Exits (Users Out)</h2>
                 <div className="flex-grow overflow-hidden relative">
                    <ExitsVisualizer exits={exitSlice} />
                 </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col h-[300px] shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Bot className="w-4 h-4 text-purple-500" /> AI Auditor</h2>
                  <button onClick={handleAnalyze} disabled={isAnalyzing || stats.totalUsers === 0} className="text-[10px] bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-all font-bold shadow-lg shadow-purple-900/20 active:scale-95">{isAnalyzing ? 'Analyzing...' : 'Run Audit'}</button>
                </div>
                <div className="flex-grow bg-slate-950 rounded-2xl p-5 border border-slate-800 text-sm text-slate-300 overflow-y-auto custom-scrollbar shadow-inner">
                  {analysis ? <div className="prose prose-invert prose-sm"><pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">{analysis}</pre></div> : <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4"><div className="bg-slate-900 p-4 rounded-full"><Bot className="w-8 h-8 opacity-40" /></div><p className="text-center text-xs max-w-[200px] leading-relaxed opacity-60">Audit pending...</p></div>}
                </div>
              </div>

            </div>

          </div>
        ) : activeTab === 'dapp' ? (
          <div className="flex justify-center h-[calc(100vh-150px)]">
             <UserDapp stats={stats} onDeposit={handleDappDeposit} onWithdraw={handleClientWithdraw} isProcessing={status === SimulationStatus.RUNNING} myPositions={uiSnapshot.clientPositions} />
          </div>
        ) : (
          <SmartContractViewer />
        )}
      </div>
      
      <div className="fixed bottom-4 right-4 text-[10px] font-mono font-bold text-slate-500 bg-slate-900/90 backdrop-blur px-4 py-2 rounded-full border border-slate-800 pointer-events-none z-50 flex items-center gap-2 shadow-xl"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Virtual Architects</div>
    </div>
  );
};

export default App;
