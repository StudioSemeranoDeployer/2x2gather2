
import React, { useState, useEffect } from 'react';
import { Wallet, ArrowRight, ShieldCheck, Zap, TrendingUp, Lock, Coins, LogOut, CheckCircle2, List, Percent, ShieldAlert, Clock, Trophy, AlertTriangle } from 'lucide-react';
import { SimulationStats, Player } from '../types';

interface UserDappProps {
  stats: SimulationStats;
  onDeposit: (amount: number) => void;
  onWithdraw?: (id: string) => void;
  isProcessing?: boolean;
  myPositions?: Player[];
}

export const UserDapp: React.FC<UserDappProps> = ({ stats, onDeposit, onWithdraw, isProcessing = false, myPositions = [] }) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [address, setAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('100');
  const [userBalance, setUserBalance] = useState<number>(5000);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>('24:00:00');

  useEffect(() => {
     const timer = setInterval(() => {
         if (!stats.roundActive) {
             setTimeLeft("00:00:00");
             return;
         }
         const now = Date.now();
         const diff = Math.max(0, stats.roundExpiry - now);
         const hours = Math.floor(diff / 3600000);
         const minutes = Math.floor((diff % 3600000) / 60000);
         const seconds = Math.floor((diff % 60000) / 1000);
         setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
     }, 1000);
     return () => clearInterval(timer);
  }, [stats.roundExpiry, stats.roundActive]);

  const handleConnect = () => {
    // Simulate wallet connection delay
    setTimeout(() => {
      setIsConnected(true);
      const randomAddr = '0x' + Array(40).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('').substring(0, 8) + '...' + 'A1B2';
      setAddress(randomAddr);
    }, 500);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setAddress('');
    setTxHash(null);
  };

  const handleDeposit = () => {
    if (!isConnected) return;
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return;
    if (val > userBalance) return;
    if (val > stats.config.maxDepositLimit) return; // Cap check

    setUserBalance(prev => prev - val);
    onDeposit(val);
    
    // Simulate Tx Hash
    const hash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    setTxHash(hash);
    setTimeout(() => setTxHash(null), 3000);
  };

  const currentMultiplier = stats.multiplier;
  const potentialReturn = parseFloat(amount || '0') * currentMultiplier;
  
  // Last Depositor check
  const amILastDepositor = isConnected && stats.lastDepositorId && myPositions.some(p => p.id === stats.lastDepositorId);

  return (
    <div className="h-full w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 p-4">
      
      {/* LEFT: Trading Interface */}
      <div className="flex flex-col items-center justify-center">
        <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl relative z-10">
          
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
               <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Zap className="w-5 h-5 text-white fill-white" />
               </div>
               <span className="font-bold text-lg tracking-tight text-white">x2gether <span className="text-emerald-500">DApp</span></span>
            </div>
            
            {!isConnected ? (
              <button 
                onClick={handleConnect}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold rounded-xl border border-slate-700 transition-all active:scale-95 flex items-center gap-2"
              >
                <Wallet className="w-4 h-4" /> Connect
              </button>
            ) : (
              <button 
                onClick={handleDisconnect}
                className="px-4 py-2 bg-slate-900/50 hover:bg-slate-800 text-slate-300 text-sm font-mono rounded-xl border border-slate-800 transition-all flex items-center gap-2 group"
              >
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                {address}
                <LogOut className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
              </button>
            )}
          </div>

           {/* FOMO TIMER */}
           <div className={`mb-6 p-4 rounded-2xl border flex items-center justify-between ${stats.roundActive ? 'bg-slate-950/50 border-slate-700' : 'bg-red-950/20 border-red-500/50'}`}>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${stats.roundActive ? 'bg-slate-800' : 'bg-red-500/20'}`}>
                        <Clock className={`w-5 h-5 ${stats.roundActive ? 'text-emerald-400' : 'text-red-500'}`} />
                    </div>
                    <div>
                        <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Round Ends In</div>
                        <div className={`text-xl font-mono font-bold ${stats.roundActive ? 'text-white' : 'text-red-400'}`}>{timeLeft}</div>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Potential Jackpot</div>
                    <div className="text-xl font-mono font-bold text-amber-400">${(stats.jackpotBalance * 0.5).toLocaleString()}</div>
                </div>
           </div>

           {/* Stats Row */}
           <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-950/50 p-3 rounded-2xl border border-slate-800">
                 <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Current ROI</div>
                 <div className="text-xl font-bold text-emerald-400 flex items-center gap-1">
                    {currentMultiplier.toFixed(2)}x <TrendingUp className="w-3 h-3" />
                 </div>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-2xl border border-slate-800">
                 <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Max Deposit</div>
                 <div className="text-xl font-bold text-slate-300">
                    ${stats.config.maxDepositLimit} <span className="text-xs text-slate-600 font-normal">USDC</span>
                 </div>
              </div>
           </div>

           {/* Input Area */}
           <div className="space-y-4 mb-6">
              <div className="relative">
                 <div className="flex justify-between text-xs text-slate-400 mb-2">
                    <span className="font-bold uppercase">Amount to Deposit</span>
                    <span>Balance: {isConnected ? `$${userBalance.toLocaleString()}` : '-'}</span>
                 </div>
                 <div className="relative group">
                    <input 
                       type="number" 
                       value={amount}
                       onChange={(e) => setAmount(e.target.value)}
                       disabled={!isConnected || !stats.roundActive}
                       max={stats.config.maxDepositLimit}
                       className="w-full bg-slate-950 border border-slate-700 rounded-2xl p-4 text-2xl font-bold text-white placeholder-slate-700 outline-none focus:border-emerald-500/50 transition-all disabled:opacity-50"
                       placeholder="0.00"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                       <span className="text-sm font-bold text-slate-500">USDC</span>
                       <div className="w-6 h-6 rounded-full bg-[#2775CA] flex items-center justify-center">
                          <span className="text-[8px] font-bold text-white">$</span>
                       </div>
                    </div>
                 </div>
                 {parseFloat(amount) > stats.config.maxDepositLimit && (
                     <div className="text-xs text-red-400 mt-1 pl-1">Max deposit is ${stats.config.maxDepositLimit}</div>
                 )}
              </div>

              <div className="bg-slate-950/30 rounded-xl p-4 border border-slate-800/50 space-y-2">
                 <div className="flex justify-between items-center text-xs text-slate-500">
                   <span>Target Return ({currentMultiplier.toFixed(2)}x)</span>
                   <span>${potentialReturn.toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
                 </div>
                 <div className="border-t border-slate-800/50 pt-2 flex justify-between items-center">
                   <span className="text-xs text-slate-400">Total Potential Payout</span>
                   <span className="text-lg font-bold text-emerald-400 flex items-center gap-1">
                      ${potentialReturn.toLocaleString(undefined, {maximumFractionDigits: 2})}
                      <Coins className="w-3.5 h-3.5 text-emerald-500/50" />
                   </span>
                 </div>
              </div>
           </div>

           {/* Action Button */}
           <button
              onClick={handleDeposit}
              disabled={!isConnected || parseFloat(amount) <= 0 || parseFloat(amount) > userBalance || parseFloat(amount) > stats.config.maxDepositLimit || !stats.roundActive}
              className={`w-full py-4 rounded-2xl font-bold text-lg transition-all transform active:scale-[0.98] shadow-lg flex flex-col items-center justify-center ${
                 !isConnected 
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' 
                    : !stats.roundActive 
                      ? 'bg-slate-800 text-red-500 border border-red-900/50 cursor-not-allowed'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-slate-900 shadow-emerald-500/20'
              }`}
           >
              {!isConnected ? 'Connect Wallet First' : !stats.roundActive ? 'Round Ended' : 'Deposit USDC'}
              {stats.roundActive && isConnected && <span className="text-[10px] font-normal opacity-70">+10 Minutes to Timer</span>}
           </button>
           
           {/* Success Toast */}
           {txHash && (
              <div className="absolute top-4 left-4 right-4 bg-slate-800 text-emerald-400 text-xs p-3 rounded-xl border border-emerald-500/20 shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                 <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                 <div>
                    <div className="font-bold">Transaction Sent</div>
                    <div className="opacity-60 font-mono truncate w-48">{txHash}</div>
                 </div>
              </div>
           )}
        </div>
      </div>

      {/* RIGHT: My Positions */}
      <div className="flex flex-col h-full bg-slate-900/50 border border-slate-800 rounded-3xl p-6 relative overflow-hidden">
         <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
                <List className="w-5 h-5 text-emerald-400" />
                <h2 className="font-bold text-white text-lg">My Positions</h2>
                <span className="bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full">{myPositions.length}</span>
            </div>
            {amILastDepositor && stats.roundActive && (
                <div className="bg-amber-500/20 text-amber-500 px-3 py-1 rounded-lg border border-amber-500/30 text-xs font-bold animate-pulse flex items-center gap-2">
                    <Trophy className="w-3 h-3" /> YOU ARE WINNING
                </div>
            )}
         </div>
         
         {!isConnected ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-600 gap-3">
               <Lock className="w-8 h-8 opacity-50" />
               <p className="text-sm">Connect wallet to view positions</p>
            </div>
         ) : myPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-600 gap-3">
               <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                  <Coins className="w-6 h-6 opacity-30" />
               </div>
               <p className="text-sm">No active deposits found</p>
            </div>
         ) : (
            <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-grow">
               {myPositions.map((p) => {
                  const progress = (p.collected / p.target) * 100;
                  return (
                     <div key={p.id} className={`bg-slate-950 p-4 rounded-xl border relative overflow-hidden group ${p.isUnlucky ? 'border-slate-700 grayscale opacity-80' : 'border-slate-800'}`}>
                        {/* Progress Bar BG */}
                        <div className="absolute bottom-0 left-0 h-1 bg-slate-800 w-full">
                           <div className={`h-full transition-all duration-500 ${p.isUnlucky ? 'bg-slate-500' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }}></div>
                        </div>

                        <div className="flex justify-between items-start mb-2 relative z-10">
                           <div>
                              <div className="text-[10px] text-slate-500 uppercase font-mono mb-0.5">ID: {p.id.slice(0,8)}...</div>
                              <div className="font-bold text-white flex items-center gap-2">
                                 ${p.deposit.toLocaleString()} 
                                 <span className={`text-xs font-normal px-1.5 py-0.5 rounded border ${p.isUnlucky ? 'bg-slate-800 text-slate-300 border-slate-600' : 'text-slate-400 bg-slate-900 border-slate-800'}`}>
                                    x{p.multiplier.toFixed(2)}
                                 </span>
                                 {p.isUnlucky && (
                                    <span title="Break Even Risk Hit" className="flex items-center">
                                       <ShieldAlert className="w-3 h-3 text-slate-500" />
                                    </span>
                                 )}
                              </div>
                           </div>
                           <div className="text-right">
                              <div className="text-[10px] text-slate-500 uppercase font-mono mb-0.5">{p.isUnlucky ? 'REFUND' : p.exitReason === 'JACKPOT_WIN' ? 'JACKPOT WIN' : 'PAYOUT'}</div>
                              <div className={`font-bold ${p.isUnlucky ? 'text-slate-300' : p.exitReason === 'JACKPOT_WIN' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                 ${p.collected.toFixed(2)} <span className="text-slate-600 text-xs">/ ${p.target.toFixed(0)}</span>
                              </div>
                           </div>
                        </div>
                        
                        {p.fastFilled && (
                           <div className="absolute top-2 right-2 z-10">
                              <Zap className="w-3 h-3 text-yellow-500 animate-pulse" />
                           </div>
                        )}

                        {/* Emergency Withdraw Button */}
                        {!p.exitRound && stats.roundActive && (
                            <div className="relative z-10 mt-3 pt-3 border-t border-slate-800/50 flex justify-end">
                                <button 
                                    onClick={() => onWithdraw && onWithdraw(p.id)}
                                    className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 px-3 py-1.5 rounded border border-red-900/50 transition-colors"
                                >
                                    <AlertTriangle className="w-3 h-3" />
                                    Emergency Exit (-20%)
                                </button>
                            </div>
                        )}
                     </div>
                  );
               })}
            </div>
         )}
      </div>

    </div>
  );
};
