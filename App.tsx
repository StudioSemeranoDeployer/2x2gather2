
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Player, SimulationStats, ChartDataPoint, SimulationStatus, DistributionStrategy, SimulationConfig } from './types';
import { QueueVisualizer } from './components/QueueVisualizer';
import { StatsChart } from './components/StatsChart';
import { SmartContractViewer } from './components/SmartContractViewer';
import { analyzeRisk } from './services/geminiService';
import { Play, Pause, RefreshCw, AlertTriangle, BarChart3, Bot, TrendingUp, TrendingDown, Settings, Users, ShieldCheck, Droplets, Sliders, Trophy, Crown, Skull, Ghost, Clock, Zap, Shuffle, Coins, Layers, Activity } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const INITIAL_SEED_AMOUNT = 1000;
const DAILY_DRIP_INTERVAL = 240; // ~24 hours (assuming 10 ticks = 1 hour)
const AUTO_PAUSE_TICKS = 30 * DAILY_DRIP_INTERVAL; // 30 Days

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
  currentRandomMultiplier: number; // Stores the current rolled value
}

const App: React.FC = () => {
  // --- UI State (Synced periodically) ---
  const [activeTab, setActiveTab] = useState<'simulation' | 'contract'>('simulation');
  const [settingsTab, setSettingsTab] = useState<'core' | 'economy' | 'bots' | 'risks'>('core');
  
  const [multiplier, setMultiplier] = useState<number>(2.0);
  const [strategy, setStrategy] = useState<DistributionStrategy>(DistributionStrategy.STANDARD);
  
  // Strategy Toggles
  const [guillotineEnabled, setGuillotineEnabled] = useState<boolean>(false);
  const [dynamicDecayEnabled, setDynamicDecayEnabled] = useState<boolean>(false);
  const [winnersTaxEnabled, setWinnersTaxEnabled] = useState<boolean>(false);

  // Advanced Customizable Parameters
  const [config, setConfig] = useState<SimulationConfig>({
    feePercent: 0.01,         // 1%
    
    guillotineStrength: 0.20, // 20% slash
    guillotineThreshold: 900, // Deposits > 900
    guillotineInterval: 60,   // ~6 hours default

    winnersTaxRate: 0.20,     // 20% tax
    winnersTaxFrequency: 10,  // 1 in 10

    dailyDripRate: 0.10,      // 10% daily drip default
    
    decayRate: 0.05,          // 0.05x reduction per 10 users default
    decayMinPercent: 0.05,    // Min 5% reduction
    decayMaxPercent: 0.40,    // Max 40% reduction
    
    randomDecayEnabled: false,
    randomDecayMin: 1.2,
    randomDecayMax: 2.5,
    randomDecayFrequency: 10, // Change every 10 users

    initialReserve: 30000,     // Default 30k
    
    taxBotEnabled: false,
    taxBotFrequency: 100,
    taxBotAmount: 500,

    jackpotFrequency: 1000,
    jackpotAmount: 1000
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
      dynamicDecayEnabled: false,
      winnersTaxEnabled: false,
      config: config
    },
    chartData: [],
    headPlayer: null
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
      fastFilled: false
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
    currentRandomMultiplier: 2.0
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
      .filter(p => !p.slashed && !p.id.startsWith('JACKPOT_BOT') && !p.id.startsWith('TAX_BOT') && p.id !== 'PROTOCOL_SEED' && p.deposit > state.config.guillotineThreshold) 
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

  // Logic: Daily Drip
  const triggerDailyDrip = () => {
    const state = engine.current;
    if (state.protocolBalance <= 1 || state.queue.length === 0) return;

    // Use configured drip rate
    const dripAmount = state.protocolBalance * state.config.dailyDripRate;
    state.protocolBalance -= dripAmount;

    // Distribute dripAmount to Head (FIFO)
    let remaining = dripAmount;
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
  const injectBot = (type: 'JACKPOT' | 'TAX') => {
    const state = engine.current;
    const isJackpot = type === 'JACKPOT';
    
    const deposit = isJackpot ? state.config.jackpotAmount : state.config.taxBotAmount;
    const target = deposit * 2.0;
    const botId = isJackpot ? `JACKPOT_BOT_${state.historyCount}` : `TAX_BOT_${state.historyCount}`;
    
    const bot: Player = {
      id: botId,
      deposit: deposit,
      target: target,
      collected: 0,
      entryRound: state.currentRound,
      timestamp: Date.now(),
      slashed: false,
      multiplier: 2.0,
      isTaxTarget: false,
      fastFilled: false
    };
    
    state.totalDeposited += deposit;
    state.queue.push(bot);
  };

  // Helper: Process a single deposit logic
  const processDeposit = (amount: number, isSystem: boolean = false) => {
    const state = engine.current;
    state.tickCount++;
    
    // --- TIMED EVENTS ---
    if (guillotineEnabled && state.tickCount % state.config.guillotineInterval === 0) {
      triggerGuillotine();
    }
    if (state.tickCount % DAILY_DRIP_INTERVAL === 0) {
      triggerDailyDrip();
    }
    
    // 1. Take Fee (if not system)
    let netAmount = amount;
    if (!isSystem) {
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

    // 3. Multiplier Calculation
    let effectiveMultiplier = multiplier;

    // A. RANDOM DECAY (High Priority)
    if (state.config.randomDecayEnabled && !isSystem) {
       const totalUsers = state.historyCount + state.queue.length;
       // Roll dice if frequency hit
       if (totalUsers > 0 && totalUsers % state.config.randomDecayFrequency === 0) {
          const range = state.config.randomDecayMax - state.config.randomDecayMin;
          state.currentRandomMultiplier = state.config.randomDecayMin + (Math.random() * range);
       }
       // If first run, init
       if (state.currentRandomMultiplier === 0) state.currentRandomMultiplier = multiplier;
       
       effectiveMultiplier = state.currentRandomMultiplier;
    } 
    // B. DYNAMIC DECAY (If Random is OFF)
    else if (dynamicDecayEnabled && !isSystem) {
      // Decay: Lose X for every 10 people in queue
      const decayFactor = Math.floor(state.queue.length / 10) * state.config.decayRate;
      const maxReduction = multiplier * state.config.decayMaxPercent;
      const minReduction = multiplier * state.config.decayMinPercent;
      
      let actualReduction = decayFactor;
      if (actualReduction > maxReduction) actualReduction = maxReduction;
      if (actualReduction < minReduction && state.queue.length > 10) actualReduction = minReduction;

      effectiveMultiplier = multiplier - actualReduction;
    }

    // 4. Winners Tax Flagging (1 in X users)
    const currentTotalUsers = state.historyCount + state.queue.length + 1;
    const isTaxTarget = winnersTaxEnabled && !isSystem && (currentTotalUsers % state.config.winnersTaxFrequency === 0);

    // 5. Create Player
    const newPlayer: Player = {
      id: isSystem ? 'PROTOCOL_SEED' : uuidv4(),
      deposit: amount,
      target: amount * effectiveMultiplier,
      collected: 0,
      entryRound: state.currentRound,
      timestamp: Date.now(),
      slashed: false,
      multiplier: effectiveMultiplier,
      isTaxTarget: isTaxTarget,
      fastFilled: false
    };

    // 6. Distribute Yield (Drip)
    if (yieldPool > 0 && state.queue.length > 0) {
      const yieldShare = yieldPool / state.queue.length;
      for (const p of state.queue) {
        p.collected += yieldShare;
      }
    }

    // 7. Distribute to Head (FIFO)
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

    // 8. Add new player
    state.queue.push(newPlayer);

    // --- CHECK FOR BOT INJECTIONS ---
    const totalUsers = state.historyCount + state.queue.length;
    
    // Jackpot Bot (Configurable)
    if (totalUsers > 0 && totalUsers % state.config.jackpotFrequency === 0) {
      injectBot('JACKPOT');
    }

    // Tax Bot (Configurable)
    if (state.config.taxBotEnabled && totalUsers > 0 && totalUsers % state.config.taxBotFrequency === 0) {
      injectBot('TAX');
    }

    // 9. Cleanup Sweep (Remove fully paid)
    const nextQueue: Player[] = [];

    for (const p of state.queue) {
      if (p.collected >= p.target - 0.01) {
        p.collected = p.target; // Visual clean
        
        // --- SPECIAL EXIT LOGIC ---
        if (p.id === 'PROTOCOL_SEED') {
            state.protocolBalance += p.collected;
        } else if (p.id.startsWith('JACKPOT_BOT')) {
            const profit = p.collected - p.deposit;
            state.jackpotBalance += profit;
        } else if (p.id.startsWith('TAX_BOT')) {
            const profit = p.collected - p.deposit;
            state.protocolBalance += profit; // Tax Bot profit goes to Reserve
        } else {
            // Normal User Logic - Winners Tax (Frequency Based)
            if (p.isTaxTarget) {
               const profit = p.collected - p.deposit;
               if (profit > 0) {
                 const tax = profit * state.config.winnersTaxRate; 
                 state.protocolBalance += tax;
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

    // 10. Update Chart Data
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
        fastFilled: false
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
      currentRandomMultiplier: 2.0
    };
    syncUI();
  };

  // --- Sync Loop (Engine -> UI) ---
  const syncUI = useCallback(() => {
    const state = engine.current;
    
    setUiSnapshot({
      queueSlice: state.queue.slice(0, 8),
      stats: {
        totalDeposited: state.totalDeposited,
        totalPaidOut: state.historySum,
        totalUsers: state.historyCount + state.queue.length,
        usersPaidExit: state.historyCount,
        usersTrapped: state.queue.length,
        currentQueueLength: state.queue.length,
        currentRound: state.currentRound,
        strategy,
        multiplier,
        protocolBalance: state.protocolBalance,
        jackpotBalance: state.jackpotBalance,
        guillotineEnabled,
        dynamicDecayEnabled,
        winnersTaxEnabled,
        config: state.config,
        isAutoPaused: state.tickCount >= AUTO_PAUSE_TICKS
      },
      chartData: [...state.chartData], 
      headPlayer: state.queue[0] || null
    });
  }, [strategy, multiplier, guillotineEnabled, dynamicDecayEnabled, winnersTaxEnabled, config]);

  // --- Timers ---
  useEffect(() => {
    const timer = setInterval(syncUI, 200); 
    return () => clearInterval(timer);
  }, [syncUI]);

  useEffect(() => {
    if (status !== SimulationStatus.RUNNING) return;
    
    const timer = setInterval(() => {
      // --- AUTO PAUSE CHECK ---
      if (engine.current.tickCount >= AUTO_PAUSE_TICKS) {
        setStatus(SimulationStatus.COMPLETED);
        return;
      }

      const amount = Math.floor(Math.random() * 990) + 10; 
      processDeposit(amount);
    }, 100); 

    return () => clearInterval(timer);
  }, [status, strategy, multiplier, guillotineEnabled, dynamicDecayEnabled, winnersTaxEnabled]);

  const handleManualDeposit = () => {
    processDeposit(manualDepositAmount);
    syncUI();
  };

  const handleAnalyze = async () => {
    if (!process.env.API_KEY) {
      setAnalysis("Error: API Key not found.");
      return;
    }
    setIsAnalyzing(true);
    const concept = `
      Protocol with ${multiplier}x Base Multiplier.
      Strategy: ${strategy}.
      Options: 
      - Guillotine: ${guillotineEnabled}
      - Winners Tax: ${winnersTaxEnabled}
      - Random Decay: ${config.randomDecayEnabled} (${config.randomDecayMin}x - ${config.randomDecayMax}x every ${config.randomDecayFrequency} users)
      - Entry Fee: ${config.feePercent * 100}%
      - Daily Drip Rate: ${config.dailyDripRate * 100}%
      Reserve: ${uiSnapshot.stats.protocolBalance.toFixed(2)} available.
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
                <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-400 font-mono">v5.0-RANDOM</span>
                <span>•</span>
                <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-blue-500"/> Audited Simulation</span>
              </div>
            </div>
          </div>

          <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800">
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
                      {(config.randomDecayEnabled || dynamicDecayEnabled) && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>}
                   </button>
                   <button onClick={() => setSettingsTab('bots')} className={`relative flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'bots' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>
                      Bots
                      {(config.taxBotEnabled) && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-purple-500 rounded-full"></span>}
                   </button>
                   <button onClick={() => setSettingsTab('risks')} className={`relative flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${settingsTab === 'risks' ? 'text-white border-b-2 border-emerald-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}>
                      Risks
                      {(guillotineEnabled || winnersTaxEnabled) && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full"></span>}
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

                       <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                         <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">
                           Entry Fee <span className="text-white font-mono">{(config.feePercent * 100).toFixed(1)}%</span>
                         </label>
                         <input 
                           type="range" min="0" max="10" step="0.5"
                           value={config.feePercent * 100}
                           onChange={(e) => setConfig({...config, feePercent: parseFloat(e.target.value) / 100})}
                           className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-slate-500"
                         />
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
                       
                       {/* Base Multiplier */}
                       <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50">
                          <label className="flex justify-between text-xs text-slate-400 mb-2 uppercase font-bold">
                            Base Multiplier <span className="text-white font-mono">{multiplier}x</span>
                          </label>
                          <input 
                            type="range" min="1.1" max="3.0" step="0.1"
                            value={multiplier}
                            onChange={(e) => { setMultiplier(parseFloat(e.target.value)); handleFullReset(); }}
                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                          />
                       </div>

                       {/* Random Decay Option */}
                       <div className={`p-4 rounded-xl border transition-all ${config.randomDecayEnabled ? 'bg-indigo-950/20 border-indigo-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                          <div className="flex items-center justify-between mb-3">
                             <div className="flex items-center gap-2">
                                <Shuffle className={`w-4 h-4 ${config.randomDecayEnabled ? 'text-indigo-400' : 'text-slate-500'}`} />
                                <span className={`text-xs font-bold uppercase ${config.randomDecayEnabled ? 'text-indigo-400' : 'text-slate-500'}`}>Random Decay</span>
                             </div>
                             <button 
                               onClick={() => setConfig({...config, randomDecayEnabled: !config.randomDecayEnabled})}
                               className={`w-9 h-5 rounded-full relative transition-colors ${config.randomDecayEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                             >
                               <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: config.randomDecayEnabled ? '20px' : '4px'}}></div>
                             </button>
                          </div>
                          
                          {config.randomDecayEnabled && (
                            <div className="space-y-4 pt-2 border-t border-indigo-900/30 mt-2">
                               <div className="flex gap-2">
                                 <div className="flex-1">
                                    <div className="text-[9px] text-slate-500 mb-1 uppercase">Min Multiplier</div>
                                    <input type="number" step="0.1" value={config.randomDecayMin} onChange={(e) => setConfig({...config, randomDecayMin: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-center font-mono" />
                                 </div>
                                 <div className="flex-1">
                                    <div className="text-[9px] text-slate-500 mb-1 uppercase">Max Multiplier</div>
                                    <input type="number" step="0.1" value={config.randomDecayMax} onChange={(e) => setConfig({...config, randomDecayMax: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-center font-mono" />
                                 </div>
                               </div>
                               <div>
                                  <div className="flex justify-between text-[9px] text-slate-500 mb-1 uppercase">Change Frequency (Users)</div>
                                  <input type="range" min="1" max="100" value={config.randomDecayFrequency} onChange={(e) => setConfig({...config, randomDecayFrequency: parseInt(e.target.value)})} className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500" />
                                  <div className="text-right text-[9px] text-indigo-400 mt-1">Every {config.randomDecayFrequency} users</div>
                               </div>
                            </div>
                          )}
                       </div>

                       {/* Linear Decay */}
                       <div className={`p-4 rounded-xl border transition-all ${dynamicDecayEnabled && !config.randomDecayEnabled ? 'bg-orange-950/20 border-orange-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                          <div className="flex items-center justify-between mb-2">
                             <div className="flex items-center gap-2">
                                <TrendingDown className={`w-4 h-4 ${dynamicDecayEnabled ? 'text-orange-400' : 'text-slate-500'}`} />
                                <span className={`text-xs font-bold uppercase ${dynamicDecayEnabled ? 'text-orange-400' : 'text-slate-500'}`}>Linear Decay</span>
                             </div>
                             <button 
                               onClick={() => setDynamicDecayEnabled(!dynamicDecayEnabled)}
                               disabled={config.randomDecayEnabled}
                               className={`w-9 h-5 rounded-full relative transition-colors ${dynamicDecayEnabled && !config.randomDecayEnabled ? 'bg-orange-600' : 'bg-slate-700 opacity-50'}`}
                             >
                               <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: dynamicDecayEnabled && !config.randomDecayEnabled ? '20px' : '4px'}}></div>
                             </button>
                          </div>
                          {config.randomDecayEnabled && <p className="text-[10px] text-red-400 italic">Disabled: Random Decay is Active</p>}
                       </div>

                    </div>
                  )}

                  {/* BOTS TAB */}
                  {settingsTab === 'bots' && (
                     <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {/* Jackpot Bot */}
                        <div className="p-4 rounded-xl border border-amber-900/30 bg-amber-950/10">
                           <h3 className="text-xs font-bold text-amber-500 mb-3 flex items-center gap-2 uppercase">
                              <Zap className="w-4 h-4" /> Jackpot Injection
                           </h3>
                           <div className="space-y-4">
                              <div>
                                 <label className="flex justify-between text-[10px] text-slate-500 mb-1 uppercase">Frequency (Every X Users)</label>
                                 <div className="flex items-center gap-2">
                                    <input type="range" min="100" max="2000" step="100" value={config.jackpotFrequency} onChange={(e) => setConfig({...config, jackpotFrequency: parseInt(e.target.value)})} className="flex-1 h-1 bg-slate-800 rounded accent-amber-500" />
                                    <span className="text-amber-400 font-mono text-xs w-12 text-right">{config.jackpotFrequency}</span>
                                 </div>
                              </div>
                              <div>
                                 <label className="flex justify-between text-[10px] text-slate-500 mb-1 uppercase">Bot Amount ($)</label>
                                 <div className="flex items-center gap-2">
                                    <input type="range" min="100" max="5000" step="100" value={config.jackpotAmount} onChange={(e) => setConfig({...config, jackpotAmount: parseInt(e.target.value)})} className="flex-1 h-1 bg-slate-800 rounded accent-amber-500" />
                                    <span className="text-amber-400 font-mono text-xs w-12 text-right">${config.jackpotAmount}</span>
                                 </div>
                              </div>
                           </div>
                        </div>

                        {/* Tax Bot */}
                        <div className={`p-4 rounded-xl border transition-all ${config.taxBotEnabled ? 'bg-purple-950/20 border-purple-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                           <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                 <Ghost className={`w-4 h-4 ${config.taxBotEnabled ? 'text-purple-400' : 'text-slate-500'}`} />
                                 <span className={`text-xs font-bold uppercase ${config.taxBotEnabled ? 'text-purple-400' : 'text-slate-500'}`}>System Drain Bot</span>
                              </div>
                              <button onClick={() => setConfig({...config, taxBotEnabled: !config.taxBotEnabled})} className={`w-9 h-5 rounded-full relative transition-colors ${config.taxBotEnabled ? 'bg-purple-600' : 'bg-slate-700'}`}>
                                 <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: config.taxBotEnabled ? '20px' : '4px'}}></div>
                              </button>
                           </div>
                           
                           {config.taxBotEnabled && (
                              <div className="space-y-3 pt-2 border-t border-purple-900/30">
                                 <div>
                                    <div className="flex justify-between text-[9px] text-slate-500 mb-1 uppercase">Frequency (Users)</div>
                                    <input type="range" min="10" max="500" step="10" value={config.taxBotFrequency} onChange={(e) => setConfig({...config, taxBotFrequency: parseInt(e.target.value)})} className="w-full h-1 bg-slate-800 rounded accent-purple-500" />
                                 </div>
                                 <div>
                                    <div className="flex justify-between text-[9px] text-slate-500 mb-1 uppercase">Amount ($)</div>
                                    <input type="range" min="100" max="5000" step="100" value={config.taxBotAmount} onChange={(e) => setConfig({...config, taxBotAmount: parseInt(e.target.value)})} className="w-full h-1 bg-slate-800 rounded accent-purple-500" />
                                 </div>
                              </div>
                           )}
                        </div>
                     </div>
                  )}

                  {/* RISKS TAB */}
                  {settingsTab === 'risks' && (
                     <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
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

                        {/* Winners Tax */}
                        <div className={`p-4 rounded-xl border transition-all ${winnersTaxEnabled ? 'bg-blue-950/20 border-blue-500/40' : 'bg-slate-950/50 border-slate-800'}`}>
                           <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                 <Crown className={`w-4 h-4 ${winnersTaxEnabled ? 'text-blue-400' : 'text-slate-500'}`} />
                                 <span className={`text-xs font-bold uppercase ${winnersTaxEnabled ? 'text-blue-400' : 'text-slate-500'}`}>Winners Tax</span>
                              </div>
                              <button onClick={() => setWinnersTaxEnabled(!winnersTaxEnabled)} className={`w-9 h-5 rounded-full relative transition-colors ${winnersTaxEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}>
                                 <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform`} style={{left: winnersTaxEnabled ? '20px' : '4px'}}></div>
                              </button>
                           </div>
                           {winnersTaxEnabled && (
                              <div className="space-y-3 pt-2 border-t border-blue-900/30">
                                 <div>
                                    <span className="text-[9px] text-slate-500 uppercase">Frequency (1 in X Users)</span>
                                    <input type="range" min="2" max="50" step="1" value={config.winnersTaxFrequency} onChange={(e) => setConfig({...config, winnersTaxFrequency: parseInt(e.target.value)})} className="w-full h-1 bg-slate-800 rounded accent-blue-500" />
                                    <div className="text-right text-[10px] text-blue-400 font-mono">1 in {config.winnersTaxFrequency}</div>
                                 </div>
                                 <div>
                                    <span className="text-[9px] text-slate-500 uppercase">Tax Rate %</span>
                                    <input type="range" min="5" max="50" step="5" value={config.winnersTaxRate * 100} onChange={(e) => setConfig({...config, winnersTaxRate: parseFloat(e.target.value)/100})} className="w-full h-1 bg-slate-800 rounded accent-blue-500" />
                                    <div className="text-right text-[10px] text-blue-400 font-mono">{(config.winnersTaxRate * 100).toFixed(0)}%</div>
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
                         <Coins className="w-4 h-4" /> Deposit
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
                       <p className="text-sm text-slate-400 mb-6">Max duration of 30 days reached.</p>
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
                               {headPlayer.id === 'PROTOCOL_SEED' ? 'PROTOCOL SEED' : headPlayer.id.startsWith('JACKPOT') ? 'JACKPOT BOT' : headPlayer.id.startsWith('TAX') ? 'TAX BOT' : `User ${headPlayer.id.slice(0,6)}`}
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
                    <Layers className="w-4 h-4 text-emerald-500" /> Active Queue
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
