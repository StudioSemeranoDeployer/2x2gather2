
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Player, SimulationStats, ChartDataPoint, SimulationStatus, DistributionStrategy, SimulationConfig } from './types';
import { QueueVisualizer } from './components/QueueVisualizer';
import { StatsChart } from './components/StatsChart';
import { SmartContractViewer } from './components/SmartContractViewer';
import { UserDapp } from './components/UserDapp';
import { analyzeRisk } from './services/geminiService';
import { Play, Pause, RefreshCw, Bot, TrendingUp, Settings, Users, ShieldCheck, Droplets, Trophy, Crown, Skull, Clock, Zap, Target, Activity, Globe, ShieldAlert } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const INITIAL_SEED_AMOUNT = 1000;
const DAILY_DRIP_INTERVAL = 240; // ~24 hours (assuming 10 ticks = 1 hour)
const AUTO_PAUSE_TICKS = 36500 * DAILY_DRIP_INTERVAL; // 100 Years (Effectively Infinite)

// Internal Engine State Interface (Mutable)
interface EngineState {
  queue: Player[];
  historyCount: number;
  historySum: number;
  totalDeposited: number;
  protocolBalance: number;
  jackpotBalance: number; 
  currentRound: number;
  chartData: ChartDataPoint[];
  tickCount: number; // For timers
  config: SimulationConfig; // Live config syncing
  currentAdaptiveMultiplier: number; // For Target 100 strategy
  pendingTransactions: { amount: number; isClient: boolean; isReinvest: boolean }[]; // Queue for internal tx
}

const App: React.FC = () => {
  // --- UI State (Synced periodically) ---
  const [activeTab, setActiveTab] = useState<'simulation' | 'contract' | 'dapp'>('simulation');
  const [settingsTab, setSettingsTab] = useState<'core' | 'economy' | 'bots' | 'risks'>('core');
  
  const [multiplier, setMultiplier] = useState<number>(2.0);
  const [strategy, setStrategy] = useState<DistributionStrategy>(DistributionStrategy.STANDARD);
  
  // Strategy Toggles
  const [guillotineEnabled, setGuillotineEnabled] = useState<boolean>(false);
  const [winnersTaxEnabled, setWinnersTaxEnabled] = useState<boolean>(false);

  // Advanced Customizable Parameters
  const [config, setConfig] = useState<SimulationConfig>({
    feePercent: 0.01,         // 1%
    
    guillotineStrength: 0.20, // 20% slash
    guillotineThreshold: 900, // Deposits > 900
    guillotineInterval: 60,   // ~6 hours default

    winnersTaxEnabled: false,
    winnersTaxFrequency: 10,  // 1 in 10

    breakEvenChance: 0.0, // 0-0.5 Slider

    dailyDripRate: 0.10,      // 10% daily drip default
    
    target100Enabled: true, // New Adaptive Strategy

    initialReserve: 30000,     // Default 30k
    
    jackpotFrequency: 1000,
    jackpotAmount: 1000,

    reinvestRate: 0.40,
    reverseYieldRate: 0.20,
    decayRate: 0.05
  });

  const [status, setStatus] = useState<SimulationStatus>(SimulationStatus.IDLE);
  const [analysis, setAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [manualDepositAmount, setManualDepositAmount] = useState<number>(100);

  // Snapshot for Rendering
  const [uiSnapshot, setUiSnapshot] = useState<{
    queueSlice: Player[];
    stats: SimulationStats;
    chartData: ChartDataPoint[];
    headPlayer: Player | null;
    clientPositions: Player[];
  }>({
    queueSlice: [],
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
      guillotineEnabled: false,
      target100Enabled: false,
      winnersTaxEnabled: false,
      config: config
    },
    chartData: [],
    headPlayer: null,
    clientPositions: []
  });

  // --- Engine (Mutable Ref - No Re-renders) ---
  const engine = useRef<EngineState>({
    queue: [{
      id: 'PROTOCOL_SEED',
      deposit: INITIAL_SEED_AMOUNT,
      target: INITIAL_SEED_AMOUNT * 2.0,
      collected: 0,
      entryRound: 1,
      timestamp: Date.now(),
      slashed: false,
      multiplier: 2.0,
      isTaxTarget: false,
      fastFilled: false,
      isClientDeposit: false,
      isReinvest: false,
      isUnlucky: false
    }],
    historyCount: 0,
    historySum: 0,
    totalDeposited: INITIAL_SEED_AMOUNT,
    protocolBalance: config.initialReserve,
    jackpotBalance: 0,
    currentRound: 1,
    chartData: [],
    tickCount: 0,
    config: config,
    currentAdaptiveMultiplier: 1.6, // Start Mid-Range
    pendingTransactions: []
  });

  // Sync config changes to engine immediately
  useEffect(() => {
    engine.current.config = config;
  }, [config]);

  // Logic: The Guillotine (Whales > Threshold only)
  const triggerGuillotine = () => {
    const state = engine.current;
    if (state.queue.length < 5) return; 

    // FILTER: Only consider deposits > configured threshold
    const candidates = [...state.queue]
      .filter(p => !p.slashed && !p.id.startsWith('JACKPOT_BOT') && p.id !== 'PROTOCOL_SEED' && p.deposit > state.config.guillotineThreshold) 
      .sort((a, b) => (b.target - b.collected) - (a.target - a.collected))
      .slice(0, 30); 

    if (candidates.length === 0) return;

    const victims: Player[] = [];
    const pool = [...candidates];
    
    // Slash up to 10 random whales
    for (let i = 0; i < 10; i++) {
       if (pool.length === 0) break;
       const randIndex = Math.floor(Math.random() * pool.length);
       victims.push(pool[randIndex]);
       pool.splice(randIndex, 1);
    }

    victims.forEach(v => {
      const originalTarget = v.target;
      v.target = originalTarget * (1 - state.config.guillotineStrength); 
      v.slashed = true;
    });
  };

  // Logic: Daily Drip (or Full Flush for Infinity Loop)
  const triggerDailyDrip = () => {
    const state = engine.current;
    if (state.protocolBalance <= 1 || state.queue.length === 0) return;

    const isLoop = strategy === DistributionStrategy.INFINITY_LOOP;
    // Infinity Loop empties 100% of vault, Standard drips percentage
    const dripAmount = isLoop ? state.protocolBalance : state.protocolBalance * state.config.dailyDripRate;
    state.protocolBalance -= dripAmount;

    let headPool = dripAmount;
    let reversePool = 0;

    // Infinity Loop: Reserve 20% for Tail (Reverse Yield)
    if (isLoop && state.queue.length > 5) {
       reversePool = dripAmount * state.config.reverseYieldRate;
       headPool = dripAmount - reversePool;
    }

    // 1. Distribute Reverse Pool (Tail)
    if (reversePool > 0) {
       const tailSlice = state.queue.slice(-10); // Last 10 users
       if (tailSlice.length > 0) {
          const share = reversePool / tailSlice.length;
          tailSlice.forEach(p => p.collected += share);
       }
    }

    // 2. Distribute Main Pool (Head - FIFO)
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

  // Logic: Bot Injections
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
      multiplier: 2.0, // Bots always get 2x
      isTaxTarget: false,
      fastFilled: false,
      isClientDeposit: false,
      isUnlucky: false,
      isReinvest: false
    };
    
    state.totalDeposited += deposit;
    state.queue.push(bot);
  };

  // Helper: Process a single deposit logic
  // Removed recursive calls - adds to pending queue instead
  const processDeposit = (amount: number, isSystem: boolean = false, isClient: boolean = false, isReinvest: boolean = false, advanceTime: boolean = true) => {
    const state = engine.current;
    
    // Only primary deposits tick the clock
    if (advanceTime) {
      state.tickCount++;
      
      // --- TIMED EVENTS ---
      if (guillotineEnabled && state.tickCount % state.config.guillotineInterval === 0) {
        triggerGuillotine();
      }
      if (state.tickCount % DAILY_DRIP_INTERVAL === 0) {
        triggerDailyDrip();
      }
    }
    
    // 1. Take Fee (if not system & not reinvest)
    let netAmount = amount;
    if (!isSystem && !isReinvest) {
      const fee = amount * state.config.feePercent;
      const actualFee = Math.max(1, fee); 
      netAmount = amount - actualFee;
      state.protocolBalance += actualFee;
    }

    state.totalDeposited += amount;

    // 2. Define Distribution Pools
    let headPool = netAmount;
    let yieldPool = 0;

    if (strategy === DistributionStrategy.COMMUNITY_YIELD) {
      yieldPool = netAmount * 0.20; 
      headPool = netAmount * 0.80;  
    }

    // 3. Multiplier Calculation (Target 100 Adaptive)
    let effectiveMultiplier = multiplier;

    if (state.config.target100Enabled) {
        const targetQ = 100;
        const currentQ = state.queue.length;
        
        // Drifting Logic: +0.02 if Q<100, -0.02 if Q>100 (More sensitive)
        if (currentQ < targetQ) {
            state.currentAdaptiveMultiplier += 0.02;
        } else {
            state.currentAdaptiveMultiplier -= 0.02;
        }

        // Clamp between 1.2 and 2.0 (as requested)
        state.currentAdaptiveMultiplier = Math.max(1.2, Math.min(2.0, state.currentAdaptiveMultiplier));
        effectiveMultiplier = state.currentAdaptiveMultiplier;
    }

    // 4. Break-Even Risk Check (Slider Probability)
    let isUnlucky = false;
    // Apply risk only to non-system, non-reinvest users
    if (!isSystem && !isReinvest) {
        if (Math.random() < state.config.breakEvenChance) {
            isUnlucky = true;
            effectiveMultiplier = 1.0; // Force break-even
        }
    }

    // 5. Winners Tax Flagging (1 in X users)
    const currentTotalUsers = state.historyCount + state.queue.length + 1;
    const isTaxTarget = winnersTaxEnabled && !isSystem && (currentTotalUsers % state.config.winnersTaxFrequency === 0);

    // 6. Create Player
    const newPlayer: Player = {
      id: isSystem ? 'PROTOCOL_SEED' : isClient ? `CLIENT_${uuidv4()}` : uuidv4(),
      deposit: amount,
      target: amount * effectiveMultiplier,
      collected: 0,
      entryRound: state.currentRound,
      timestamp: Date.now(),
      slashed: false,
      multiplier: effectiveMultiplier,
      isTaxTarget: isTaxTarget,
      fastFilled: false,
      isClientDeposit: isClient,
      isUnlucky: isUnlucky,
      isReinvest: isReinvest
    };

    // 7. Distribute Yield (Drip)
    if (yieldPool > 0 && state.queue.length > 0) {
      const yieldShare = yieldPool / state.queue.length;
      for (const p of state.queue) {
        p.collected += yieldShare;
      }
    }

    // 8. Distribute to Head (FIFO)
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

    // 9. Add new player
    state.queue.push(newPlayer);

    // --- CHECK FOR BOT INJECTIONS ---
    const totalUsers = state.historyCount + state.queue.length;
    
    // Jackpot Bot
    if (totalUsers > 0 && totalUsers % state.config.jackpotFrequency === 0) {
      injectBot('JACKPOT');
    }

    // 10. Cleanup Sweep (Remove fully paid)
    const nextQueue: Player[] = [];

    for (const p of state.queue) {
      if (p.collected >= p.target - 0.01) {
        p.collected = p.target; // Visual clean
        const profit = p.collected - p.deposit;
        
        // --- SPECIAL EXIT LOGIC ---
        if (p.id === 'PROTOCOL_SEED') {
            state.protocolBalance += p.collected;
        } else if (p.id.startsWith('JACKPOT_BOT')) {
            state.jackpotBalance += profit;
        } else {
            // Legacy Tax Logic (Still valid if enabled via other means in future)
            if (p.isTaxTarget && !p.isUnlucky) {
               if (profit > 0) {
                 const tax = profit * 0.20; 
                 state.protocolBalance += tax;
               }
            }
            
            // INFINITY LOOP: Mandatory Reinvest logic
            // We DO NOT call processDeposit here. We push to pending.
            if (strategy === DistributionStrategy.INFINITY_LOOP && !p.isUnlucky && !p.id.startsWith('JACKPOT_BOT')) {
                 const reinvestAmt = p.collected * state.config.reinvestRate;
                 if (reinvestAmt > 5) { // Minimum threshold
                     state.pendingTransactions.push({ 
                        amount: reinvestAmt, 
                        isClient: p.isClientDeposit || false,
                        isReinvest: true
                     });
                 }
            }
        }
        // --------------------------

        state.historyCount++;
        state.historySum += p.target;
      } else {
        if (state.currentRound - p.entryRound < 10) {
            p.fastFilled = true;
        }
        nextQueue.push(p);
      }
    }
    
    state.queue = nextQueue;
    state.currentRound++; 
    
    // 11. Update Chart Data
    const liability = state.queue.reduce((acc, p) => acc + (p.target - p.collected), 0);
    state.chartData.push({
      round: state.totalDeposited,
      usersTrapped: state.queue.length,
      requiredNewLiquidity: liability
    });
    if (state.chartData.length > 100) state.chartData.shift();
  };

  const handleFullReset = () => {
    setStatus(SimulationStatus.IDLE);
    engine.current = {
      queue: [{
        id: 'PROTOCOL_SEED',
        deposit: INITIAL_SEED_AMOUNT,
        target: INITIAL_SEED_AMOUNT * 2.0, 
        collected: 0,
        entryRound: 1,
        timestamp: Date.now(),
        slashed: false,
        multiplier: 2.0,
        isTaxTarget: false,
        fastFilled: false,
        isClientDeposit: false,
        isUnlucky: false,
        isReinvest: false
      }],
      historyCount: 0,
      historySum: 0,
      totalDeposited: INITIAL_SEED_AMOUNT,
      protocolBalance: config.initialReserve,
      jackpotBalance: 0,
      currentRound: 1,
      chartData: [],
      tickCount: 0,
      config: config,
      currentAdaptiveMultiplier: 1.6,
      pendingTransactions: []
    };
    syncUI();
  };

  // --- Sync Loop (Engine -> UI) ---
  const syncUI = useCallback(() => {
    const state = engine.current;
    
    // Determine effective multiplier for display purposes
    let effectiveDisplayMultiplier = multiplier;
    if (state.config.target100Enabled) {
        effectiveDisplayMultiplier = state.currentAdaptiveMultiplier;
    }

    setUiSnapshot({
      queueSlice: state.queue.slice(0, 8),
      clientPositions: state.queue.filter(p => p.isClientDeposit),
      stats: {
        totalDeposited: state.totalDeposited,
        totalPaidOut: state.historySum,
        totalUsers: state.historyCount + state.queue.length,
        usersPaidExit: state.historyCount,
        usersTrapped: state.queue.length,
        currentQueueLength: state.queue.length,
        currentRound: state.currentRound,
        strategy,
        multiplier: effectiveDisplayMultiplier, 
        protocolBalance: state.protocolBalance,
        jackpotBalance: state.jackpotBalance,
        guillotineEnabled,
        target100Enabled: state.config.target100Enabled,
        winnersTaxEnabled,
        config: state.config,
        isAutoPaused: state.tickCount >= AUTO_PAUSE_TICKS
      },
      chartData: [...state.chartData], 
      headPlayer: state.queue[0] || null
    });
  }, [strategy, multiplier, guillotineEnabled, winnersTaxEnabled, config]);

  // --- Timers ---
  useEffect(() => {
    const timer = setInterval(syncUI, 200); 
    return () => clearInterval(timer);
  }, [syncUI]);

  // --- Simulation Loop ---
  useEffect(() => {
    if (status !== SimulationStatus.RUNNING) return;
    
    const timer = setInterval(() => {
      // 0. Auto Pause Check
      if (engine.current.tickCount >= AUTO_PAUSE_TICKS) {
        setStatus(SimulationStatus.COMPLETED);
        return;
      }

      // 1. Process Pending Internal Transactions (Reinvests)
      // We process these first. They do NOT advance time.
      const pending = [...engine.current.pendingTransactions];
      engine.current.pendingTransactions = []; // Clear queue
      
      pending.forEach(tx => {
         processDeposit(tx.amount, false, tx.isClient, tx.isReinvest, false);
      });

      // 2. Process Primary Deposit (Advances Time)
      // Simulates real-world traffic
      const amount = Math.floor(Math.random() * 990) + 10; 
      processDeposit(amount, false, false, false, true); 

    }, 100); 

    return () => clearInterval(timer);
  }, [status, strategy, multiplier, guillotineEnabled, winnersTaxEnabled]);

  const handleManualDeposit = () => {
    processDeposit(manualDepositAmount, false, false, false, true);
    syncUI();
  };

  const handleDappDeposit = (amt: number) => {
    processDeposit(amt, false, true, false, true); // true for isClient, advanceTime = true
    syncUI();
  };

  const handleAnalyze = async () => {
    if (!process.env.API_KEY) {
      setAnalysis("Error: API Key not found.");
      return;
    }
    setIsAnalyzing(true);
    const concept = `
      Protocol with ${uiSnapshot.stats.multiplier.toFixed(2)}x Current Multiplier.
      Target 100 Adaptive Strategy: ${config.target100Enabled}.
      Break-Even Risk: ${config.breakEvenChance * 100}%.
      Reserve: ${uiSnapshot.stats.protocolBalance.toFixed(2)}.
    `;
    const result = await analyzeRisk(uiSnapshot.stats, concept);
    setAnalysis(result);
    setIsAnalyzing(false);
  };

  const { stats, queueSlice, chartData, headPlayer } = uiSnapshot;

  const totalLiability = uiSnapshot.stats.usersTrapped > 0 
     ? engine.current.queue.reduce((acc, p) => acc + (p.target - p.collected), 0)
     : 0;
  
  const daysPassed = (engine.current.tickCount / DAILY_DRIP_INTERVAL).toFixed(1);

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
                <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-400 font-mono">v7.0-TARGET100</span>
                <span>•</span>
                <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-blue-500"/> Audited Simulation</span>
              </div>
            </div>
          </div>

          <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            <button 
              onClick={() => setActiveTab('simulation')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'simulation' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('contract')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'contract' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Settings className="w-4 h-4" /> Contract
            </button>
            <button 
              onClick={() => setActiveTab('dapp')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'dapp' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Globe className="w-4 h-4" /> Client App
            </button>
          </div>
        </header>

        {activeTab === 'simulation' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Controls & Protocol Wallet */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Protocol Vault Card */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-6 relative overflow-hidden group shadow-2xl">
                 <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-emerald-500/10 transition-all duration-1000"></div>
                 
                 <div className="flex items-center justify-between mb-8 relative z-10">
                   <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                     <ShieldCheck className="w-4 h-4" /> Protocol Liquidity
                   </h2>
                   <div className="text-[10px] bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/20">
                     Verifiable On-Chain
                   </div>
                 </div>

                 <div className="relative z-10 grid grid-cols-2 gap-6">
                   <div className="col-span-2">
                      <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Total Reserve</div>
                      <div className="text-4xl font-mono font-bold text-white mb-2 tracking-tight">
                        ${stats.protocolBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </div>
                      <div className="flex gap-2">
                        <div className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded border border-blue-500/20 flex items-center gap-1">
                           <Droplets className="w-3 h-3"/> {(config.dailyDripRate * 100).toFixed(0)}% Drip / Day
                        </div>
                      </div>
                   </div>

                   <div className="pt-4 border-t border-slate-800/50 col-span-2 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1 flex items-center gap-2 uppercase">
                           <Trophy className="w-3 h-3 text-amber-500" /> Jackpot Pool
                        </div>
                        <div className="text-xl font-mono font-bold text-amber-400">
                          ${stats.jackpotBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>
                      </div>
                      <div className="text-right">
                         <div className="text-[10px] text-slate-500 mb-1 uppercase">Fee Revenue</div>
                         <div className="text-sm font-mono text-slate-300">
                            ${(stats.totalDeposited * config.feePercent).toLocaleString()}
                         </div>
                      </div>
                   </div>
                 </div>
              </div>

              {/* Enhanced Tabbed Control Panel */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden h-[calc(100vh-450px)] flex flex-col shadow-xl">
                {/* Tabs */}
                <div className="flex border-b border-slate-800 bg-slate-950/50">
                   <button onClick={() => setSettingsTab('core')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'core' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>
                      Core
                   </button>
                   <button onClick={() => setSettingsTab('economy')} className={`relative flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'economy' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>
                      Econ 
                      {(config.target100Enabled) && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-cyan-500 rounded-full"></span>}
                   </button>
                   <button onClick={() => setSettingsTab('risks')} className={`relative flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'risks' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>
                      Risks
                      {(guillotineEnabled || config.breakEvenChance > 0) && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full"></span>}
                   </button>
                </div>

                {/* Content Area */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-grow space-y-6">
                  
                  {/* CORE TAB */}
                  {settingsTab === 'core' && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                       <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                          <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">
                            Initial Reserve (Reset) <span className="text-emerald-400 font-mono">${config.initialReserve.toLocaleString()}</span>
                          </label>
                          <input 
                             type="range" min="0" max="100000" step="5000"
                             value={config.initialReserve}
                             onChange={(e) => {
                                setConfig({...config, initialReserve: parseInt(e.target.value)});
                                setTimeout(handleFullReset, 50); 
                             }}
                             className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                          />
                       </div>
                       
                       {/* Distribution Strategy Loop */}
                       <div className="p-4 rounded-xl border bg-slate-950/50 border-slate-800">
                           <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-bold uppercase text-slate-400">Infinity Loop</span>
                              <button onClick={() => setStrategy(strategy === DistributionStrategy.INFINITY_LOOP ? DistributionStrategy.STANDARD : DistributionStrategy.INFINITY_LOOP)} className={`w-9 h-5 rounded-full relative transition-colors ${strategy === DistributionStrategy.INFINITY_LOOP ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                                 <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: strategy === DistributionStrategy.INFINITY_LOOP ? '20px' : '4px'}}></div>
                              </button>
                           </div>
                           {strategy === DistributionStrategy.INFINITY_LOOP && (
                              <div className="text-[10px] text-emerald-400 pt-2 border-t border-slate-800">
                                 100% daily flush. 40% mandatory reinvest.
                              </div>
                           )}
                       </div>

                       <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                         <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">
                           Daily Drip Rate <span className="text-blue-400 font-mono">{(config.dailyDripRate * 100).toFixed(0)}%</span>
                         </label>
                         <input 
                           type="range" min="1" max="100" step="1"
                           value={config.dailyDripRate * 100}
                           onChange={(e) => setConfig({...config, dailyDripRate: parseFloat(e.target.value) / 100})}
                           className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                         />
                       </div>
                    </div>
                  )}

                  {/* ECONOMY TAB */}
                  {settingsTab === 'economy' && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                       
                       {/* Target 100 Strategy */}
                       <div className={`p-4 rounded-xl border transition-all ${config.target100Enabled ? 'bg-cyan-950/20 border-cyan-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                          <div className="flex items-center justify-between mb-3">
                             <div className="flex items-center gap-2">
                                <Target className={`w-4 h-4 ${config.target100Enabled ? 'text-cyan-400' : 'text-slate-500'}`} />
                                <span className={`text-xs font-bold uppercase ${config.target100Enabled ? 'text-cyan-400' : 'text-slate-500'}`}>Target 100 Strategy</span>
                             </div>
                             <button 
                               onClick={() => setConfig({...config, target100Enabled: !config.target100Enabled})}
                               className={`w-9 h-5 rounded-full relative transition-colors ${config.target100Enabled ? 'bg-cyan-600' : 'bg-slate-700'}`}
                             >
                               <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: config.target100Enabled ? '20px' : '4px'}}></div>
                             </button>
                          </div>
                          
                          {config.target100Enabled && (
                            <div className="text-[10px] text-cyan-300 pt-2 border-t border-cyan-900/30 mt-2">
                               System adaptively adjusts ROI between 1.2x and 2.0x to maintain ~100 users queue length.
                            </div>
                          )}
                       </div>

                       {/* Legacy Controls (Hidden if Target 100 is on) */}
                       {!config.target100Enabled && (
                          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 mb-4">
                             <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">
                               Fixed Multiplier <span className="text-white font-mono">{multiplier}x</span>
                             </label>
                             <input 
                               type="range" min="1.1" max="3.0" step="0.1"
                               value={multiplier}
                               onChange={(e) => { setMultiplier(parseFloat(e.target.value)); handleFullReset(); }}
                               className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                             />
                          </div>
                       )}

                    </div>
                  )}

                  {/* RISKS TAB */}
                  {settingsTab === 'risks' && (
                     <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        
                        {/* Break-Even Risk Slider */}
                        <div className={`p-4 rounded-xl border transition-all ${config.breakEvenChance > 0 ? 'bg-slate-100/10 border-slate-400/40' : 'bg-slate-950/50 border-slate-800'}`}>
                           <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                 <ShieldAlert className={`w-4 h-4 ${config.breakEvenChance > 0 ? 'text-slate-200' : 'text-slate-500'}`} />
                                 <span className={`text-xs font-bold uppercase ${config.breakEvenChance > 0 ? 'text-slate-200' : 'text-slate-500'}`}>Break-Even Risk %</span>
                              </div>
                           </div>
                           
                           <div className="space-y-2">
                               <div className="flex justify-between text-[10px] text-slate-400">
                                  <span>Probability</span>
                                  <span className="text-white font-mono">{(config.breakEvenChance * 100).toFixed(0)}%</span>
                               </div>
                               <input 
                                 type="range" min="0" max="50" step="1"
                                 value={config.breakEvenChance * 100}
                                 onChange={(e) => setConfig({...config, breakEvenChance: parseFloat(e.target.value) / 100})}
                                 className="w-full h-1 bg-slate-800 rounded accent-slate-200"
                               />
                               <div className="text-[9px] text-slate-500 italic">Chance of receiving 1.0x (Refund Only).</div>
                           </div>
                        </div>

                        {/* Guillotine */}
                        <div className={`p-4 rounded-xl border transition-all ${guillotineEnabled ? 'bg-red-950/20 border-red-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                           <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                 <Skull className={`w-4 h-4 ${guillotineEnabled ? 'text-red-400' : 'text-slate-500'}`} />
                                 <span className={`text-xs font-bold uppercase ${guillotineEnabled ? 'text-red-400' : 'text-slate-500'}`}>La Ghigliottina</span>
                              </div>
                              <button onClick={() => setGuillotineEnabled(!guillotineEnabled)} className={`w-9 h-5 rounded-full relative transition-colors ${guillotineEnabled ? 'bg-red-600' : 'bg-slate-700'}`}>
                                 <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: guillotineEnabled ? '20px' : '4px'}}></div>
                              </button>
                           </div>
                           {guillotineEnabled && (
                              <div className="space-y-3 pt-2 border-t border-red-900/30">
                                 <div className="grid grid-cols-2 gap-3">
                                    <div>
                                       <span className="text-[9px] text-slate-500 uppercase">Interval</span>
                                       <input type="number" value={config.guillotineInterval} onChange={(e) => setConfig({...config, guillotineInterval: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-center font-mono" />
                                    </div>
                                    <div>
                                       <span className="text-[9px] text-slate-500 uppercase">Slash %</span>
                                       <input type="number" value={(config.guillotineStrength * 100).toFixed(0)} onChange={(e) => setConfig({...config, guillotineStrength: parseFloat(e.target.value)/100})} className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-center font-mono" />
                                    </div>
                                 </div>
                                 <div>
                                    <span className="text-[9px] text-slate-500 uppercase">Whale Threshold ($)</span>
                                    <input type="range" min="100" max="2000" step="100" value={config.guillotineThreshold} onChange={(e) => setConfig({...config, guillotineThreshold: parseInt(e.target.value)})} className="w-full h-1 bg-slate-800 rounded accent-red-500" />
                                    <div className="text-right text-[10px] text-red-400 font-mono">${config.guillotineThreshold}</div>
                                 </div>
                              </div>
                           )}
                        </div>

                     </div>
                  )}

                </div>

                {/* Footer Controls */}
                <div className="p-4 border-t border-slate-800 bg-slate-950">
                   <div className="flex gap-2 mb-2">
                      <button onClick={handleManualDeposit} disabled={status === SimulationStatus.COMPLETED} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white p-3 rounded-xl text-sm font-bold border border-slate-700 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
                         <Settings className="w-4 h-4" /> Deposit
                      </button>
                      <button onClick={() => status !== SimulationStatus.COMPLETED && setStatus(status === SimulationStatus.RUNNING ? SimulationStatus.PAUSED : SimulationStatus.RUNNING)} disabled={status === SimulationStatus.COMPLETED} className={`flex-1 p-3 rounded-xl text-sm font-bold border transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 ${status === SimulationStatus.RUNNING ? 'bg-amber-500/10 text-amber-500 border-amber-500/50' : 'bg-emerald-600 text-white border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]'}`}>
                         {status === SimulationStatus.RUNNING ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Auto Run</>}
                      </button>
                   </div>
                   <button onClick={handleFullReset} className="w-full py-2 text-[10px] text-slate-500 hover:text-red-400 uppercase tracking-widest flex items-center justify-center gap-1 transition-colors">
                      <RefreshCw className="w-3 h-3" /> Hard Reset System
                   </button>
                </div>
              </div>

            </div>

            {/* Middle: Stats & Queue */}
            <div className="lg:col-span-4 space-y-6">
               {/* Live Stats */}
               <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-lg">
                 {stats.isAutoPaused && (
                    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center p-6">
                       <div className="bg-emerald-500/10 p-4 rounded-full mb-4">
                          <Clock className="w-12 h-12 text-emerald-500" />
                       </div>
                       <h3 className="text-2xl font-bold text-white mb-2">Cycle Complete</h3>
                       <p className="text-sm text-slate-400 mb-6">Max duration reached.</p>
                       <button onClick={handleFullReset} className="px-6 py-3 bg-emerald-600 rounded-xl text-sm font-bold text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 transition-all transform hover:scale-105">
                          Start New Cycle
                       </button>
                    </div>
                 )}
                 
                 <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Activity className="w-4 h-4 text-emerald-500" /> Network Status
                    </h2>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
                      <div className={`w-2 h-2 rounded-full ${status === SimulationStatus.RUNNING ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
                      <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">
                        {status === SimulationStatus.RUNNING ? 'Live' : status === SimulationStatus.COMPLETED ? 'Ended' : 'Paused'}
                      </span>
                    </div>
                 </div>

                 {/* Head Status */}
                 <div className="bg-gradient-to-br from-slate-950 to-slate-900 rounded-2xl border border-slate-800 p-5 mb-5 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-300 opacity-20"></div>
                    {headPlayer ? (
                      <>
                        <div className="flex justify-between items-start mb-3 relative z-10">
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Paying Out</div>
                            <div className="text-base font-bold text-white flex items-center gap-2">
                               {headPlayer.id === 'PROTOCOL_SEED' ? 'PROTOCOL SEED' : headPlayer.id.startsWith('JACKPOT') ? 'JACKPOT BOT' : `User ${headPlayer.id.slice(0,6)}`}
                               {headPlayer.slashed && <Skull className="w-3.5 h-3.5 text-red-500 animate-pulse" />}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Target</div>
                            <div className="text-base font-mono font-bold text-emerald-400">
                              ${headPlayer.collected.toFixed(0)} <span className="text-slate-600 text-xs">/ ${headPlayer.target.toFixed(0)}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="relative h-2.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                          <div 
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                            style={{ width: `${(headPlayer.collected / headPlayer.target) * 100}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-right text-slate-500 font-mono">
                          {((headPlayer.collected / headPlayer.target) * 100).toFixed(1)}% Completed
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-6 text-slate-500 text-xs italic flex flex-col items-center gap-2">
                        <Users className="w-8 h-8 opacity-20" />
                        Queue Empty
                      </div>
                    )}
                 </div>

                 {/* Grid Stats */}
                 <div className="grid grid-cols-2 gap-3">
                   <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                     <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Users in Queue</div>
                     <div className="text-2xl font-mono font-bold text-white tracking-tight">{stats.usersTrapped.toLocaleString()}</div>
                   </div>
                   <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                     <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Day / Round</div>
                     <div className="text-2xl font-mono font-bold text-white tracking-tight">{daysPassed}</div>
                   </div>
                   <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50 col-span-2 flex justify-between items-center">
                     <div>
                        <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Total Volume</div>
                        <div className="text-2xl font-mono font-bold text-emerald-400 tracking-tight">${stats.totalDeposited.toLocaleString()}</div>
                     </div>
                     <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">System Debt</div>
                        <div className="text-xl font-mono font-bold text-red-400 tracking-tight">${totalLiability.toLocaleString()}</div>
                     </div>
                   </div>
                 </div>
               </div>

               {/* Queue Visual */}
               <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 h-[400px] flex flex-col shadow-lg">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Target className="w-4 h-4 text-emerald-500" /> Active Queue
                  </h2>
                  <div className="flex-grow overflow-hidden relative">
                    <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-slate-900 to-transparent z-10 pointer-events-none"></div>
                    <QueueVisualizer queue={queueSlice} maxDisplay={7} />
                    <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-slate-900 to-transparent z-10 pointer-events-none"></div>
                  </div>
               </div>
            </div>

            {/* Right: Charts & Audit */}
            <div className="lg:col-span-4 space-y-6">
              
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-500" /> Growth Curve
                </h2>
                <StatsChart data={chartData} />
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col h-[400px] shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Bot className="w-4 h-4 text-purple-500" /> AI Auditor
                  </h2>
                  <button 
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || stats.totalUsers === 0}
                    className="text-[10px] bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-all font-bold shadow-lg shadow-purple-900/20 active:scale-95"
                  >
                    {isAnalyzing ? 'Analyzing...' : 'Run Audit'}
                  </button>
                </div>
                
                <div className="flex-grow bg-slate-950 rounded-2xl p-5 border border-slate-800 text-sm text-slate-300 overflow-y-auto custom-scrollbar shadow-inner">
                  {analysis ? (
                    <div className="prose prose-invert prose-sm">
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">{analysis}</pre>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4">
                      <div className="bg-slate-900 p-4 rounded-full">
                         <Bot className="w-8 h-8 opacity-40" />
                      </div>
                      <p className="text-center text-xs max-w-[200px] leading-relaxed opacity-60">
                        Start the simulation to generate data, then ask the AI to audit the protocol's sustainability.
                      </p>
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>
        ) : activeTab === 'dapp' ? (
          <div className="flex justify-center h-[calc(100vh-150px)]">
             <UserDapp 
               stats={stats} 
               onDeposit={handleDappDeposit} 
               isProcessing={status === SimulationStatus.RUNNING} 
               myPositions={uiSnapshot.clientPositions}
             />
          </div>
        ) : (
          <SmartContractViewer />
        )}
      </div>
      
      {/* Branding Footer */}
      <div className="fixed bottom-4 right-4 text-[10px] font-mono font-bold text-slate-500 bg-slate-900/90 backdrop-blur px-4 py-2 rounded-full border border-slate-800 pointer-events-none z-50 flex items-center gap-2 shadow-xl">
         <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
         Virtual Architects
      </div>
    </div>
  );
};

export default App;
